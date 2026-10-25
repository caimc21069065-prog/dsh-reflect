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
export declare const SECTION_START = "<!-- dsh-reflect: learned rules -->";
/** Closing marker of the managed section. */
export declare const SECTION_END = "<!-- end dsh-reflect -->";
/** Heading rendered inside the managed section. */
export declare const SECTION_HEADING = "## Learned rules";
export type ParsedSection = {
    status: 'absent';
} | {
    status: 'ok';
    rules: string[];
} | {
    status: 'corrupt';
};
/**
 * Parse the managed section out of a file's full text.
 *
 * `absent` means no markers exist and the file may be freely appended to;
 * `corrupt` means the markers are unbalanced or duplicated — every writer
 * must refuse the file.
 */
export declare function parseRuleSection(fileContent: string): ParsedSection;
/**
 * Canonical comparison form of one rule: trimmed, whitespace-collapsed,
 * case-folded. Chinese rules are unaffected by case folding; ASCII rules
 * deduplicate across casing.
 */
export declare function normalizeRule(rule: string): string;
/** Return the first stored rule equal to `rule` after normalization. */
export declare function findRule(rules: readonly string[], rule: string): string | undefined;
export interface UpsertResult {
    /** Complete file content after the operation; identical to the input when nothing changed. */
    content: string;
    added: boolean;
    status: 'added' | 'duplicate' | 'corrupt';
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
export declare function upsertRule(fileContent: string | undefined, rule: string): UpsertResult;
