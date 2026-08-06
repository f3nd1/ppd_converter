import 'dotenv/config'
import { z } from 'zod'

// Every secret enters the process here and nowhere else. Nothing in this module
// is ever logged or returned in a response — see logger.ts's redaction list.

// The brief restricts the model to the GPT-5 family or later and forbids
// hardcoding a name. This accepts gpt-5* and any higher integer generation, so
// a future gpt-6 works without a code change while gpt-4 is refused.
const MODEL_RE = /^(?:gpt-(?:[5-9]|\d{2,})|o[5-9])(?:[.-].*)?$/i

export function isSupportedModel(model: string): boolean {
  return MODEL_RE.test(model.trim())
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(4020),
  DATABASE_URL: z.string().default('file:./data/ppd.db'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z
    .string()
    .default('https://apps.unitedceres.edu.sg/ppd_converter/api/auth/google/callback'),
  ALLOWED_GOOGLE_EMAIL: z.string().default('felix@unitedceres.edu.sg'),

  // 32 bytes base64. Only validated when actually needed, so the app still
  // boots for local UI work before credentials exist.
  ENCRYPTION_KEY: z.string().default(''),
  SESSION_SECRET: z.string().default(''),

  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default(''),
  OPENAI_REQUEST_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
})

export type Env = z.infer<typeof schema>

export const env: Env = schema.parse(process.env)

/** Throws if OPENAI_MODEL is set to something outside the permitted families. */
export function assertModelAllowed(model: string): void {
  if (!isSupportedModel(model)) {
    throw new Error(
      `OPENAI_MODEL "${model}" is not permitted. It must be GPT-5 family or later ` +
        `(for example gpt-5, gpt-5-mini). No model name is hardcoded in source.`,
    )
  }
}

/** Which optional features are usable given what is configured. */
export function capabilities() {
  return {
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.ENCRYPTION_KEY),
    openai: Boolean(env.OPENAI_API_KEY && env.OPENAI_MODEL && isSupportedModel(env.OPENAI_MODEL)),
    session: Boolean(env.SESSION_SECRET && env.SESSION_SECRET.length >= 32),
  }
}
