/**
 * Filesystem-backed rule store over the harness `ctx.fs` provider.
 *
 * Every save is a read-modify-write cycle guarded by the provider's version
 * token, so concurrent edits (human or model) cannot be clobbered silently;
 * a lost race retries from a fresh read a bounded number of times. Mutations
 * stay inside the marked section, and a corrupt section refuses the write
 * (requirement 6.2 / 7.3).
 *
 * @module dsh-reflect/storage
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import { upsertRule, parseRuleSection, findRule } from './rules.ts'

/** Number of read-modify-write retries after a lost version race. */
const MAX_WRITE_ATTEMPTS = 3

export interface SaveOutcome {
  status: 'added' | 'duplicate' | 'corrupt'
  /** Absolute path the operation targeted (also used by the notice message). */
  path: string
}

/** Read the managed rules of one file; missing files read as empty. */
export async function readRules(
  ctx: Context,
  path: string,
): Promise<{ rules: string[]; corrupt: boolean }> {
  const fs = ctx.get('fs')
  if (fs === undefined) return { rules: [], corrupt: false }
  const target = await fs.resolve(path)
  const info = await fs.stat(target)
  if (info === undefined) return { rules: [], corrupt: false }
  const content = await fs.readText(target)
  const parsed = parseRuleSection(content)
  if (parsed.status === 'ok') return { rules: parsed.rules, corrupt: false }
  if (parsed.status === 'corrupt') return { rules: [], corrupt: true }
  return { rules: [], corrupt: false }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

/**
 * Insert one rule into the target file and report the outcome. The returned
 * promise rejects only on hard I/O failure; 'duplicate' and 'corrupt' are
 * reported as statuses so callers can log them precisely. Only concurrent-
 * modification races (create lost to an appearing file, stale version) are
 * retried; deterministic failures such as permission or sandbox denials
 * throw on the first attempt.
 */
export async function saveRule(ctx: Context, path: string, rule: string): Promise<SaveOutcome> {
  const fs = ctx.get('fs')
  if (fs === undefined) {
    throw new Error('dsh-reflect: filesystem provider (ctx.fs) is unavailable')
  }
  const target = await fs.resolve(path)
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    const info = await fs.stat(target)
    if (info === undefined) {
      const parsed = upsertRule(undefined, rule)
      try {
        await fs.writeText(target, parsed.content, { kind: 'createIfAbsent' })
        return { status: 'added', path }
      } catch (error) {
        // The file appeared between stat and write; fall through to the
        // guarded replace path on the next attempt. Anything else is not a
        // race and will not heal by retrying.
        if (errorCode(error) !== 'FS_NOT_OBSERVED') throw error
      }
      continue
    }
    const content = await fs.readText(target)
    const parsed = upsertRule(content, rule)
    if (parsed.status !== 'added') return { status: parsed.status, path }
    try {
      await fs.writeText(target, parsed.content, { kind: 'replaceIfVersion', version: info.version })
      return { status: 'added', path }
    } catch (error) {
      if (errorCode(error) !== 'FS_STALE_VERSION') throw error
    }
  }
  throw new Error(`dsh-reflect: could not write ${path} after ${MAX_WRITE_ATTEMPTS} attempts`)
}

/** True when the rule already exists in either target file. */
export async function ruleExists(
  ctx: Context,
  paths: readonly string[],
  rule: string,
): Promise<boolean> {
  for (const path of paths) {
    const { rules } = await readRules(ctx, path)
    if (findRule(rules, rule) !== undefined) return true
  }
  return false
}
