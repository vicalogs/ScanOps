export const SUPPORTED_FORMATS = ['QRCode', 'Code128', 'Code39', 'Code93', 'EAN13', 'EAN8', 'UPCA', 'UPCE', 'ITF', 'Codabar'] as const;
export type BarcodeFormat = typeof SUPPORTED_FORMATS[number];
export const DEFAULT_FORMATS: readonly BarcodeFormat[] = Object.freeze([...SUPPORTED_FORMATS]);
export function validateFormats(formats: readonly BarcodeFormat[]): BarcodeFormat[] {
  if (!Array.isArray(formats) || !formats.length || formats.some(format => !SUPPORTED_FORMATS.includes(format))) throw new TypeError('formats must contain supported barcode formats');
  return [...new Set(formats)];
}
