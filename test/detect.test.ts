import { describe, expect, it } from 'vitest'
import { fastFilter, looksSensitive, parseClassification } from '../src/detect.ts'

const PREFIXES = ['remember:', '记住:']

describe('fastFilter', () => {
  it('passes realistic correction prompts', () => {
    expect(fastFilter('不要用 npm，用 pnpm', 500, PREFIXES)).toEqual({
      pass: true,
      text: '不要用 npm，用 pnpm',
    })
    expect(fastFilter('以后代码注释都用中文写', 500, PREFIXES).pass).toBe(true)
  })

  it('drops acknowledgements and trivial replies', () => {
    for (const text of ['好的', 'ok', 'OK.', '继续', '收到！', 'thanks', '嗯嗯', '明白']) {
      expect(fastFilter(text, 500, PREFIXES).pass).toBe(false)
    }
  })

  it('keeps acknowledgement prefixes inside longer messages', () => {
    expect(fastFilter('好的，另外以后都用 pnpm', 500, PREFIXES).pass).toBe(true)
  })

  it('drops slash commands, explicit remember triggers, and overlong prompts', () => {
    expect(fastFilter('/reflect', 500, PREFIXES).pass).toBe(false)
    expect(fastFilter('remember: 用 pnpm', 500, PREFIXES).pass).toBe(false)
    expect(fastFilter('记住: 用 pnpm', 500, PREFIXES).pass).toBe(false)
    expect(fastFilter('x'.repeat(501), 500, PREFIXES).pass).toBe(false)
    expect(fastFilter('嗯', 500, PREFIXES).pass).toBe(false)
  })

  it('never passes content that looks like a secret', () => {
    expect(fastFilter('以后都用 sk-abc123def456ghijklmn 这个 key', 500, PREFIXES).pass).toBe(false)
    expect(fastFilter('api_key=abcd1234 记住', 500, PREFIXES).pass).toBe(false)
  })
})

describe('fastFilter pattern gate (detectPatternGate)', () => {
  it('is off by default: every short non-trivial prompt reaches the classifier', () => {
    expect(fastFilter('帮我看看这个函数', 500, PREFIXES).pass).toBe(true)
    expect(fastFilter('look at this function', 500, PREFIXES).pass).toBe(true)
  })

  it('drops prompts without correction wording when enabled', () => {
    expect(fastFilter('帮我看看这个函数', 500, PREFIXES, true)).toEqual({
      pass: false,
      reason: 'no-correction-pattern',
    })
  })

  it('passes correction wording in both languages when enabled', () => {
    expect(fastFilter('不要用 npm，用 pnpm', 500, PREFIXES, true).pass).toBe(true)
    expect(fastFilter('以后价格都用分表示', 500, PREFIXES, true).pass).toBe(true)
    expect(fastFilter('always use pnpm in this repo', 500, PREFIXES, true).pass).toBe(true)
    expect(fastFilter('never commit the .env file', 500, PREFIXES, true).pass).toBe(true)
  })
})

describe('looksSensitive', () => {
  it('flags credentials and private keys', () => {
    expect(looksSensitive('token: ghp_0123456789abcdefghij')).toBe(true)
    expect(looksSensitive('-----BEGIN RSA PRIVATE KEY-----')).toBe(true)
    expect(looksSensitive('password = hunter2')).toBe(true)
  })

  it('ignores ordinary rules', () => {
    expect(looksSensitive('价格一律用分表示，不要用元')).toBe(false)
    expect(looksSensitive('commit message 用英文')).toBe(false)
  })
})

describe('parseClassification', () => {
  it('parses a valid verdict', () => {
    const parsed = parseClassification(
      '好的 {"is_rule": true, "rule": "使用 pnpm 而不是 npm", "scope_hint": "project", "confidence": 0.9}',
    )
    expect(parsed).toEqual({
      isRule: true,
      rule: '使用 pnpm 而不是 npm',
      scopeHint: 'project',
      confidence: 0.9,
    })
  })

  it('returns undefined for non-rules, garbage, and missing rules', () => {
    expect(parseClassification('{"is_rule": false, "rule": null, "confidence": 0.9}')).toBeUndefined()
    expect(parseClassification('not json at all')).toBeUndefined()
    expect(parseClassification('{"is_rule": true, "rule": "", "confidence": 1}')).toBeUndefined()
    expect(parseClassification('{"is_rule": true, "rule": "x" ')).toBeUndefined()
  })

  it('clamps confidence and rejects unknown scope hints', () => {
    const parsed = parseClassification('{"is_rule": true, "rule": "r", "scope_hint": "home", "confidence": 5}')
    expect(parsed?.scopeHint).toBeNull()
    expect(parsed?.confidence).toBe(1)
  })
})
