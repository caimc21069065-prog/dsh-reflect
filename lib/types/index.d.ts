/**
 * dsh-reflect — turn corrections into permanent rules (DeepSeek Harness).
 *
 * Two entry paths, one storage format (see the requirements doc):
 *
 * 1. Explicit trigger — a user message starting with `remember:` (or a
 *    configured Chinese prefix) is intercepted in `agent/pre-step`, confirmed
 *    through the user-questions confirm bar, written to the chosen
 *    AGENTS.md, and consumed without reaching the model. When confirmation
 *    is impossible (no UI, abort) or the content looks like a credential,
 *    the trigger is still consumed but a warning notice is injected so the
 *    "not saved" outcome is explicit instead of silent.
 * 2. Auto detection — short user prompts are filtered, classified by a
 *    one-shot call over the harness's own LLM route, and offered through the
 *    same confirm bar while the agent keeps answering. An offer dies when the
 *    user's next message enters a step or when a newer offer supersedes it.
 *
 * After a confirmed save the rule is queued into the live conversation as a
 * one-shot `dsh-reflect` notice (immediate effect), while future sessions
 * pick it up natively from AGENTS.md via `dsh-agent-instructions`.
 *
 * @module dsh-reflect
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ReflectConfig } from './config.ts';
export { Config } from './config.ts';
export { SECTION_START, SECTION_END, parseRuleSection, upsertRule } from './rules.ts';
export { fastFilter, parseClassification, looksSensitive } from './detect.ts';
export declare const name = "dsh-reflect";
/** Service keys the plugin waits for; everything else is optional at use time. */
export declare const inject: string[];
export declare function apply(ctx: Context, config: ReflectConfig): void;
