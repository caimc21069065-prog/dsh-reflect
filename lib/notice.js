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
import { createUserMessage } from '@deepseek-ai/dsh-llm';
function escapeFrame(text) {
    // Repository-controlled text must not be able to close the plugin-owned
    // frame (same rule as dsh-agent-instructions).
    return text.replaceAll('</system-reminder>', '<\\/system-reminder>');
}
/** Build the one-shot notice announcing a freshly saved rule. */
export function buildRuleNoticeMessage(rule, scope, path) {
    const scopeLine = scope === 'global'
        ? 'The user saved this rule globally (it applies to every project).'
        : 'The user saved this rule for the current project.';
    const text = [
        '<system-reminder>',
        'dsh-reflect: the user just saved the following rule. Follow it from now on, including in later sessions.',
        scopeLine,
        '',
        `- ${escapeFrame(rule)}`,
        '',
        `Stored in: ${path}`,
        '</system-reminder>',
    ].join('\n');
    return createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'dsh-reflect', scope },
    });
}
/**
 * Build a warning notice for a trigger that was consumed but NOT saved —
 * confirm UI unavailable, aborted, or sensitive content refused. Consuming
 * the message with an explicit warning keeps it from vanishing silently
 * (requirement 7.3) without feeding raw `remember:` syntax to the model.
 */
export function buildWarningNotice(reason) {
    const text = [
        '<system-reminder>',
        `dsh-reflect: ${escapeFrame(reason)}`,
        '</system-reminder>',
    ].join('\n');
    return createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'dsh-reflect' },
    });
}
