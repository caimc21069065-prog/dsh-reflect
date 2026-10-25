import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { extractRememberRule, messageText } from '../src/text.ts'

function userMessage(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('messageText', () => {
  it('joins text blocks and trims', () => {
    const message = createUserMessage({
      content: [
        { type: 'text', text: '第一段 ' },
        { type: 'text', text: '第二段' },
      ],
      source: { kind: 'user' },
    })
    expect(messageText(message)).toBe('第一段 第二段')
  })
})

describe('extractRememberRule', () => {
  const prefixes = ['remember:', '记住:', '记住：']

  it('extracts the payload after the prefix', () => {
    expect(extractRememberRule(userMessage('remember: 本项目用 pnpm'), prefixes)).toBe('本项目用 pnpm')
    expect(extractRememberRule(userMessage('记住：价格用分表示'), prefixes)).toBe('价格用分表示')
    expect(extractRememberRule(userMessage('记住: 价格用分表示'), prefixes)).toBe('价格用分表示')
    expect(extractRememberRule(userMessage('  REMEMBER: keep it short'), prefixes)).toBe('keep it short')
  })

  it('returns undefined for non-trigger or empty-payload messages', () => {
    expect(extractRememberRule(userMessage('使用 pnpm'), prefixes)).toBeUndefined()
    expect(extractRememberRule(userMessage('remember:'), prefixes)).toBeUndefined()
    expect(extractRememberRule(userMessage('remember:   '), prefixes)).toBeUndefined()
    expect(extractRememberRule(userMessage('请 remember: 这个'), prefixes)).toBeUndefined()
  })
})
