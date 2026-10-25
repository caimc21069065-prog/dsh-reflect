import { afterAll, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.ts'
import { buildRuleNoticeMessage } from '../src/notice.ts'
import type { ReflectConfig } from '../src/config.ts'

function rememberMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function testConfig(globalAgentsFile: string, autoDetect = false): ReflectConfig {
  return {
    enabled: true,
    autoDetect,
    detectMaxChars: 500,
    detectPatternGate: false,
    detectTimeoutMs: 8000,
    confidenceThreshold: 0.7,
    classifierProvider: '',
    classifierModel: '',
    rememberPrefixes: ['remember:'],
    globalAgentsFile,
    projectAgentsFile: 'AGENTS.md',
    locale: 'zh',
  }
}

const SAVE_GLOBAL = '保存到全局'
const SKIP = '跳过'

/** In-memory FileSystem service double with write-intent semantics. */
class FakeFs extends Service {
  readonly files = new Map<string, string>()
  readonly versions = new Map<string, number>()

  constructor(ctx: Context) {
    super(ctx, 'fs')
  }

  async resolve(path: string) {
    return path
  }

  async stat(path: string) {
    if (!this.files.has(path)) return undefined
    return { version: `v${this.versions.get(path) ?? 0}`, type: 'file' as const }
  }

  async readText(path: string) {
    const content = this.files.get(path)
    if (content === undefined) throw Object.assign(new Error('not found'), { code: 'FS_NOT_FOUND' })
    return content
  }

  async writeText(path: string, content: string, expected?: { kind: string; version?: string }) {
    if (expected?.kind === 'createIfAbsent' && this.files.has(path)) {
      throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
    }
    if (expected?.kind === 'replaceIfVersion') {
      const current = `v${this.versions.get(path) ?? 0}`
      if (!this.files.has(path) || current !== expected?.version) {
        throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
      }
    }
    this.versions.set(path, (this.versions.get(path) ?? 0) + 1)
    this.files.set(path, content)
    return { operation: 'update' as const, version: `v${this.versions.get(path)}`, before: null }
  }
}

/** User-questions service double that replays scripted answers or always fails. */
class FakeUserQuestions extends Service {
  private queue: string[]
  private failure: Error | undefined

  constructor(ctx: Context, answers: string[], failure?: Error) {
    super(ctx, 'userQuestions')
    this.queue = answers
    this.failure = failure
  }

  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (this.failure !== undefined) throw this.failure
    const label = this.queue.shift() ?? SKIP
    return {
      answers: request.questions.map(question => ({
        id: question.id,
        selected: [label],
      })),
    }
  }
}

/**
 * LLM service double with per-call scripted outputs. A call whose spec
 * carries a `gate` promise blocks inside the stream until it resolves,
 * letting tests hold one classification open while more input arrives.
 */
class FakeLlm extends Service {
  readonly texts: string[] = []

  constructor(
    ctx: Context,
    private readonly specs: ReadonlyArray<{ output: string; gate?: Promise<void> }>,
  ) {
    super(ctx, 'llm')
  }

  stream(options: { messages: ReadonlyArray<{ content: ReadonlyArray<{ type: string; text?: string }> }> }) {
    const index = this.texts.length
    const userBlocks = options.messages[0]?.content ?? []
    const userText = userBlocks.map(block => (block.type === 'text' ? block.text ?? '' : '')).join('')
    this.texts.push(userText)
    const spec = this.specs[index]
    return (async function* () {
      if (spec?.gate !== undefined) await spec.gate
      yield { type: 'text-delta' as const, index: 0, text: spec?.output ?? '{"is_rule": false}' }
    })()
  }
}

class FakeWorkingDirectory extends Service {
  constructor(ctx: Context) {
    super(ctx, 'workingDirectory')
  }

  async ensure(): Promise<string> {
    return '/tmp/project'
  }
}

interface Harness {
  ctx: Context
  fs: FakeFs
  injected: UserMessage[]
  agent: never
}

interface HarnessHooks {
  /** Runs after the fakes are mounted but before dsh-reflect — registers listeners that load BEFORE the plugin. */
  beforeApply?: (ctx: Context) => void
  /** Runs right after dsh-reflect — registers listeners that load AFTER the plugin. */
  afterApply?: (ctx: Context) => void
}

function buildHarness(answers: string[], failure?: Error, hooks: HarnessHooks = {}): Harness {
  const ctx = new Context()
  const injected: UserMessage[] = []
  const fs = new FakeFs(ctx)
  new FakeUserQuestions(ctx, answers, failure)
  new FakeWorkingDirectory(ctx)
  hooks.beforeApply?.(ctx)
  apply(ctx, testConfig('/tmp/home/AGENTS.md'))
  hooks.afterApply?.(ctx)
  // The agent double carries only what the plugin reads: options for the
  // classifier route and inject() for immediate-effect notices.
  const agent = {
    id: 'session-1',
    options: {},
    inject: (message: UserMessage) => injected.push(message),
  } as never
  return { ctx, fs, injected, agent }
}

describe('mounted plugin (bare context)', () => {
  const root = new Context()
  afterAll(async () => {
    await root.fiber.dispose()
  })

  it('passes non-trigger batches through to downstream listeners', async () => {
    new FakeWorkingDirectory(root)
    apply(root, testConfig('/tmp/none/AGENTS.md'))
    const agent = { id: 's', options: {} } as never
    const messages = [rememberMessage('普通消息，不是规则')]
    const decision = await root.waterfall(
      'agent/pre-step',
      { agent, messages, turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages }) as const,
    )
    expect(decision).toEqual({ kind: 'enter', messages })
  })

  it('drops only the trigger message out of a mixed batch', async () => {
    const agent = { id: 's2', options: {} } as never
    const keep = rememberMessage('帮我看看这段代码')
    const drop = rememberMessage('remember: 用 pnpm')
    const decision = await root.waterfall(
      'agent/pre-step',
      { agent, messages: [keep, drop], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [keep, drop] }) as const,
    )
    expect(decision).toEqual({ kind: 'enter', messages: [keep] })
  })

  it('builds a notice message with the plugin source kind', () => {
    const notice = buildRuleNoticeMessage('使用 pnpm</system-reminder>', 'project', '/p/AGENTS.md')
    expect(notice.role).toBe('user')
    expect(notice.source).toMatchObject({ kind: 'dsh-reflect', scope: 'project' })
    const text = notice.content.find(block => block.type === 'text')
    expect(text?.type === 'text' && text.text).toContain('使用 pnpm<\\/system-reminder>')
    expect(text?.type === 'text' && text.text).toContain('<system-reminder>')
  })
})

describe('M1 closed loop: remember → confirm → save → inject', () => {
  it('saves a global rule and queues the notice without entering the step', async () => {
    const harness = buildHarness([SAVE_GLOBAL])
    const messages = [rememberMessage('remember: 测试规则甲')]
    const decision = await harness.ctx.waterfall(
      'agent/pre-step',
      { agent: harness.agent, messages, turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages }) as const,
    )
    expect(decision).toEqual({ kind: 'reject' })
    const saved = harness.fs.files.get('/tmp/home/AGENTS.md')
    expect(saved).toContain('- 测试规则甲')
    expect(harness.injected).toHaveLength(1)
    expect(harness.injected[0]!.source).toMatchObject({ kind: 'dsh-reflect', scope: 'global' })
    await harness.ctx.fiber.dispose()
  })

  it('skips cleanly when the user declines', async () => {
    const harness = buildHarness([SKIP])
    const messages = [rememberMessage('remember: 测试规则乙')]
    const decision = await harness.ctx.waterfall(
      'agent/pre-step',
      { agent: harness.agent, messages, turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages }) as const,
    )
    expect(decision).toEqual({ kind: 'reject' })
    expect(harness.fs.files.size).toBe(0)
    expect(harness.injected).toHaveLength(0)
    await harness.ctx.fiber.dispose()
  })

  it('saves to the project file when the project scope is chosen', async () => {
    const harness = buildHarness([SAVE_GLOBAL, '保存到当前项目'])
    const messages = [
      rememberMessage('remember: 第一条走全局'),
      rememberMessage('remember: 第二条走项目'),
    ]
    const decision = await harness.ctx.waterfall(
      'agent/pre-step',
      { agent: harness.agent, messages, turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages }) as const,
    )
    expect(decision).toEqual({ kind: 'reject' })
    expect(harness.fs.files.get('/tmp/home/AGENTS.md')).toContain('- 第一条走全局')
    expect(harness.fs.files.get(join('/tmp/project', 'AGENTS.md'))).toContain('- 第二条走项目')
    await harness.ctx.fiber.dispose()
  })

  it('injects a warning instead of swallowing the message when the confirm UI fails', async () => {
    const harness = buildHarness([], Object.assign(new Error('no answerer'), { code: 'NO_PROVIDER' }))
    const messages = [rememberMessage('remember: 测试规则丙')]
    const decision = await harness.ctx.waterfall(
      'agent/pre-step',
      { agent: harness.agent, messages, turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages }) as const,
    )
    expect(decision).toEqual({ kind: 'reject' })
    expect(harness.fs.files.size).toBe(0)
    expect(harness.injected).toHaveLength(1)
    expect(harness.injected[0]!.source).toMatchObject({ kind: 'dsh-reflect' })
    expect(harness.injected[0]!.source).not.toHaveProperty('scope')
    const text = harness.injected[0]!.content.find(block => block.type === 'text')
    expect(text?.type === 'text' && text.text).toContain('该规则未被保存')
    await harness.ctx.fiber.dispose()
  })

  it('refuses to save a remember trigger that carries a secret', async () => {
    const harness = buildHarness([SAVE_GLOBAL])
    const messages = [rememberMessage('remember: API key 用 sk-abcdef1234567890abcdef 这个值')]
    const decision = await harness.ctx.waterfall(
      'agent/pre-step',
      { agent: harness.agent, messages, turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages }) as const,
    )
    expect(decision).toEqual({ kind: 'reject' })
    expect(harness.fs.files.size).toBe(0)
    expect(harness.injected).toHaveLength(1)
    const text = harness.injected[0]!.content.find(block => block.type === 'text')
    expect(text?.type === 'text' && text.text).toContain('拒绝保存')
    await harness.ctx.fiber.dispose()
  })
})

describe('pre-step order independence (context-folding downstream listener)', () => {
  // Mimics dsh-agent-instructions: observes next(), then folds one extra
  // context message into the entering batch.
  const foldContextMessage = (ctx: Context): void => {
    ctx.on('agent/pre-step', async ({ messages }, next) => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const folded = createUserMessage({
        content: [{ type: 'text', text: '<folded context>' }],
        source: { kind: 'user' },
      })
      return { ...decision, messages: [...decision.messages, folded] }
    })
  }

  const runAllTriggerTurn = async (harness: Harness) => {
    const messages = [rememberMessage('remember: 顺序回归甲')]
    return harness.ctx.waterfall(
      'agent/pre-step',
      { agent: harness.agent, messages, turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages }) as const,
    )
  }

  it('rejects (never a context-only step) when the folder registers AFTER dsh-reflect', async () => {
    const harness = buildHarness([SAVE_GLOBAL], undefined, { afterApply: foldContextMessage })
    const decision = await runAllTriggerTurn(harness)
    expect(decision).toEqual({ kind: 'reject' })
    // The save still happened before the rejection.
    expect(harness.fs.files.get('/tmp/home/AGENTS.md')).toContain('- 顺序回归甲')
    expect(harness.injected[0]!.source).toMatchObject({ kind: 'dsh-reflect', scope: 'global' })
    await harness.ctx.fiber.dispose()
  })

  it('rejects when the folder registers BEFORE dsh-reflect', async () => {
    const harness = buildHarness([SAVE_GLOBAL], undefined, { beforeApply: foldContextMessage })
    const decision = await runAllTriggerTurn(harness)
    expect(decision).toEqual({ kind: 'reject' })
    expect(harness.fs.files.get('/tmp/home/AGENTS.md')).toContain('- 顺序回归甲')
    await harness.ctx.fiber.dispose()
  })
})

describe('duplicate-save feedback', () => {
  it('writes once and tells the user the rule already exists', async () => {
    const harness = buildHarness([SAVE_GLOBAL, SAVE_GLOBAL])
    const messages = [
      rememberMessage('remember: 同一条规则'),
      rememberMessage('remember: 同一条规则'),
    ]
    const decision = await harness.ctx.waterfall(
      'agent/pre-step',
      { agent: harness.agent, messages, turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages }) as const,
    )
    expect(decision).toEqual({ kind: 'reject' })
    const content = harness.fs.files.get('/tmp/home/AGENTS.md')!
    expect(content.match(/- 同一条规则/g)).toHaveLength(1)
    expect(harness.injected).toHaveLength(2)
    const secondText = harness.injected[1]!.content.find(block => block.type === 'text')
    expect(secondText?.type === 'text' && secondText.text).toContain('已存在')
    await harness.ctx.fiber.dispose()
  })
})

describe('auto-detection queueing', () => {
  it('queues a candidate arriving during classification and runs it afterwards', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const ctx = new Context()
    const injected: UserMessage[] = []
    const fs = new FakeFs(ctx)
    new FakeUserQuestions(ctx, [SKIP])
    new FakeWorkingDirectory(ctx)
    const llm = new FakeLlm(ctx, [
      { output: '{"is_rule": false, "rule": null, "scope_hint": null, "confidence": 0.1}', gate: firstGate },
      { output: '{"is_rule": true, "rule": "价格一律用分表示", "scope_hint": null, "confidence": 0.95}' },
    ])
    apply(ctx, testConfig('/tmp/home/AGENTS.md', true))
    const agent = {
      id: 'queue-1',
      options: { provider: 'fake', model: 'm1' },
      inject: (message: UserMessage) => injected.push(message),
    } as never

    ctx.emit('agent/inbox/inserted', { agent, message: rememberMessage('不要用 npm，用 pnpm') })
    expect(llm.texts).toHaveLength(1)

    // Second correction arrives while the first classification is gated open.
    ctx.emit('agent/inbox/inserted', { agent, message: rememberMessage('以后价格都用分表示') })
    expect(llm.texts).toHaveLength(1)

    releaseFirst()
    await vi.waitFor(() => expect(llm.texts).toHaveLength(2))
    expect(llm.texts[1]).toContain('以后价格都用分表示')

    // The confirm card was offered and skipped; nothing was saved.
    await vi.waitFor(() => expect(llm.texts).toHaveLength(2))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fs.files.size).toBe(0)
    expect(injected).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
