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
  /** The API as browsers reach it, e.g. https://api.alcove.solutions, or http://localhost:3000/api behind the dev proxy. Google returns here. */
  API_URL: z.string().url(),
  /** Sign-in with Google. Without both, the Google button explains that it isn't set up here. */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  /** Google's OpenID Connect issuer. Tests point it at a local stand-in (src/testing/fake-google.ts). */
  GOOGLE_ISSUER: z.string().url().default('https://accounts.google.com'),
  /** Google's APIs (Calendar). Tests point it at the same local stand-in. */
  GOOGLE_API_URL: z.string().url().default('https://www.googleapis.com'),
  /** Wraps every account's root key. Production: released only to the attested confidential VM. */
  KMASTER: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'KMASTER must be 32 bytes, base64url'),
  /** Seals billing state. Separate from KMASTER: billing never needs owner keys. */
  KSERVICE: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'KSERVICE must be 32 bytes, base64url'),
  NEAR_AI_API_KEY: z.string().optional(),
  NEAR_AI_BASE_URL: z.string().url().default('https://cloud-api.near.ai/v1'),
  /** debug | info | warn | error | silent. */
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  /** json for log collectors (Cloud Run), pretty for a terminal. */
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty')
});
export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Record<keyof Config, string>> = {}): Config {
  const r = EnvSchema.safeParse({ ...env, ...overrides });
  if (!r.success) throw new Error(`Invalid environment:\n${r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  return r.data;
}
