/**
 * Confirm-bar flow over `ctx.userQuestions` (requirements F3/F4/F7).
 *
 * Nothing is ever written without an explicit human answer: one question
 * offers Save global / Save project / Edit / Skip; the Edit branch runs a
 * second round that lets the user rewrite the rule text and pick the scope.
 * UserQuestion failures (no UI attached, delegated caller, abort) degrade to
 * a silent skip — a missed rule is always preferable to a wrong one.
 *
 * @module dsh-reflect/confirm
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
export type SaveScope = 'global' | 'project';
export type ConfirmOutcome = {
    action: 'save';
    rule: string;
    scope: SaveScope;
} | {
    action: 'skip';
    reason?: string;
};
/**
 * Run the confirm flow for one candidate rule.
 * @param originDetail optional human-facing context (e.g. the original prompt
 *   the classifier distilled the rule from).
 */
export declare function confirmRule(ctx: Context, agent: Agent, signal: AbortSignal, rule: string, locale: 'zh' | 'en', originDetail?: string): Promise<ConfirmOutcome>;
/**
 * Run `confirmRule` and map every failure mode to a silent skip, logging the
 * cause. Use this for the non-blocking auto-detection path.
 */
export declare function confirmRuleSafe(ctx: Context, agent: Agent, signal: AbortSignal, rule: string, locale: 'zh' | 'en', originDetail?: string): Promise<ConfirmOutcome>;
