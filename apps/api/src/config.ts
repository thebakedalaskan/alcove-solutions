import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  OBJECTS_ENDPOINT: z.string().url(),
  OBJECTS_BUCKET: z.string().min(3),
  OBJECTS_ACCESS_KEY: z.string(),
  OBJECTS_SECRET_KEY: z.string(),
  API_PORT: z.coerce.number().int().default(8787),
  /** 127.0.0.1 locally; 0.0.0.0 in a container. */
  API_HOST: z.string().default('127.0.0.1'),
  WEB_ORIGIN: z.string().url(),
  RP_ID: z.string(),
  KSERVICE: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'KSERVICE must be 32 bytes, base64url'),
  NEAR_AI_API_KEY: z.string().optional(),
  NEAR_AI_BASE_URL: z.string().url().default('https://cloud-api.near.ai/v1')
});
export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Record<keyof Config, string>> = {}): Config {
  const r = EnvSchema.safeParse({ ...env, ...overrides });
  if (!r.success) throw new Error(`Invalid environment:\n${r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  return r.data;
}
