import OpenAI from 'openai'
import type { z } from 'zod'
import { assertModelAllowed, env } from '../env.ts'
import { toJsonSchema } from './schemas.ts'

// One place that talks to OpenAI. The key exists server-side only, never reaches
// a response body, and is never logged.
//
// The official SDK rather than raw fetch specifically because the brief requires
// storing provider request ids and usage — the SDK exposes `_request_id`, which
// a hand-rolled fetch client would have to dig out of headers.

export class AIError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable = false) {
    super(message)
    this.name = 'AIError'
    this.retryable = retryable
  }
}

export type AICallResult<T> = {
  data: T
  model: string
  providerRequestId: string | null
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null
}

export type StructuredArgs<T> = {
  schema: z.ZodType<T>
  schemaName: string
  system: string
  user: string
}

export type AIClient = {
  structured<T>(args: StructuredArgs<T>): Promise<AICallResult<T>>
}

/** Real client. Tests inject a fake instead — no test ever needs a real key. */
export function makeAIClient(): AIClient {
  if (!env.OPENAI_API_KEY) throw new AIError('OPENAI_API_KEY is not set.')
  assertModelAllowed(env.OPENAI_MODEL)

  const openai = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: env.OPENAI_REQUEST_TIMEOUT_SECONDS * 1000,
    // Retries are bounded and configured — never unlimited.
    maxRetries: env.OPENAI_MAX_RETRIES,
  })

  return {
    async structured<T>({
      schema,
      schemaName,
      system,
      user,
    }: StructuredArgs<T>): Promise<AICallResult<T>> {
      const completion = await openai.chat.completions
        .create({
          model: env.OPENAI_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: schemaName, strict: true, schema: toJsonSchema(schema) },
          },
        })
        .withResponse()

      const body = completion.data
      const content = body.choices[0]?.message?.content
      if (typeof content !== 'string') {
        throw new AIError('OpenAI returned no message content.', true)
      }

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(content)
      } catch {
        throw new AIError('OpenAI returned content that is not valid JSON.', true)
      }

      // The schema constrains the shape; this re-validates it on receipt.
      // Output that fails is REJECTED, never repaired — a silently patched-up
      // validation result is worse than an honest failure.
      const result = schema.safeParse(parsedJson)
      if (!result.success) {
        throw new AIError(
          `OpenAI output did not match the ${schemaName} schema: ${result.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.')} ${i.message}`)
            .join('; ')}`,
          true,
        )
      }

      return {
        data: result.data,
        model: body.model,
        // Stored for traceability. Secret headers are never captured.
        providerRequestId: completion.response.headers.get('x-request-id'),
        usage: body.usage
          ? {
              promptTokens: body.usage.prompt_tokens ?? 0,
              completionTokens: body.usage.completion_tokens ?? 0,
              totalTokens: body.usage.total_tokens ?? 0,
            }
          : null,
      }
    },
  }
}

/**
 * Bounded retry around a structured call. Deliberately not infinite: after
 * OPENAI_MAX_RETRIES the job fails with an error reference rather than looping.
 */
export async function withBoundedRetry<T>(
  fn: () => Promise<T>,
  maxRetries = env.OPENAI_MAX_RETRIES,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const retryable = err instanceof AIError ? err.retryable : false
      if (!retryable || attempt === maxRetries) break
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }
  }
  throw lastError
}
