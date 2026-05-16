import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { toString as toQrSvgString } from "qrcode/lib/browser.js";
import {
  checkLoginQr,
  createLoginQr,
  getLoginQrKey
} from "../../shared/api/ncm";

export type QrSessionPhase = "waiting" | "scanned" | "confirmed";

export interface QrLoginSession {
  key: string;
  imageUrl: string;
  phase: QrSessionPhase;
  nickname?: string | null;
  avatarUrl?: string | null;
}

export interface QrLoginFeedback {
  tone: "neutral" | "success" | "error";
  message: string;
}

export interface UseQrLoginSessionOptions {
  enabled: Accessor<boolean>;
  missingQrMessage: string;
  expiredMessage: string;
  sessionFailedMessage: (reason: string) => string;
  onFeedback: (feedback: QrLoginFeedback | null) => void;
  onCookieCaptured: (cookie: string) => Promise<void>;
}

const QR_POLL_INTERVAL_MS = 1000;
const NETEASE_QR_LOGIN_URL = "https://music.163.com/login?codekey=";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const buildNeteaseQrLoginUrl = (key: string): string =>
  `${NETEASE_QR_LOGIN_URL}${encodeURIComponent(key)}`;

export const createQrImageDataUrl = (value: string): Promise<string> =>
  toQrSvgString(value, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: 180,
    color: {
      dark: "#000000",
      light: "#ffffff"
    }
  }).then(
    (svg) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
  );

export const resolveLoginQrImageUrl = async (
  key: string,
  data: Record<string, unknown> | null
): Promise<string> => {
  const imageUrl = readString(data?.qrimg)?.trim();
  if (imageUrl) {
    return imageUrl;
  }

  const qrValue = readString(data?.qrurl)?.trim() || buildNeteaseQrLoginUrl(key);
  return createQrImageDataUrl(qrValue);
};

export interface QrAutoStartState {
  enabled: boolean;
  session: QrLoginSession | null;
  isCreating: boolean;
  hasAttemptedStart: boolean;
}

export function shouldAutoStartQrSession(state: QrAutoStartState): boolean {
  return (
    state.enabled &&
    !state.session &&
    !state.isCreating &&
    !state.hasAttemptedStart
  );
}

export function useQrLoginSession(options: UseQrLoginSessionOptions) {
  const [session, setSession] = createSignal<QrLoginSession | null>(null);
  const [isCreating, setIsCreating] = createSignal<boolean>(false);
  const [hasAttemptedStart, setHasAttemptedStart] = createSignal<boolean>(false);

  const reset = () => {
    setSession(null);
    setIsCreating(false);
    setHasAttemptedStart(false);
  };

  const start = async () => {
    setHasAttemptedStart(true);
    setIsCreating(true);
    try {
      const keyResponse = await getLoginQrKey();
      const key =
        readString(isRecord(keyResponse.data) ? keyResponse.data.unikey : null) ??
        readString(keyResponse.unikey);
      if (!key) {
        throw new Error(options.missingQrMessage);
      }

      const qrResponse = await createLoginQr(key, true);
      const data = isRecord(qrResponse.data) ? qrResponse.data : null;
      const imageUrl = await resolveLoginQrImageUrl(key, data);
      if (!imageUrl) {
        throw new Error(options.missingQrMessage);
      }

      setSession({ key, imageUrl, phase: "waiting" });
      options.onFeedback(null);
    } catch (error) {
      options.onFeedback({ tone: "error", message: readErrorMessage(error) });
    } finally {
      setIsCreating(false);
    }
  };

  createEffect(() => {
    const current = session();
    if (!options.enabled() || !current || current.phase === "confirmed") return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await checkLoginQr(current.key);
        if (cancelled) return;

        const code = readNumber(response.code);
        if (code === 800) {
          setSession(null);
          options.onFeedback({ tone: "error", message: options.expiredMessage });
          return;
        }
        if (code === 801) {
          setSession((prev) => (prev ? { ...prev, phase: "waiting" } : prev));
          return;
        }
        if (code === 802) {
          const nickname = readString(response.nickname);
          const avatarUrl = readString(response.avatarUrl);
          setSession((prev) =>
            prev ? { ...prev, phase: "scanned", nickname, avatarUrl } : prev
          );
          return;
        }
        if (code === 803) {
          const cookie = readString(response.cookie) ?? "";
          if (!cookie) {
            throw new Error(options.missingQrMessage);
          }
          await options.onCookieCaptured(cookie);
          setSession((prev) => (prev ? { ...prev, phase: "confirmed" } : prev));
        }
      } catch (error) {
        if (cancelled) return;
        setSession(null);
        options.onFeedback({
          tone: "error",
          message: options.sessionFailedMessage(readErrorMessage(error))
        });
      }
    }, QR_POLL_INTERVAL_MS);

    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
    });
  });

  createEffect(() => {
    if (
      !shouldAutoStartQrSession({
        enabled: options.enabled(),
        session: session(),
        isCreating: isCreating(),
        hasAttemptedStart: hasAttemptedStart()
      })
    ) {
      return;
    }
    void start();
  });

  return {
    session,
    isCreating,
    start,
    reset
  };
}
