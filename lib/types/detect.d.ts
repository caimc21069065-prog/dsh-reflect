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
/** True when the text looks like it carries a credential or private key. */
export declare function looksSensitive(text: string): boolean;
export type FastFilterResult = {
    pass: true;
    text: string;
} | {
    pass: false;
    reason: string;
};
/**
 * Layer 1 filter. `rememberPrefixes` are excluded here because explicit
 * triggers take the confirm flow directly and must not be double-classified.
 * With `patternGate` enabled, prompts without any correction wording are
 * dropped before the classifier call.
 */
export declare function fastFilter(rawText: string, maxChars: number, rememberPrefixes: readonly string[], patternGate?: boolean): FastFilterResult;
export interface Classification {
    isRule: boolean;
    rule: string;
    scopeHint: 'global' | 'project' | null;
    confidence: number;
}
/** Build the one-shot classifier request body. */
export declare function buildClassifierRequest(text: string): {
    system: string;
    user: string;
};
/**
 * Parse the classifier's output. Tolerates prose around the JSON object and
 * returns `undefined` for anything malformed — the caller then drops the
 * candidate silently.
 */
export declare function parseClassification(raw: string): Classification | undefined;
