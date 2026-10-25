import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { readRules, ruleExists, saveRule } from '../src/storage.ts'
import { SECTION_END, SECTION_START } from '../src/rules.ts'

/** In-memory FileSystem double with versioned writes and injectable failures. */
function fakeContext(files: Map<string, string>, hooks?: {
  beforeWrite?: (path: string, attempt: number) => void
}) {
  const versions = new Map<string, number>()
  let writeCount = 0
  const fs = {
    resolve: async (path: string) => path,
    stat: async (path: string) => {
      if (!files.has(path)) return undefined
      return { version: `v${versions.get(path) ?? 0}`, type: 'file' as const }
    },
    readText: async (path: string) => {
      const content = files.get(path)
      if (content === undefined) throw Object.assign(new Error('not found'), { code: 'FS_NOT_FOUND' })
      return content
    },
    writeText: async (path: string, content: string, expected?: { kind: string; version?: string }) => {
      writeCount += 1
      hooks?.beforeWrite?.(path, writeCount)
      if (expected?.kind === 'createIfAbsent' && files.has(path)) {
        throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
      }
      if (expected?.kind === 'replaceIfVersion') {
        if (!files.has(path) || `v${versions.get(path) ?? 0}` !== expected.version) {
          throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
        }
      }
      versions.set(path, (versions.get(path) ?? 0) + 1)
      files.set(path, content)
      return { operation: 'update' as const, version: `v${versions.get(path)}`, before: null }
    },
  }
  return { ctx: { get: (key: string) => (key === 'fs' ? fs : undefined) } as unknown as Context, writeCount: () => writeCount }
}

describe('saveRule', () => {
  it('creates a new file on first save', async () => {
    const files = new Map<string, string>()
    const { ctx } = fakeContext(files)
    const outcome = await saveRule(ctx, '/home/.dsh/AGENTS.md', '使用 pnpm')
    expect(outcome.status).toBe('added')
    expect(files.get('/home/.dsh/AGENTS.md')).toContain(SECTION_START)
    expect(files.get('/home/.dsh/AGENTS.md')).toContain('- 使用 pnpm')
  })

  it('appends into an existing managed section without duplicating', async () => {
    const files = new Map<string, string>()
    const { ctx } = fakeContext(files)
    await saveRule(ctx, '/p/AGENTS.md', '规则甲')
    const duplicate = await saveRule(ctx, '/p/AGENTS.md', '规则甲')
    expect(duplicate.status).toBe('duplicate')
    const second = await saveRule(ctx, '/p/AGENTS.md', '规则乙')
    expect(second.status).toBe('added')
    const content = files.get('/p/AGENTS.md')!
    expect(content).toContain('- 规则甲\n- 规则乙')
    expect(content.match(new RegExp(SECTION_START, 'g'))).toHaveLength(1)
  })

  it('appends the section after existing unmanaged content', async () => {
    const files = new Map<string, string>([['/p/AGENTS.md', '# 项目说明\n\n自定义内容\n']])
    const { ctx } = fakeContext(files)
    await saveRule(ctx, '/p/AGENTS.md', '规则一')
    const content = files.get('/p/AGENTS.md')!
    expect(content.startsWith('# 项目说明\n\n自定义内容\n\n')).toBe(true)
    await expect(readRules(ctx, '/p/AGENTS.md')).resolves.toEqual({ rules: ['规则一'], corrupt: false })
  })

  it('retries once after a stale version race and still writes correctly', async () => {
    const files = new Map<string, string>()
    const { ctx } = fakeContext(files, {
      beforeWrite: (_path, attempt) => {
        if (attempt === 1) {
          // Simulate a concurrent writer between read and write.
          files.set('/p/AGENTS.md', `${SECTION_START}\n## Learned rules\n\n- 并发写入\n\n${SECTION_END}\n`)
        }
      },
    })
    const outcome = await saveRule(ctx, '/p/AGENTS.md', '新规则')
    expect(outcome.status).toBe('added')
    const content = files.get('/p/AGENTS.md')!
    expect(content).toContain('- 并发写入')
    expect(content).toContain('- 新规则')
  })

  it('fails fast on deterministic (non-race) write errors', async () => {
    const files = new Map<string, string>([['/p/AGENTS.md', '# x\n']])
    let writes = 0
    const fs = {
      resolve: async (path: string) => path,
      stat: async () => ({ version: 'v1', type: 'file' as const }),
      readText: async () => files.get('/p/AGENTS.md')!,
      writeText: async () => {
        writes += 1
        throw Object.assign(new Error('denied'), { code: 'FS_PERMISSION_DENIED' })
      },
    }
    const ctx = { get: (key: string) => (key === 'fs' ? fs : undefined) } as unknown as Context
    await expect(saveRule(ctx, '/p/AGENTS.md', '规则')).rejects.toThrow('denied')
    expect(writes).toBe(1)
  })

  it('refuses to write when the managed section is corrupt', async () => {
    const files = new Map<string, string>([['/p/AGENTS.md', `${SECTION_START}\n- broken\n`]])
    const { ctx } = fakeContext(files)
    const outcome = await saveRule(ctx, '/p/AGENTS.md', '新规则')
    expect(outcome.status).toBe('corrupt')
    expect(files.get('/p/AGENTS.md')).toBe(`${SECTION_START}\n- broken\n`)
  })
})

describe('ruleExists', () => {
  it('finds rules across both target files with normalization', async () => {
    const files = new Map<string, string>([['/p/AGENTS.md', `${SECTION_START}\n- Use pnpm\n\n${SECTION_END}\n`]])
    const { ctx } = fakeContext(files)
    await expect(ruleExists(ctx, ['/home/.dsh/AGENTS.md', '/p/AGENTS.md'], 'use pnpm')).resolves.toBe(true)
    await expect(ruleExists(ctx, ['/home/.dsh/AGENTS.md', '/p/AGENTS.md'], 'use yarn')).resolves.toBe(false)
  })
})
