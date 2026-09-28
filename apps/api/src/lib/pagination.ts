import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function toLimitOffset({ page, pageSize }: PaginationInput) {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}
