import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show
} from "solid-js";
import { Modal } from "./Modal";
import { SegmentedTabs } from "./page/SegmentedTabs";
import {
  buildNcmAccountFromStatus,
  useNcmAccount,
  type NcmAccount
} from "../shared/state/NcmAccountContext";
import {
  checkLoginQr,
  createLoginQr,
  getLoginQrKey,
  getLoginStatusWithCookie,
  loginCellphone,
  sentCaptcha,
  userDetail
} from "../shared/api/ncm";
import { useTranslation } from "../shared/i18n";

type LoginTab = "qr" | "phone" | "uid" | "cookie";
type Tone = "neutral" | "success" | "error";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
}

const QR_POLL_INTERVAL_MS = 2000;
const CAPTCHA_RESEND_SECONDS = 60;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface QrSession {
  key: string;
  imageUrl: string | null;
  phase: "creating" | "waiting" | "scanned" | "confirmed";
}

/**
 * Multi-tab login dialog. Each tab captures a session cookie via a
 * different upstream flow and routes through `upsertAccount` to land in
 * the global multi-account list.
 *
 * QR / Phone / Cookie tabs all rely on the proxy mirroring the joined
 * Set-Cookie pairs into `body.cookie` (see `build_success_response` in
 * `src/server/netease.rs`) — that is the only way a JS client can read
 * the HttpOnly session cookies the upstream sets.
 *
 * UID tab is a degenerate "read-only" account: it has an empty cookie
 * (so the proxy talks to NCM anonymously) but a stable `userId` that
 * lets the UI render "my playlists" pages with no personal data.
 */
export function LoginModal(props: LoginModalProps) {
  const { t } = useTranslation();
  const accountStore = useNcmAccount();
  const [activeTab, setActiveTab] = createSignal<LoginTab>("qr");
  const [feedback, setFeedback] = createSignal<{ tone: Tone; message: string } | null>(null);

  // Reset state every time the dialog opens.
  createEffect(() => {
    if (!props.open) {
      setFeedback(null);
      setQrSession(null);
      setPhoneCountryCode("86");
      setPhoneNumber("");
      setPhoneCaptcha("");
      setPhonePassword("");
      setPhoneMode("captcha");
      setCaptchaCooldown(0);
      setIsSendingCaptcha(false);
      setIsSubmittingPhone(false);
      setUidValue("");
      setIsSubmittingUid(false);
      setCookieValue("");
      setIsSubmittingCookie(false);
      setIsCreatingQr(false);
      setActiveTab("qr");
    }
  });

  const tabs = createMemo(() => [
    { value: "qr", label: t("ncm.loginModal.tab.qr") },
    { value: "phone", label: t("ncm.loginModal.tab.phone") },
    { value: "uid", label: t("ncm.loginModal.tab.uid") },
    { value: "cookie", label: t("ncm.loginModal.tab.cookie") }
  ]);

  // ----- QR tab -----
  const [qrSession, setQrSession] = createSignal<QrSession | null>(null);
  const [isCreatingQr, setIsCreatingQr] = createSignal(false);

  const startQrSession = async () => {
    setIsCreatingQr(true);
    try {
      const keyResponse = await getLoginQrKey();
      const key =
        readString(isRecord(keyResponse.data) ? keyResponse.data.unikey : null) ??
        readString(keyResponse.unikey);
      if (!key) {
        throw new Error(t("ncm.loginModal.error.qrKeyMissing"));
      }
      const qrResponse = await createLoginQr(key, true);
      const data = isRecord(qrResponse.data) ? qrResponse.data : null;
      const imageUrl = readString(data?.qrimg) ?? readString(data?.qrurl);
      setQrSession({ key, imageUrl, phase: "waiting" });
      setFeedback(null);
    } catch (error) {
      setFeedback({ tone: "error", message: readErrorMessage(error) });
    } finally {
      setIsCreatingQr(false);
    }
  };

  // Poll /login/qr/check every 2s while a session is active. The proxy mirrors
  // any Set-Cookie back into body.cookie when code === 803 (login confirmed).
  createEffect(() => {
    const session = qrSession();
    if (!session || session.phase === "confirmed") return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await checkLoginQr(session.key);
        if (cancelled) return;
        const code = readNumber(response.code);
        if (code === 800) {
          setQrSession(null);
          setFeedback({
            tone: "error",
            message: t("ncm.loginModal.qr.status.expired")
          });
          return;
        }
        if (code === 801) {
          setQrSession((current) => (current ? { ...current, phase: "waiting" } : current));
          return;
        }
        if (code === 802) {
          setQrSession((current) => (current ? { ...current, phase: "scanned" } : current));
          return;
        }
        if (code === 803) {
          // Proxy injected the joined cookie string into body.cookie.
          const cookie = readString(response.cookie) ?? "";
          if (!cookie) {
            throw new Error(t("ncm.loginModal.error.qrKeyMissing"));
          }
          await onCookieCaptured(cookie);
          setQrSession((current) => (current ? { ...current, phase: "confirmed" } : current));
          return;
        }
      } catch (error) {
        if (cancelled) return;
        setQrSession(null);
        setFeedback({
          tone: "error",
          message: t("ncm.loginModal.error.qrSessionFailed", { reason: readErrorMessage(error) })
        });
      }
    }, QR_POLL_INTERVAL_MS);

    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
    });
  });

  // ----- Phone tab -----
  const [phoneCountryCode, setPhoneCountryCode] = createSignal("86");
  const [phoneNumber, setPhoneNumber] = createSignal("");
  const [phoneCaptcha, setPhoneCaptcha] = createSignal("");
  const [phonePassword, setPhonePassword] = createSignal("");
  const [phoneMode, setPhoneMode] = createSignal<"captcha" | "password">("captcha");
  const [captchaCooldown, setCaptchaCooldown] = createSignal(0);
  const [isSendingCaptcha, setIsSendingCaptcha] = createSignal(false);
  const [isSubmittingPhone, setIsSubmittingPhone] = createSignal(false);

  // Tick down the resend cooldown.
  createEffect(() => {
    if (captchaCooldown() <= 0) return;
    const timer = window.setInterval(() => {
      setCaptchaCooldown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  const handleSendCaptcha = async () => {
    const phone = phoneNumber().trim();
    if (!phone) {
      setFeedback({ tone: "error", message: t("ncm.loginModal.error.captchaPhoneRequired") });
      return;
    }
    setIsSendingCaptcha(true);
    try {
      await sentCaptcha({ phone, ctcode: phoneCountryCode().trim() || "86" });
      setCaptchaCooldown(CAPTCHA_RESEND_SECONDS);
      setFeedback({
        tone: "success",
        message: t("ncm.loginModal.phone.feedback.captchaSent")
      });
    } catch (error) {
      setFeedback({ tone: "error", message: readErrorMessage(error) });
    } finally {
      setIsSendingCaptcha(false);
    }
  };

  const handlePhoneSubmit = async () => {
    const phone = phoneNumber().trim();
    if (!phone) {
      setFeedback({ tone: "error", message: t("ncm.loginModal.error.captchaPhoneRequired") });
      return;
    }
    if (phoneMode() === "captcha" && !phoneCaptcha().trim()) {
      setFeedback({ tone: "error", message: t("ncm.loginModal.error.captchaCodeRequired") });
      return;
    }
    if (phoneMode() === "password" && !phonePassword()) {
      setFeedback({ tone: "error", message: t("ncm.loginModal.error.passwordRequired") });
      return;
    }
    setIsSubmittingPhone(true);
    try {
      const response = await loginCellphone({
        phone,
        countrycode: phoneCountryCode().trim() || "86",
        ...(phoneMode() === "captcha"
          ? { captcha: phoneCaptcha().trim() }
          : { password: phonePassword() })
      });
      const cookie = readString(response.cookie) ?? "";
      if (!cookie) {
        // Backend should always mirror Set-Cookie pairs into body.cookie via
        // build_success_response. If we still got nothing, the upstream login
        // call didn't set a session cookie at all — surface as an error.
        throw new Error(t("ncm.loginModal.error.cookieInvalid"));
      }
      await onCookieCaptured(cookie, response);
    } catch (error) {
      setFeedback({ tone: "error", message: readErrorMessage(error) });
    } finally {
      setIsSubmittingPhone(false);
    }
  };

  // ----- UID tab -----
  const [uidValue, setUidValue] = createSignal("");
  const [isSubmittingUid, setIsSubmittingUid] = createSignal(false);

  const handleUidSubmit = async () => {
    const trimmed = uidValue().trim();
    const uid = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(uid) || uid <= 0) {
      setFeedback({ tone: "error", message: t("ncm.loginModal.error.uidRequired") });
      return;
    }
    setIsSubmittingUid(true);
    try {
      // Anonymous probe: pass an empty cookieOverride so the request
      // explicitly opts out of the global active cookie.
      const detail = await userDetail(uid);
      const profile = isRecord(detail.profile) ? detail.profile : null;
      const userId = readNumber(profile?.userId);
      if (userId === null) {
        setFeedback({ tone: "error", message: t("ncm.loginModal.error.uidNotFound") });
        return;
      }
      const account: NcmAccount = {
        userId,
        nickname: readString(profile?.nickname),
        avatarUrl: readString(profile?.avatarUrl),
        cookie: "", // Read-only: anonymous proxy access.
        vipType: readNumber(profile?.vipType),
        level: readNumber(profile?.level),
        signinAt: null,
        addedAt: Date.now(),
        refreshedAt: Date.now()
      };
      accountStore.upsertAccount(account);
      setFeedback({
        tone: "success",
        message: t("ncm.loginModal.success.uidAdded", { userId })
      });
      props.onClose();
    } catch (error) {
      setFeedback({ tone: "error", message: readErrorMessage(error) });
    } finally {
      setIsSubmittingUid(false);
    }
  };

  // ----- Cookie tab -----
  const [cookieValue, setCookieValue] = createSignal("");
  const [isSubmittingCookie, setIsSubmittingCookie] = createSignal(false);

  const handleCookieSubmit = async () => {
    const cookie = cookieValue().trim();
    if (!cookie) {
      setFeedback({ tone: "error", message: t("ncm.loginModal.error.cookieRequired") });
      return;
    }
    setIsSubmittingCookie(true);
    try {
      // Validate the cookie BEFORE storing it so we don't pollute the account
      // list with a dud. Use the per-request cookieOverride to keep the global
      // slot untouched until we know it's good.
      const probe = await getLoginStatusWithCookie(cookie);
      const account = buildNcmAccountFromStatus(probe, cookie);
      if (!account) {
        setFeedback({ tone: "error", message: t("ncm.loginModal.error.cookieInvalid") });
        return;
      }
      accountStore.upsertAccount(account);
      setFeedback({
        tone: "success",
        message: t("ncm.loginModal.success.signedIn", {
          name: account.nickname ?? account.userId
        })
      });
      props.onClose();
    } catch (error) {
      setFeedback({ tone: "error", message: readErrorMessage(error) });
    } finally {
      setIsSubmittingCookie(false);
    }
  };

  /**
   * Shared completion path for QR + phone logins. Uses the *just-captured*
   * cookie as a per-request override (the global slot still holds whatever
   * was active before this login flow), validates against /login/status when
   * needed, then commits to the account list — `upsertAccount` flips active
   * to this user, the cookie-sync effect picks it up, and subsequent calls
   * route through the normal global-slot path.
   */
  const onCookieCaptured = async (cookie: string, primaryEnvelope?: unknown): Promise<void> => {
    if (!cookie) {
      throw new Error(t("ncm.loginModal.error.cookieInvalid"));
    }

    // Try the response we already have first — loginCellphone returns
    // account+profile inline, and the proxy mirrors the joined cookie into
    // the body when Set-Cookie is present.
    let account: NcmAccount | null = primaryEnvelope
      ? buildNcmAccountFromStatus(primaryEnvelope, cookie)
      : null;

    // Fallback: probe /login/status with the captured cookie as a per-request
    // override. Critically, do NOT call `userAccount()` here — that uses the
    // global slot, which still points at the previous account (or null on a
    // first login).
    if (!account) {
      const probe = await getLoginStatusWithCookie(cookie);
      account = buildNcmAccountFromStatus(probe, cookie);
    }

    if (!account) {
      throw new Error(t("ncm.loginModal.error.cookieInvalid"));
    }

    accountStore.upsertAccount(account);
    setFeedback({
      tone: "success",
      message: t("ncm.loginModal.success.signedIn", {
        name: account.nickname ?? account.userId
      })
    });
    props.onClose();
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={t("ncm.loginModal.title")}
      size="md"
    >
      <div class="login-modal-body">
        <p class="panel-note">{t("ncm.loginModal.subtitle")}</p>
        <SegmentedTabs
          value={activeTab()}
          onChange={(next) => setActiveTab(next as LoginTab)}
          items={tabs()}
          ariaLabel={t("ncm.loginModal.tabs.aria")}
        />

        <Show when={feedback()}>
          {(fb) => (
            <div
              class={`login-modal-feedback login-modal-feedback-${fb().tone}`}
              role={fb().tone === "error" ? "alert" : "status"}
            >
              {fb().message}
            </div>
          )}
        </Show>

        <Show when={activeTab() === "qr"}>
          <section class="login-modal-section">
            <p class="panel-note">{t("ncm.loginModal.qr.hint")}</p>
            <div class="login-modal-qr">
              <Show
                when={qrSession()?.imageUrl}
                fallback={
                  <div class="login-modal-qr-placeholder">
                    {isCreatingQr()
                      ? t("ncm.loginModal.qr.status.creating")
                      : t("ncm.loginModal.qr.status.idle")}
                  </div>
                }
              >
                {(imageUrl) => (
                  <img
                    src={imageUrl()}
                    alt={t("ncm.login.qr.alt")}
                    class="login-modal-qr-image"
                  />
                )}
              </Show>
              <div class="login-modal-qr-status">
                <Show when={qrSession()}>
                  {(session) => (
                    <span>
                      {session().phase === "scanned"
                        ? t("ncm.loginModal.qr.status.scanned")
                        : session().phase === "confirmed"
                          ? t("ncm.loginModal.qr.status.confirmed")
                          : t("ncm.loginModal.qr.status.waiting")}
                    </span>
                  )}
                </Show>
              </div>
              <button
                type="button"
                class="primary-button"
                onClick={() => void startQrSession()}
                disabled={isCreatingQr()}
              >
                {qrSession()
                  ? t("ncm.loginModal.qr.action.regenerate")
                  : t("ncm.loginModal.qr.action.start")}
              </button>
            </div>
          </section>
        </Show>

        <Show when={activeTab() === "phone"}>
          <section class="login-modal-section">
            <form
              class="login-modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handlePhoneSubmit();
              }}
            >
              <label class="login-modal-field">
                <span>{t("ncm.loginModal.phone.label.country")}</span>
                <input
                  type="text"
                  class="text-input"
                  value={phoneCountryCode()}
                  onInput={(event) => setPhoneCountryCode(event.currentTarget.value)}
                />
              </label>
              <label class="login-modal-field">
                <span>{t("ncm.loginModal.phone.label.phone")}</span>
                <input
                  type="tel"
                  class="text-input"
                  value={phoneNumber()}
                  placeholder={t("ncm.loginModal.phone.placeholder.phone")}
                  onInput={(event) => setPhoneNumber(event.currentTarget.value)}
                />
              </label>

              <div class="login-modal-toggle" role="radiogroup">
                <label>
                  <input
                    type="radio"
                    name="phone-mode"
                    checked={phoneMode() === "captcha"}
                    onChange={() => setPhoneMode("captcha")}
                  />
                  <span>{t("ncm.loginModal.phone.mode.captcha")}</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="phone-mode"
                    checked={phoneMode() === "password"}
                    onChange={() => setPhoneMode("password")}
                  />
                  <span>{t("ncm.loginModal.phone.mode.password")}</span>
                </label>
              </div>

              <Show when={phoneMode() === "captcha"}>
                <label class="login-modal-field">
                  <span>{t("ncm.loginModal.phone.label.captcha")}</span>
                  <div class="login-modal-row">
                    <input
                      type="text"
                      class="text-input"
                      value={phoneCaptcha()}
                      placeholder={t("ncm.loginModal.phone.placeholder.captcha")}
                      onInput={(event) => setPhoneCaptcha(event.currentTarget.value)}
                    />
                    <button
                      type="button"
                      class="ghost-button"
                      onClick={() => void handleSendCaptcha()}
                      disabled={isSendingCaptcha() || captchaCooldown() > 0}
                    >
                      {isSendingCaptcha()
                        ? t("ncm.loginModal.phone.action.sendingCaptcha")
                        : captchaCooldown() > 0
                          ? t("ncm.loginModal.phone.action.resendCaptcha", {
                              seconds: captchaCooldown()
                            })
                          : t("ncm.loginModal.phone.action.sendCaptcha")}
                    </button>
                  </div>
                </label>
              </Show>

              <Show when={phoneMode() === "password"}>
                <label class="login-modal-field">
                  <span>{t("ncm.loginModal.phone.label.password")}</span>
                  <input
                    type="password"
                    class="text-input"
                    value={phonePassword()}
                    placeholder={t("ncm.loginModal.phone.placeholder.password")}
                    onInput={(event) => setPhonePassword(event.currentTarget.value)}
                  />
                </label>
              </Show>

              <button
                type="submit"
                class="primary-button"
                disabled={isSubmittingPhone()}
              >
                {isSubmittingPhone()
                  ? t("ncm.loginModal.phone.action.submitting")
                  : t("ncm.loginModal.phone.action.submit")}
              </button>
            </form>
          </section>
        </Show>

        <Show when={activeTab() === "uid"}>
          <section class="login-modal-section">
            <p class="panel-note">{t("ncm.loginModal.uid.hint")}</p>
            <form
              class="login-modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleUidSubmit();
              }}
            >
              <label class="login-modal-field">
                <span>{t("ncm.loginModal.uid.label")}</span>
                <input
                  type="text"
                  inputmode="numeric"
                  class="text-input"
                  value={uidValue()}
                  placeholder={t("ncm.loginModal.uid.placeholder")}
                  onInput={(event) => setUidValue(event.currentTarget.value)}
                />
              </label>
              <button
                type="submit"
                class="primary-button"
                disabled={isSubmittingUid()}
              >
                {isSubmittingUid()
                  ? t("ncm.loginModal.uid.action.submitting")
                  : t("ncm.loginModal.uid.action.submit")}
              </button>
            </form>
          </section>
        </Show>

        <Show when={activeTab() === "cookie"}>
          <section class="login-modal-section">
            <p class="panel-note">{t("ncm.loginModal.cookie.hint")}</p>
            <form
              class="login-modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCookieSubmit();
              }}
            >
              <label class="login-modal-field">
                <span>{t("ncm.loginModal.cookie.label")}</span>
                <textarea
                  class="text-input login-modal-cookie-input"
                  rows={4}
                  value={cookieValue()}
                  placeholder={t("ncm.loginModal.cookie.placeholder")}
                  onInput={(event) => setCookieValue(event.currentTarget.value)}
                />
              </label>
              <button
                type="submit"
                class="primary-button"
                disabled={isSubmittingCookie()}
              >
                {isSubmittingCookie()
                  ? t("ncm.loginModal.cookie.action.submitting")
                  : t("ncm.loginModal.cookie.action.submit")}
              </button>
            </form>
          </section>
        </Show>
      </div>
    </Modal>
  );
}
