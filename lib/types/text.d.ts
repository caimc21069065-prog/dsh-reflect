/**
 * Message text helpers: extract plain text from a user message and match the
 * explicit `remember:` trigger prefixes (requirement F1).
 *
 * @module dsh-reflect/text
 */
import type { UserMessage } from '@deepseek-ai/dsh-session';
/** Concatenate the message's text blocks; non-text blocks are ignored. */
export declare function messageText(message: UserMessage): string;
/** Case-insensitive prefix test against the configured trigger list. */
export declare function matchRememberPrefix(text: string, prefixes: readonly string[]): {
    prefix: string;
    rest: string;
} | undefined;
/**
 * Extract the rule payload of an explicit `remember:` message.
 * @returns the trimmed rule text, or `undefined` when the message does not
 *   start with a trigger prefix or carries no payload.
 */
export declare function extractRememberRule(message: UserMessage, prefixes: readonly string[]): string | undefined;
