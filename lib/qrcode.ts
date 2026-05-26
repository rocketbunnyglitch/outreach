/**
 * QR code generation. Returns SVG strings that can be embedded directly
 * into print-friendly HTML pages.
 *
 * Use `qrcode.toString(data, { type: "svg" })` for SVG (scales perfectly
 * for print, no rasterization loss).
 */

import QRCode from "qrcode";

export interface QrOptions {
  size?: number; // pixels for the SVG viewBox (default 200)
  errorCorrection?: "L" | "M" | "Q" | "H"; // default "M"
  /** Margin in modules (the QR cells), not pixels. Default 1. */
  margin?: number;
}

export async function generateQrSvg(data: string, opts: QrOptions = {}): Promise<string> {
  const svg = await QRCode.toString(data, {
    type: "svg",
    width: opts.size ?? 200,
    margin: opts.margin ?? 1,
    errorCorrectionLevel: opts.errorCorrection ?? "M",
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
  return svg;
}
