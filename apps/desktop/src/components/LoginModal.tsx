import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show
} from "solid-js";
import { createStore } from "solid-js/store";
import { Modal } from "./Modal";
import { SegmentedTabs } from "./page/SegmentedTabs";
import { IconClose, IconLogo } from "./icons";
import {
  useNcmAccount,
  type NcmAccountInput
} from "../shared/state/NcmAccountContext";
import {
  loginCellphone,
  sentCaptcha,
  userDetail
} from "../shared/api/ncm";
import { useTranslation } from "../shared/i18n";
import { completeNcmLogin } from "../shared/state/ncmLoginCompletion";
import { useQrLoginSession } from "./login/useQrLoginSession";

type LoginTab = "qr" | "phone";
type SpecialLoginMode = "uid" | "cookie" | null;
type Tone = "neutral" | "success" | "error";

interface LoginModalProps {
  open: boolean;
  disableUid?: boolean;
  onClose: () => void;
}

interface LoginModalFormState {
  phoneCountryCode: string;
  phoneNumber: string;
  phoneCaptcha: string;
  phonePassword: string;
  phoneMode: "captcha" | "password";
  isSendingCaptcha: boolean;
  isSubmittingPhone: boolean;
  uidValue: string;
  isSubmittingUid: boolean;
  cookieValue: string;
  isSubmittingCookie: boolean;
}

const CAPTCHA_RESEND_SECONDS = 60;

const buildDefaultFormState = (): LoginModalFormState => ({
  phoneCountryCode: "86",
  phoneNumber: "",
  phoneCaptcha: "",
  phonePassword: "",
  phoneMode: "captcha",
  isSendingCaptcha: false,
  isSubmittingPhone: false,
  uidValue: "",
  isSubmittingUid: false,
  cookieValue: "",
  isSubmittingCookie: false
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
  const [specialMode, setSpecialMode] = createSignal<SpecialLoginMode>(null);
  const [feedback, setFeedback] = createSignal<{ tone: Tone; message: string } | null>(null);
  const [form, setForm] = createStore<LoginModalFormState>(buildDefaultFormState());

  const onCookieCaptured = async (cookie: string, primaryEnvelope?: unknown): Promise<void> => {
    const account = await completeNcmLogin({
      cookie,
      primaryEnvelope,
      upsertAccount: accountStore.upsertAccount
    });
    if (!account) {
      throw new Error(t("ncm.loginModal.error.cookieInvalid"));
    }

    setFeedback({
      tone: "success",
      message: t("ncm.loginModal.success.signedIn", {
        name: account.nickname ?? account.userId
      })
    });
    props.onClose();
  };

  const qrLogin = useQrLoginSession({
    enabled: () => props.open && activeTab() === "qr",
    missingQrMessage: t("ncm.loginModal.error.qrKeyMissing"),
    expiredMessage: t("ncm.loginModal.qr.status.expired"),
    sessionFailedMessage: (reason) =>
      t("ncm.loginModal.error.qrSessionFailed", { reason }),
    onFeedback: setFeedback,
    onCookieCaptured
  });

  // Reset state every time the dialog opens.
  createEffect(() => {
    if (!props.open) {
      setFeedback(null);
      qrLogin.reset();
      setForm(buildDefaultFormState());
      setCaptchaCooldown(0);
      setActiveTab("qr");
      setSpecialMode(null);
    }
  });

  const tabs = createMemo(() => [
    { value: "qr", label: t("ncm.loginModal.tab.qr") },
    { value: "phone", label: t("ncm.loginModal.tab.phone") }
  ]);

  // ----- Phone tab -----
  const [captchaCooldown, setCaptchaCooldown] = createSignal(0);

  // Tick down the resend cooldown.
  createEffect(() => {
    if (captchaCooldown() <= 0) return;
    const timer = window.setInterval(() => {
      setCaptchaCooldown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  const handleSendCaptcha = async () => {
    const phone = form.phoneNumber.trim();
    if (!phone) {
      setFeedback({ tone: "error", message: t("ncm.loginModal.error.captchaPhoneRequired") });
      return;
    }
    setForm("isSendingCaptcha", true);
    try {
      await sentCaptcha({ phone, ctcode: form.phoneCountryCode.trim() || "86" });
      setCaptchaCooldown(CAPTCHA_RESEND_SECONDS);
      setFeedback({
        tone: "success",
        message: t("ncm.loginModal.phone.feedback.captchaSent")
      });
    } catch (error) {
      setFeedback({ tone: "error", message: readErrorMessage(error) });
    } finally {
      setForm("isSendingCaptcha", false);
    }
  };

  const handlePhoneSubmit = async () => {
    const phone = form.phoneNumber.trim();
    if (!phone) {
      setFeedback({ tone: "error", message: t("ncm.loginModal.error.captchaPhoneRequired") });
      return;
    }
    if (form.phoneMode === "captcha" && !form.phoneCaptcha.trim()) {
      setFeedback({ tone: "error", message: t("ncm.loginModal.error.captchaCodeRequired") });
      return;
    }
    if (form.phoneMode === "password" && !form.phonePassword) {
      setFeedback({ tone: "error", message: t("ncm.loginModal.error.passwordRequired") });
      return;
    }
    setForm("isSubmittingPhone", true);
    try {
      const response = await loginCellphone({
        phone,
        countrycode: form.phoneCountryCode.trim() || "86",
        ...(form.phoneMode === "captcha"
          ? { captcha: form.phoneCaptcha.trim() }
          : { password: form.phonePassword })
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
      setForm("isSubmittingPhone", false);
    }
  };

  // ----- UID tab -----
  const handleUidSubmit = async () => {
    const trimmed = form.uidValue.trim();
    const uid = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(uid) || uid <= 0) {
      setFeedback({ tone: "error", message: t("ncm.loginModal.error.uidRequired") });
      return;
    }
    setForm("isSubmittingUid", true);
    try {
      // Anonymous probe: pass an empty cookieOverride so the request
      // explicitly opts out of the global active cookie.
      const detail = await userDetail(uid, { suppressActiveCookie: true });
      const profile = isRecord(detail.profile) ? detail.profile : null;
      const userId = readNumber(profile?.userId);
      if (userId === null) {
        setFeedback({ tone: "error", message: t("ncm.loginModal.error.uidNotFound") });
        return;
      }
      const account: NcmAccountInput = {
        userId,
        nickname: readString(profile?.nickname),
        avatarUrl: readString(profile?.avatarUrl),
        cookie: "", // Read-only: anonymous proxy access.
        vipType: readNumber(profile?.vipType),
        level: readNumber(profile?.level),
        signinAt: null
      };
      await accountStore.upsertAccount(account);
      setFeedback({
        tone: "success",
        message: t("ncm.loginModal.success.uidAdded", { userId })
      });
      props.onClose();
    } catch (error) {
      setFeedback({ tone: "error", message: readErrorMessage(error) });
    } finally {
      setForm("isSubmittingUid", false);
    }
  };

  // ----- Cookie tab -----
  const handleCookieSubmit = async () => {
    const cookie = form.cookieValue.trim();
    if (!cookie) {
      setFeedback({ tone: "error", message: t("ncm.loginModal.error.cookieRequired") });
      return;
    }
    setForm("isSubmittingCookie", true);
    try {
      // Validate the cookie before storing it so we don't pollute the backend
      // account store with a dud. The cookie is sent only for this probe.
      const account = await completeNcmLogin({
        cookie,
        upsertAccount: accountStore.upsertAccount
      });
      if (!account) {
        setFeedback({ tone: "error", message: t("ncm.loginModal.error.cookieInvalid") });
        return;
      }
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
      setForm("isSubmittingCookie", false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={t("ncm.loginModal.title")}
      size="login"
      closeOnBackdrop={false}
      closeOnEscape={false}
      hideHeader
    >
      <div class="login-modal-body">
        <div class="login-modal-logo" aria-hidden="true">
          <IconLogo />
        </div>
        <SegmentedTabs
          value={activeTab()}
          onChange={(next) => {
            setSpecialMode(null);
            setActiveTab(next as LoginTab);
          }}
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
          <section class="login-modal-section" hidden={specialMode() !== null}>
            <div class="login-modal-qr">
              <Show
                when={qrLogin.session()?.imageUrl}
                fallback={
                  <div class="login-modal-qr-placeholder">
                    {qrLogin.isCreating()
                      ? t("ncm.loginModal.qr.status.creating")
                      : t("ncm.loginModal.qr.status.idle")}
                  </div>
                }
              >
                {(imageUrl) => (
                  <div
                    class={`login-modal-qr-frame${qrLogin.session()?.phase === "scanned" ? " is-scanned" : ""}`}
                  >
                    <img
                      src={imageUrl()}
                      alt={t("ncm.login.qr.alt")}
                      class="login-modal-qr-image"
                    />
                    <Show when={qrLogin.session()?.phase === "scanned"}>
                      <div class="login-modal-scan-user">
                        <Show
                          when={qrLogin.session()?.avatarUrl}
                          fallback={
                            <div class="login-modal-scan-avatar">
                              <IconLogo />
                            </div>
                          }
                        >
                          {(avatarUrl) => (
                            <img
                              src={`${avatarUrl().replace(/^http:/, "https:")}?param=100y100`}
                              alt=""
                              class="login-modal-scan-avatar"
                            />
                          )}
                        </Show>
                        <span>{qrLogin.session()?.nickname ?? t("ncm.loginModal.qr.status.scanned")}</span>
                      </div>
                    </Show>
                  </div>
                )}
              </Show>
              <div class="login-modal-qr-status">
                <Show when={qrLogin.session()}>
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
                class="login-modal-regenerate"
                onClick={() => void qrLogin.start()}
                disabled={qrLogin.isCreating()}
              >
                {qrLogin.session()
                  ? t("ncm.loginModal.qr.action.regenerate")
                  : t("ncm.loginModal.qr.action.start")}
              </button>
            </div>
          </section>
        </Show>

        <Show when={activeTab() === "phone"}>
          <section class="login-modal-section" hidden={specialMode() !== null}>
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
                  value={form.phoneCountryCode}
                  onInput={(event) => setForm("phoneCountryCode", event.currentTarget.value)}
                />
              </label>
              <label class="login-modal-field">
                <span>{t("ncm.loginModal.phone.label.phone")}</span>
                <input
                  type="tel"
                  class="text-input"
                  value={form.phoneNumber}
                  placeholder={t("ncm.loginModal.phone.placeholder.phone")}
                  onInput={(event) => setForm("phoneNumber", event.currentTarget.value)}
                />
              </label>

              <div class="login-modal-toggle" role="radiogroup">
                <label>
                  <input
                    type="radio"
                    name="phone-mode"
                    checked={form.phoneMode === "captcha"}
                    onChange={() => setForm("phoneMode", "captcha")}
                  />
                  <span>{t("ncm.loginModal.phone.mode.captcha")}</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="phone-mode"
                    checked={form.phoneMode === "password"}
                    onChange={() => setForm("phoneMode", "password")}
                  />
                  <span>{t("ncm.loginModal.phone.mode.password")}</span>
                </label>
              </div>

              <Show when={form.phoneMode === "captcha"}>
                <label class="login-modal-field">
                  <span>{t("ncm.loginModal.phone.label.captcha")}</span>
                  <div class="login-modal-row">
                    <input
                      type="text"
                      class="text-input"
                      value={form.phoneCaptcha}
                      placeholder={t("ncm.loginModal.phone.placeholder.captcha")}
                      onInput={(event) => setForm("phoneCaptcha", event.currentTarget.value)}
                    />
                    <button
                      type="button"
                      class="ghost-button"
                      onClick={() => void handleSendCaptcha()}
                      disabled={form.isSendingCaptcha || captchaCooldown() > 0}
                    >
                      {form.isSendingCaptcha
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

              <Show when={form.phoneMode === "password"}>
                <label class="login-modal-field">
                  <span>{t("ncm.loginModal.phone.label.password")}</span>
                  <input
                    type="password"
                    class="text-input"
                    value={form.phonePassword}
                    placeholder={t("ncm.loginModal.phone.placeholder.password")}
                    onInput={(event) => setForm("phonePassword", event.currentTarget.value)}
                  />
                </label>
              </Show>

              <button
                type="submit"
                class="primary-button login-modal-submit"
                disabled={form.isSubmittingPhone}
              >
                {form.isSubmittingPhone
                  ? t("ncm.loginModal.phone.action.submitting")
                  : t("ncm.loginModal.phone.action.submit")}
              </button>
            </form>
          </section>
        </Show>

        <Show when={specialMode() === "uid"}>
          <section class="login-modal-section login-modal-special">
            <div class="login-modal-help">{t("ncm.loginModal.uid.hint")}</div>
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
                  value={form.uidValue}
                  placeholder={t("ncm.loginModal.uid.placeholder")}
                  onInput={(event) => setForm("uidValue", event.currentTarget.value)}
                />
              </label>
              <button
                type="submit"
                class="primary-button login-modal-submit"
                disabled={form.isSubmittingUid}
              >
                {form.isSubmittingUid
                  ? t("ncm.loginModal.uid.action.submitting")
                  : t("ncm.loginModal.uid.action.submit")}
              </button>
            </form>
          </section>
        </Show>

        <Show when={specialMode() === "cookie"}>
          <section class="login-modal-section login-modal-special">
            <div class="login-modal-help">{t("ncm.loginModal.cookie.hint")}</div>
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
                  value={form.cookieValue}
                  placeholder={t("ncm.loginModal.cookie.placeholder")}
                  onInput={(event) => setForm("cookieValue", event.currentTarget.value)}
                />
              </label>
              <button
                type="submit"
                class="primary-button login-modal-submit"
                disabled={form.isSubmittingCookie}
              >
                {form.isSubmittingCookie
                  ? t("ncm.loginModal.cookie.action.submitting")
                  : t("ncm.loginModal.cookie.action.submit")}
              </button>
            </form>
          </section>
        </Show>

        <div class="login-modal-other">
          <button
            hidden={props.disableUid === true}
            type="button"
            class="login-modal-link-button"
            classList={{ "is-active": specialMode() === "uid" }}
            onClick={() => setSpecialMode(specialMode() === "uid" ? null : "uid")}
          >
            {t("ncm.loginModal.tab.uid")}
          </button>
          <span hidden={props.disableUid === true} class="login-modal-divider" aria-hidden="true" />
          <button
            type="button"
            class="login-modal-link-button"
            classList={{ "is-active": specialMode() === "cookie" }}
            onClick={() => setSpecialMode(specialMode() === "cookie" ? null : "cookie")}
          >
            {t("ncm.loginModal.tab.cookie")}
          </button>
        </div>

        <button type="button" class="login-modal-cancel" onClick={props.onClose}>
          <IconClose />
          {t("ncm.loginModal.action.cancel")}
        </button>
      </div>
    </Modal>
  );
}
