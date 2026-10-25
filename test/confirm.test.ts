import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { confirmRule, confirmRuleSafe } from '../src/confirm.ts'

const AGENT = { id: 'session-1' } as never

function fakeContext(ask: (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>): Context {
  return {
    get: (key: string) => (key === 'userQuestions' ? { ask } : undefined),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  } as unknown as Context
}

function answerFor(entries: Array<{ id: string; selected?: string[]; custom?: string }>): AskUserQuestionAnswer {
  return {
    answers: entries.map(entry => ({
      id: entry.id,
      selected: entry.selected ?? [],
      ...(entry.custom !== undefined ? { custom: entry.custom } : {}),
    })),
  }
}

describe('confirmRule', () => {
  it('saves globally when the first option is chosen', async () => {
    const seen: AskUserQuestionRequest[] = []
    const ctx = fakeContext(async request => {
      seen.push(request)
      return answerFor([{ id: 'dsh-reflect-save', selected: ['保存到全局'] }])
    })
    const outcome = await confirmRule(ctx, AGENT, new AbortController().signal, '使用 pnpm', 'zh')
    expect(outcome).toEqual({ action: 'save', rule: '使用 pnpm', scope: 'global' })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.questions[0]!.options?.map(option => option.label)).toEqual([
      '保存到全局',
      '保存到当前项目',
      '编辑后保存…',
      '跳过',
    ])
  })

  it('saves to the project scope', async () => {
    const ctx = fakeContext(async () => answerFor([{ id: 'dsh-reflect-save', selected: ['保存到当前项目'] }]))
    const outcome = await confirmRule(ctx, AGENT, new AbortController().signal, '使用 pnpm', 'zh')
    expect(outcome).toEqual({ action: 'save', rule: '使用 pnpm', scope: 'project' })
  })

  it('skips on the skip option and on dismissal', async () => {
    const skip = fakeContext(async () => answerFor([{ id: 'dsh-reflect-save', selected: ['跳过'] }]))
    expect(await confirmRule(skip, AGENT, new AbortController().signal, 'x', 'zh')).toMatchObject({ action: 'skip' })
    const dismissed = fakeContext(async () => answerFor([{ id: 'dsh-reflect-save', selected: [] }]))
    expect(await confirmRule(dismissed, AGENT, new AbortController().signal, 'x', 'zh')).toMatchObject({ action: 'skip' })
  })

  it('runs a second round for the edit branch with rewritten text and scope', async () => {
    const requests: AskUserQuestionRequest[] = []
    const ctx = fakeContext(async request => {
      requests.push(request)
      if (requests.length === 1) {
        return answerFor([{ id: 'dsh-reflect-save', selected: ['编辑后保存…'] }])
      }
      return answerFor([
        { id: 'dsh-reflect-rule', custom: '本项目一律使用 pnpm，禁止 npm' },
        { id: 'dsh-reflect-scope', selected: ['保存到当前项目'] },
      ])
    })
    const outcome = await confirmRule(ctx, AGENT, new AbortController().signal, '使用 pnpm', 'zh')
    expect(outcome).toEqual({ action: 'save', rule: '本项目一律使用 pnpm，禁止 npm', scope: 'project' })
    expect(requests[1]!.questions.map(question => question.id)).toEqual(['dsh-reflect-rule', 'dsh-reflect-scope'])
  })

  it('treats a round-one custom answer as edited rule text', async () => {
    const requests: AskUserQuestionRequest[] = []
    const ctx = fakeContext(async request => {
      requests.push(request)
      if (requests.length === 1) {
        return answerFor([{ id: 'dsh-reflect-save', custom: '改写后的规则' }])
      }
      return answerFor([{ id: 'dsh-reflect-rule', selected: ['保持原文'] }, { id: 'dsh-reflect-scope', selected: ['保存到全局'] }])
    })
    const outcome = await confirmRule(ctx, AGENT, new AbortController().signal, '原始规则', 'zh')
    expect(outcome).toEqual({ action: 'save', rule: '改写后的规则', scope: 'global' })
  })

  it('keeps the original text when the edit round selects 保持原文', async () => {
    const requests: AskUserQuestionRequest[] = []
    const ctx = fakeContext(async request => {
      requests.push(request)
      if (requests.length === 1) return answerFor([{ id: 'dsh-reflect-save', selected: ['编辑后保存…'] }])
      return answerFor([{ id: 'dsh-reflect-rule', selected: ['保持原文'] }, { id: 'dsh-reflect-scope', selected: ['保存到全局'] }])
    })
    const outcome = await confirmRule(ctx, AGENT, new AbortController().signal, '原始规则', 'zh')
    expect(outcome).toEqual({ action: 'save', rule: '原始规则', scope: 'global' })
  })

  it('uses English copy in the en locale', async () => {
    let question = ''
    const ctx = fakeContext(async request => {
      question = request.questions[0]!.question
      return answerFor([{ id: 'dsh-reflect-save', selected: ['Skip'] }])
    })
    const outcome = await confirmRule(ctx, AGENT, new AbortController().signal, 'rule', 'en')
    expect(outcome).toMatchObject({ action: 'skip' })
    expect(question).toBe('Save this correction as a permanent rule?')
  })
})

describe('confirmRuleSafe', () => {
  it('maps UserQuestionError codes to a silent skip', async () => {
    const ctx = fakeContext(async () => {
      throw Object.assign(new Error('not live'), { code: 'CALLER_NOT_LIVE' })
    })
    const outcome = await confirmRuleSafe(ctx, AGENT, new AbortController().signal, 'x', 'zh')
    expect(outcome).toMatchObject({ action: 'skip', reason: 'CALLER_NOT_LIVE' })
  })
})
