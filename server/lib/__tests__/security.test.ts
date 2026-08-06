import { describe, expect, it } from 'vitest'
import { REDACTED, redact, redactString } from '../logger.ts'
import { isSupportedModel } from '../env.ts'
import { assertWritableTarget, SourceProtectionError } from '../migration/worker.ts'

describe('log redaction', () => {
  it('redacts a value under a secret-looking key', () => {
    const out = redact({ apiKey: 'sk-abcdef', refresh_token: 'x', client_secret: 'y' }) as Record<
      string,
      unknown
    >
    expect(out.apiKey).toBe(REDACTED)
    expect(out.refresh_token).toBe(REDACTED)
    expect(out.client_secret).toBe(REDACTED)
  })

  it('redacts secret shapes that appear inside free text', () => {
    expect(redactString('key is sk-ABCDEFGHIJKLMNOPQRST')).not.toContain('ABCDEFGHIJKLMNOPQRST')
    expect(redactString('secret GOCSPX-abcdefghijkl')).toContain(REDACTED)
    expect(redactString('token ya29.abcdefghijklmnop')).toContain(REDACTED)
    expect(redactString('Authorization: Bearer abcdefghijklmnop')).toContain(REDACTED)
  })

  it('redacts nested structures', () => {
    const out = redact({ outer: { inner: { accessToken: 'ya29.secret' } } }) as {
      outer: { inner: { accessToken: string } }
    }
    expect(out.outer.inner.accessToken).toBe(REDACTED)
  })

  it('leaves ordinary values alone', () => {
    expect(redact({ documentId: 'abc', count: 3 })).toEqual({ documentId: 'abc', count: 3 })
  })

  it('does not recurse forever on a cyclic object', () => {
    const cyclic: Record<string, unknown> = { name: 'x' }
    cyclic.self = cyclic
    expect(() => redact(cyclic)).not.toThrow()
  })
})

describe('OPENAI_MODEL restriction', () => {
  it('accepts the GPT-5 family', () => {
    expect(isSupportedModel('gpt-5')).toBe(true)
    expect(isSupportedModel('gpt-5-mini')).toBe(true)
    expect(isSupportedModel('gpt-5.1-turbo')).toBe(true)
  })

  it('accepts a later generation without a code change', () => {
    expect(isSupportedModel('gpt-6')).toBe(true)
    expect(isSupportedModel('gpt-10-mini')).toBe(true)
  })

  it('REJECTS anything older than GPT-5', () => {
    expect(isSupportedModel('gpt-4o')).toBe(false)
    expect(isSupportedModel('gpt-4o-mini')).toBe(false)
    expect(isSupportedModel('gpt-3.5-turbo')).toBe(false)
  })

  it('rejects an empty or nonsense model name', () => {
    expect(isSupportedModel('')).toBe(false)
    expect(isSupportedModel('claude-opus')).toBe(false)
  })
})

describe('source document protection', () => {
  it('refuses to write when the target IS the source', () => {
    expect(() => assertWritableTarget('sameId', 'sameId')).toThrow(SourceProtectionError)
  })

  it('refuses to write with no target id', () => {
    expect(() => assertWritableTarget('', 'sourceId')).toThrow(SourceProtectionError)
  })

  it('allows a genuine target', () => {
    expect(() => assertWritableTarget('targetId', 'sourceId')).not.toThrow()
  })

  it('says plainly why it refused', () => {
    expect(() => assertWritableTarget('x', 'x')).toThrow(/SOURCE document/)
  })
})
