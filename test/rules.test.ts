import { describe, expect, it } from 'vitest'
import {
  SECTION_END,
  SECTION_START,
  findRule,
  normalizeRule,
  parseRuleSection,
  upsertRule,
} from '../src/rules.ts'

describe('parseRuleSection', () => {
  it('reports absence when no markers exist', () => {
    expect(parseRuleSection('# My project\n\nSome notes.\n')).toEqual({ status: 'absent' })
    expect(parseRuleSection('')).toEqual({ status: 'absent' })
  })

  it('reports corruption for unbalanced markers', () => {
    expect(parseRuleSection(`${SECTION_START}\n- a\n`)).toEqual({ status: 'corrupt' })
    expect(parseRuleSection(`${SECTION_END}\n`)).toEqual({ status: 'corrupt' })
    expect(parseRuleSection(`${SECTION_END}\nfoo\n${SECTION_START}\n`)).toEqual({ status: 'corrupt' })
  })

  it('reads rule lines out of an intact section', () => {
    const file = [
      '# Intro',
      '',
      SECTION_START,
      '## Learned rules',
      '',
      '- 本项目使用 pnpm，不使用 npm',
      '- 价格一律用分表示',
      '',
      SECTION_END,
      '',
      'Trailing prose stays.',
    ].join('\n')
    const parsed = parseRuleSection(file)
    expect(parsed).toEqual({
      status: 'ok',
      rules: ['本项目使用 pnpm，不使用 npm', '价格一律用分表示'],
    })
  })
})

describe('upsertRule', () => {
  it('creates a fresh file when content is missing', () => {
    const result = upsertRule(undefined, '本项目使用 pnpm')
    expect(result.status).toBe('added')
    expect(result.content).toBe(
      `${SECTION_START}\n## Learned rules\n\n- 本项目使用 pnpm\n\n${SECTION_END}\n`,
    )
  })

  it('appends a new section to an existing file without markers', () => {
    const result = upsertRule('# Project\n', '使用中文回复')
    expect(result.status).toBe('added')
    expect(result.content.startsWith('# Project\n\n')).toBe(true)
    expect(result.content).toContain(SECTION_START)
    expect(result.content).toContain('- 使用中文回复')
    expect(result.content.endsWith(`${SECTION_END}\n`)).toBe(true)
  })

  it('appends a rule to an existing section', () => {
    const existing = `${SECTION_START}\n## Learned rules\n\n- 规则甲\n\n${SECTION_END}\n`
    const result = upsertRule(existing, '规则乙')
    expect(result.status).toBe('added')
    expect(result.content).toContain('- 规则甲\n- 规则乙\n')
  })

  it('does not duplicate an existing rule (whitespace/case insensitive)', () => {
    const existing = `${SECTION_START}\n## Learned rules\n\n- Use pnpm\n\n${SECTION_END}\n`
    expect(upsertRule(existing, 'use pnpm').status).toBe('duplicate')
    expect(upsertRule(existing, '  use   pnpm  ').status).toBe('duplicate')
    expect(upsertRule(existing, 'use pnpm').content).toBe(existing)
  })

  it('refuses to touch a corrupt section', () => {
    const corrupt = `${SECTION_START}\n- broken\n`
    const result = upsertRule(corrupt, 'anything')
    expect(result.status).toBe('corrupt')
    expect(result.added).toBe(false)
    expect(result.content).toBe(corrupt)
  })

  it('flattens a multi-line rule into a single bullet', () => {
    const result = upsertRule(undefined, '用 pnpm\n- 也不要用 yarn')
    expect(result.status).toBe('added')
    expect(result.content).toContain('- 用 pnpm - 也不要用 yarn')
    expect(result.content.match(/^- /gm)).toHaveLength(1)
    expect(parseRuleSection(result.content)).toEqual({
      status: 'ok',
      rules: ['用 pnpm - 也不要用 yarn'],
    })
  })

  it('treats a duplicated managed section as corrupt', () => {
    const twice = `${SECTION_START}\n- a\n\n${SECTION_END}\n\n${SECTION_START}\n- b\n\n${SECTION_END}\n`
    expect(parseRuleSection(twice)).toEqual({ status: 'corrupt' })
    expect(upsertRule(twice, 'x')).toMatchObject({ status: 'corrupt', added: false })
  })

  it('preserves prose before and after the section', () => {
    const existing = ['# Title', '', 'body', '', SECTION_START, '', '- a', '', SECTION_END, '', 'footer'].join('\n')
    const result = upsertRule(existing, 'b')
    expect(result.content.startsWith('# Title\n\nbody\n\n')).toBe(true)
    expect(result.content.endsWith('- a\n- b\n\n' + SECTION_END + '\n\nfooter')).toBe(true)
  })
})

describe('findRule/normalizeRule', () => {
  it('normalizes whitespace and case', () => {
    expect(normalizeRule(' A   b\tc ')).toBe('a b c')
    expect(findRule(['使用 pnpm'], '使用  pnpm')).toBe('使用 pnpm')
    expect(findRule(['使用 pnpm'], '使用 yarn')).toBeUndefined()
  })
})
