/**
 * Message text helpers: extract plain text from a user message and match the
 * explicit `remember:` trigger prefixes (requirement F1).
 *
 * @module dsh-reflect/text
 */

import type { UserMessage } from '@deepseek-ai/dsh-session'

/** Concatenate the message's text blocks; non-text blocks are ignored. */
export function messageText(message: UserMessage): string {
  return message.content
    .map(block => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()
}

/** Case-insensitive prefix test against the configured trigger list. */
export function matchRememberPrefix(
  text: string,
  prefixes: readonly string[],
): { prefix: string; rest: string } | undefined {
  const trimmed = text.trimStart()
  for (const prefix of prefixes) {
    if (prefix.length === 0) continue
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
      return { prefix, rest: trimmed.slice(prefix.length) }
    }
  }
  return undefined
}

/**
 * Extract the rule payload of an explicit `remember:` message.
 * @returns the trimmed rule text, or `undefined` when the message does not
 *   start with a trigger prefix or carries no payload.
 */
export function extractRememberRule(
  message: UserMessage,
  prefixes: readonly string[],
): string | undefined {
  const matched = matchRememberPrefix(messageText(message), prefixes)
  if (matched === undefined) return undefined
  const rule = matched.rest.trim()
  return rule.length > 0 ? rule : undefined
}
