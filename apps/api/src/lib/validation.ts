import { z } from 'zod';

export const uuidSchema = z.uuid({ message: 'Identificador inválido' });
export const idParamsSchema = z.object({ id: uuidSchema });

/** Texto opcional: string vazia vira null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const centsSchema = z.number().int('Valor deve estar em centavos (inteiro)').min(0);

/** Remove tudo que não é dígito (CPF, CNPJ, telefone). */
export const digitsOnly = (max: number) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v.replace(/\D/g, '') : null))
    .refine((v) => v === null || v.length <= max, `Máximo de ${max} dígitos`)
    .transform((v) => (v ? v : null));

/** Boolean vindo de querystring ("true"/"1"). */
export const queryBoolean = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1');
