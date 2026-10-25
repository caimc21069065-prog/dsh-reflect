/**
 * Managed marked-section format for learned rules inside AGENTS.md files.
 *
 * The section is plain Markdown delimited by stable HTML-comment markers, so
 * users can hand-edit rules between the markers and dsh-reflect can locate,
 * deduplicate, and extend its own block without touching the rest of the
 * file. Unbalanced markers mean a human (or another tool) may be mid-edit:
 * every writer refuses the file instead of guessing (requirement 6.2).
 *
 * @module dsh-reflect/rules
 */

/** Opening marker of the managed section. */
export const SECTION_START = '<!-- dsh-reflect: learned rules -->'
/** Closing marker of the managed section. */
export const SECTION_END = '<!-- end dsh-reflect -->'
/** Heading rendered inside the managed section. */
export const SECTION_HEADING = '## Learned rules'

export type ParsedSection =
  | { status: 'absent' }
  | { status: 'ok'; rules: string[] }
  | { status: 'corrupt' }

/**
 * Parse the managed section out of a file's full text.
 *
 * `absent` means no markers exist and the file may be freely appended to;
 * `corrupt` means the markers are unbalanced or duplicated — every writer
 * must refuse the file.
 */
export function parseRuleSection(fileContent: string): ParsedSection {
  const start = fileContent.indexOf(SECTION_START)
  const end = fileContent.indexOf(SECTION_END)
  if (start === -1 && end === -1) return { status: 'absent' }
  if (start === -1 || end === -1 || end < start) return { status: 'corrupt' }
  // A second managed section (usually a copy-paste accident) would silently
  // split the rule set: writers only ever touch the first block, so the
  // second one's rules would vanish from dedup. Refuse instead.
  if (fileContent.indexOf(SECTION_START, end + SECTION_END.length) !== -1) {
    return { status: 'corrupt' }
  }
  const rules: string[] = []
  for (const line of fileContent.slice(start + SECTION_START.length, end).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- ')) rules.push(trimmed.slice(2).trim())
  }
  return { status: 'ok', rules }
}

/**
 * Canonical comparison form of one rule: trimmed, whitespace-collapsed,
 * case-folded. Chinese rules are unaffected by case folding; ASCII rules
 * deduplicate across casing.
 */
export function normalizeRule(rule: string): string {
  return rule.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Return the first stored rule equal to `rule` after normalization. */
export function findRule(rules: readonly string[], rule: string): string | undefined {
  const normalized = normalizeRule(rule)
  return rules.find(candidate => normalizeRule(candidate) === normalized)
}

export interface UpsertResult {
  /** Complete file content after the operation; identical to the input when nothing changed. */
  content: string
  added: boolean
  status: 'added' | 'duplicate' | 'corrupt'
}

function renderNewSection(rule: string): string {
  return `${SECTION_START}\n${SECTION_HEADING}\n\n- ${rule}\n\n${SECTION_END}\n`
}

/**
 * Insert one rule into a file's full text without changing anything else.
 *
 * The rule is flattened to a single line first: the section is line-oriented
 * (one `- ` bullet per rule), so a multi-line rule would otherwise be read
 * back as several rules and break dedup.
 *
 * - missing file content (`undefined`) creates a fresh file holding only the section;
 * - a file without markers gets the section appended after its existing content;
 * - an existing section gets the rule appended after its last entry;
 * - a corrupt section is returned untouched with `status: 'corrupt'`.
 */
export function upsertRule(fileContent: string | undefined, rule: string): UpsertResult {
  const clean = rule.replace(/\s+/g, ' ').trim()
  if (fileContent === undefined) {
    return { content: renderNewSection(clean), added: true, status: 'added' }
  }
  const parsed = parseRuleSection(fileContent)
  if (parsed.status === 'corrupt') {
    return { content: fileContent, added: false, status: 'corrupt' }
  }
  if (parsed.status === 'ok') {
    if (findRule(parsed.rules, clean) !== undefined) {
      return { content: fileContent, added: false, status: 'duplicate' }
    }
    const end = fileContent.indexOf(SECTION_END)
    const before = fileContent.slice(0, end).trimEnd()
    const after = fileContent.slice(end)
    return { content: `${before}\n- ${clean}\n\n${after}`, added: true, status: 'added' }
  }
  const base = fileContent.length === 0 || fileContent.endsWith('\n')
    ? fileContent
    : `${fileContent}\n`
  return { content: `${base}\n${renderNewSection(clean)}`, added: true, status: 'added' }
}
