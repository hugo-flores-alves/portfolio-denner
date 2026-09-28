/** Normalização e validação de identificadores de produto (usadas no CRUD e na importação). */
import { z } from 'zod';

/** SKU: sem espaços nas pontas, maiúsculo, espaços internos colapsados. */
export function normalizeSku(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Código de barras: remove espaços. */
export function normalizeBarcode(raw: string): string {
  return raw.replace(/\s+/g, '');
}

export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9 ._\-/#+]*$/;
export const BARCODE_PATTERN = /^[0-9A-Za-z.\-]+$/;

export const skuSchema = z
  .string()
  .transform(normalizeSku)
  .pipe(
    z
      .string()
      .min(1, 'Informe o SKU')
      .max(64, 'SKU deve ter no máximo 64 caracteres')
      .regex(SKU_PATTERN, 'SKU contém caracteres inválidos (use letras, números, espaço e . _ - / # +)'),
  );

export const barcodeSchema = z
  .string()
  .nullish()
  .transform((v) => (v ? normalizeBarcode(v) : null))
  .pipe(
    z
      .string()
      .max(64, 'Código de barras deve ter no máximo 64 caracteres')
      .regex(BARCODE_PATTERN, 'Código de barras contém caracteres inválidos')
      .nullable(),
  )
  .transform((v) => v || null);
