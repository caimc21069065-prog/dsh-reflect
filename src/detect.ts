/**
 * Correction detection (requirement F2 / section 8.3).
 *
 * Layer 1 is a deterministic fast filter that drops acknowledgements, slash
 * commands, oversized prompts, explicit `remember:` messages (owned by the
 * confirm flow), and anything resembling a secret. Layer 2 is a one-shot
 * classifier call over the harness's own LLM runtime that returns structured
 * JSON; unparseable or low-confidence output is discarded ("宁缺毋滥").
 *
 * @module dsh-reflect/detect
 */

/** Messages that are pure conversational acknowledgements, never rules. */
const ACKNOWLEDGEMENT_RE = new RegExp(
  '^(?:'
  + '好的?|好呀|好吧|行|中|成|嗯+|哦+|噢|噢了|收到|了解|明白|明白了|懂了|知道了|没问题|可以|确认|同意|'
  + '谢谢|多谢|辛苦|thanks?|thank you|thx|ty|ok(?:ay)?|kk+|k|fine|sure|got it|understood|noted|'
  + 'continue|go on|go ahead|next|下一步|继续|接着来|请继续'
  + ')[。.！!？?～~、，,\\s]*$',
  'i',
)

/** Content that must never reach the confirm flow, let alone a rule file. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,                 // DeepSeek / OpenAI style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,            // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/,                      // AWS access key ids
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,        // PEM private keys
  /\beyJ[A-Za-z0-9_-]{16,}\b/,                 // JWT-shaped blobs
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,          // Slack tokens
  /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*\S+/i,
]

/** True when the text looks like it carries a credential or private key. */
export function looksSensitive(text: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Cheap correction-shape hint. Only consulted when the optional pattern gate
 * is enabled (`detectPatternGate`): it skips the LLM classifier for prompts
 * with no correction wording at all, cutting per-message classification cost
 * at the price of missing corrections that phrase themselves unusually.
 */
const CORRECTION_HINT_RE = new RegExp(
  '不要|别用|别再|以后|今后|一律|统一|全都|总是|记得|请用|请使用|改用|换成|遵守|'
  + 'always|never|from now on|instead of|use\\s+\\S+\\s+instead|prefer|make sure',
  'i',
)

export type FastFilterResult =
  | { pass: true; text: string }
  | { pass: false; reason: string }

/**
 * Layer 1 filter. `rememberPrefixes` are excluded here because explicit
 * triggers take the confirm flow directly and must not be double-classified.
 * With `patternGate` enabled, prompts without any correction wording are
 * dropped before the classifier call.
 */
export function fastFilter(
  rawText: string,
  maxChars: number,
  rememberPrefixes: readonly string[],
  patternGate = false,
): FastFilterResult {
  const text = rawText.trim()
  if (text.length === 0) return { pass: false, reason: 'empty' }
  if (text.length < 4) return { pass: false, reason: 'too-short' }
  if (text.length > maxChars) return { pass: false, reason: 'too-long' }
  if (text.startsWith('/')) return { pass: false, reason: 'slash-command' }
  for (const prefix of rememberPrefixes) {
    if (prefix.length > 0 && text.toLowerCase().startsWith(prefix.toLowerCase())) {
      return { pass: false, reason: 'explicit-remember' }
    }
  }
  if (ACKNOWLEDGEMENT_RE.test(text)) return { pass: false, reason: 'acknowledgement' }
  if (looksSensitive(text)) return { pass: false, reason: 'sensitive' }
  if (patternGate && !CORRECTION_HINT_RE.test(text)) {
    return { pass: false, reason: 'no-correction-pattern' }
  }
  return { pass: true, text }
}

export interface Classification {
  isRule: boolean
  rule: string
  scopeHint: 'global' | 'project' | null
  confidence: number
}

const CLASSIFIER_SYSTEM = [
  '你是编码助手的规则检测器。判断用户消息是否表达了值得跨会话保留的持久规则、纠正或偏好',
  '（例如：包管理器/工具选择、代码风格、命名约定、项目规范、沟通偏好）。',
  '一次性任务指令（如"帮我修这个 bug"）、提问、单纯确认或闲聊都不是规则。',
  '',
  '只输出一个 JSON 对象，不要输出任何其他文字：',
  '{"is_rule": boolean, "rule": string | null, "scope_hint": "global" | "project" | null, "confidence": number}',
  '',
  '- "rule"：把消息改写成一条简洁、可长期遵循的规则（保留用户的语言）；不是规则时为 null。',
  '- "scope_hint"：内容明显针对某个具体项目/仓库时为 "project"，是通用偏好时为 "global"，不确定时为 null。',
  '- "confidence"：0 到 1 之间的判断置信度。',
].join('\n')

function classifierUserPrompt(text: string): string {
  return `用户消息：\n${text}`
}

/** Build the one-shot classifier request body. */
export function buildClassifierRequest(text: string): { system: string; user: string } {
  return { system: CLASSIFIER_SYSTEM, user: classifierUserPrompt(text) }
}

/**
 * Parse the classifier's output. Tolerates prose around the JSON object and
 * returns `undefined` for anything malformed — the caller then drops the
 * candidate silently.
 */
export function parseClassification(raw: string): Classification | undefined {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  let data: unknown
  try {
    data = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  if (record.is_rule !== true) return undefined
  const rule = typeof record.rule === 'string' ? record.rule.trim() : ''
  if (rule.length === 0) return undefined
  const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
    ? Math.min(1, Math.max(0, record.confidence))
    : 0
  const scopeHint = record.scope_hint === 'global' || record.scope_hint === 'project'
    ? record.scope_hint
    : null
  return { isRule: true, rule, scopeHint, confidence }
}
