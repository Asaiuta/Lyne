import { requestNcm, type NcmResponseEnvelope } from "./base";

export interface NcmQrKeyData {
  unikey?: string;
  [key: string]: unknown;
}

export interface NcmQrCreateData {
  qrurl?: string;
  qrimg?: string;
  [key: string]: unknown;
}

export interface NcmLoginStatusData {
  account?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/**
 * Parameters for `/captcha/sent` and `/captcha/verify`.
 *
 * Key names match the backend `query.get("...")` lookups in
 * `ncm-api-rs/src/api/captcha_sent.rs` / `captcha_verify.rs` exactly —
 * do NOT rename to camelCase or the values will be silently dropped.
 */
export interface NcmCaptchaSentParams {
  phone: string;
  ctcode?: string;
}

export interface NcmCaptchaVerifyParams {
  phone: string;
  captcha: string;
  ctcode?: string;
}

/**
 * Parameters for `/login/cellphone`.
 *
 * Backend behaviour (see `ncm-api-rs/src/api/login_cellphone.rs`):
 *  - When `captcha` is set, password is auto-set to the captcha and used as one-time auth.
 *  - Otherwise, `md5_password` (32-char hex) takes precedence over `password` (plaintext, hashed by backend).
 *  - `countrycode` defaults to `"86"` (CN).
 */
export interface NcmLoginCellphoneParams {
  phone: string;
  password?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- backend key
  md5_password?: string;
  captcha?: string;
  countrycode?: string;
}

export const getLoginQrKey = () =>
  requestNcm<NcmQrKeyData>("login/qr/key", {
    method: "POST",
    noCache: true
  });

export const createLoginQr = (key: string, qrimg = true) =>
  requestNcm<NcmQrCreateData>("login/qr/create", {
    method: "POST",
    params: { key, qrimg },
    noCache: true
  });

export const checkLoginQr = (key: string) =>
  requestNcm("login/qr/check", {
    method: "POST",
    params: { key },
    noCache: true
  });

export const getLoginStatus = () =>
  requestNcm<NcmLoginStatusData>("login/status", {
    method: "POST",
    noCache: true
  });

export const refreshLogin = () =>
  requestNcm("login/refresh", {
    method: "POST",
    noCache: true
  });

export const logout = (): Promise<NcmResponseEnvelope> =>
  requestNcm("logout", {
    method: "POST",
    noCache: true
  });

/**
 * Send an SMS verification code to a phone number.
 * Backend route: `/captcha/sent` → `captcha_sent` dispatch arm.
 */
export const sentCaptcha = (
  params: NcmCaptchaSentParams
): Promise<NcmResponseEnvelope> =>
  requestNcm("captcha/sent", {
    method: "POST",
    data: params,
    noCache: true
  });

/**
 * Verify the SMS code returned to the user.
 * Backend route: `/captcha/verify` → `captcha_verify` dispatch arm.
 */
export const verifyCaptcha = (
  params: NcmCaptchaVerifyParams
): Promise<NcmResponseEnvelope> =>
  requestNcm("captcha/verify", {
    method: "POST",
    data: params,
    noCache: true
  });

/**
 * Phone-number login. Either `password` / `md5_password` or `captcha` must be present.
 * Returns the same `account` + `profile` envelope as `/login/status`.
 * Backend route: `/login/cellphone` → `login_cellphone` dispatch arm.
 */
export const loginCellphone = (
  params: NcmLoginCellphoneParams
): Promise<NcmResponseEnvelope<NcmLoginStatusData>> =>
  requestNcm<NcmLoginStatusData>("login/cellphone", {
    method: "POST",
    data: params,
    noCache: true
  });
