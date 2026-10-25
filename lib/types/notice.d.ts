/**
 * Immediate-effect notice injected into the live conversation after a save
 * (requirement F6). The notice is a durable user-role message with the
 * plugin's own source kind, so it replays like any other history and the
 * model applies the rule from the next request onward. Future sessions read
 * the rule natively from AGENTS.md via `dsh-agent-instructions`, so no
 * persistent prompt section is registered (which would duplicate the
 * baseline).
 *
 * @module dsh-reflect/notice
 */
import type { UserMessage } from '@deepseek-ai/dsh-session';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        /** Message produced by dsh-reflect: a saved-rule notice or a warning. */
        'dsh-reflect': {
            kind: 'dsh-reflect';
            /** Target scope of a saved-rule notice; absent on operational warnings. */
            scope?: 'global' | 'project';
        };
    }
}
/** Build the one-shot notice announcing a freshly saved rule. */
export declare function buildRuleNoticeMessage(rule: string, scope: 'global' | 'project', path: string): UserMessage;
/**
 * Build a warning notice for a trigger that was consumed but NOT saved —
 * confirm UI unavailable, aborted, or sensitive content refused. Consuming
 * the message with an explicit warning keeps it from vanishing silently
 * (requirement 7.3) without feeding raw `remember:` syntax to the model.
 */
export declare function buildWarningNotice(reason: string): UserMessage;
