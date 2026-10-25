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
import type { Context } from '@deepseek-ai/cordis';
export interface SaveOutcome {
    status: 'added' | 'duplicate' | 'corrupt';
    /** Absolute path the operation targeted (also used by the notice message). */
    path: string;
}
/** Read the managed rules of one file; missing files read as empty. */
export declare function readRules(ctx: Context, path: string): Promise<{
    rules: string[];
    corrupt: boolean;
}>;
/**
 * Insert one rule into the target file and report the outcome. The returned
 * promise rejects only on hard I/O failure; 'duplicate' and 'corrupt' are
 * reported as statuses so callers can log them precisely. Only concurrent-
 * modification races (create lost to an appearing file, stale version) are
 * retried; deterministic failures such as permission or sandbox denials
 * throw on the first attempt.
 */
export declare function saveRule(ctx: Context, path: string, rule: string): Promise<SaveOutcome>;
/** True when the rule already exists in either target file. */
export declare function ruleExists(ctx: Context, paths: readonly string[], rule: string): Promise<boolean>;
