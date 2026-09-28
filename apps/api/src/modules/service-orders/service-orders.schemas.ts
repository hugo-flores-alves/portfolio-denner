import { z } from 'zod';
import { SERVICE_ORDER_STATUSES } from '@erp/shared';
import { paginationSchema } from '../../lib/pagination';
import { centsSchema, optionalText, uuidSchema } from '../../lib/validation';
import { customerInputSchema } from '../customers/customers.routes';

export const serviceOrderItemSchema = z.object({
  productId: uuidSchema,
  quantity: z.number().int().min(1).max(999),
  /** Se omitido, usa o preço de venda atual do produto. */
  unitPriceCents: centsSchema.optional(),
});

const baseFields = {
  technicianId: uuidSchema.nullish(),
  deviceBrand: optionalText(60),
  deviceModel: z.string().trim().min(2, 'Informe o modelo do aparelho').max(120),
  deviceSerial: optionalText(40),
  deviceCondition: optionalText(1000),
  accessories: optionalText(500),
  reportedDefect: z.string().trim().min(3, 'Descreva o defeito relatado').max(2000),
  diagnosis: optionalText(4000),
  notes: optionalText(4000),
  laborCents: centsSchema,
  discountCents: centsSchema,
  warrantyDays: z.number().int().min(0).max(3650),
  estimatedAt: z.coerce.date().nullish(),
  items: z.array(serviceOrderItemSchema).max(100),
};

export const createServiceOrderSchema = z
  .object({
    ...baseFields,
    storeId: uuidSchema.optional(),
    customerId: uuidSchema.optional(),
    /** Cadastro rápido do cliente no balcão (alternativa a customerId). */
    customer: customerInputSchema.optional(),
    laborCents: baseFields.laborCents.default(0),
    discountCents: baseFields.discountCents.default(0),
    warrantyDays: baseFields.warrantyDays.default(90),
    items: baseFields.items.default([]),
  })
  .refine((d) => d.customerId || d.customer, { message: 'Informe o cliente', path: ['customerId'] });

export const updateServiceOrderSchema = z
  .object({ ...baseFields, customerId: uuidSchema })
  .partial();

export const changeStatusSchema = z.object({
  status: z.enum(SERVICE_ORDER_STATUSES),
  note: optionalText(1000),
});

export const listServiceOrdersSchema = paginationSchema.extend({
  storeId: uuidSchema.optional(),
  /** Um ou mais status separados por vírgula. */
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(SERVICE_ORDER_STATUSES))),
  search: z.string().trim().optional(),
  technicianId: uuidSchema.optional(),
  customerId: uuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreateServiceOrderInput = z.infer<typeof createServiceOrderSchema>;
export type UpdateServiceOrderInput = z.infer<typeof updateServiceOrderSchema>;
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;
export type ListServiceOrdersInput = z.infer<typeof listServiceOrdersSchema>;
