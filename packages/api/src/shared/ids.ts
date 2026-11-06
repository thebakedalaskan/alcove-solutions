import { z } from './zod';
export const IDSchema = z.string();

export type ID = z.infer<typeof IDSchema>;

export const ISODateSchema = z.string();

export type ISODate = z.infer<typeof ISODateSchema>;
