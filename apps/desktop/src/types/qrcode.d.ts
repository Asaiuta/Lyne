declare module "qrcode" {
  export interface QRCodeToDataURLOptions {
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    margin?: number;
    width?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  }

  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions
  ): Promise<string>;
}

declare module "qrcode/lib/browser.js" {
  import type { QRCodeToDataURLOptions } from "qrcode";

  export function toString(
    text: string,
    options?: QRCodeToDataURLOptions
  ): Promise<string>;
}
