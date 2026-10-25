/**
 * Plugin configuration schema (Schemastery). The exported `Config` is both
 * the TypeScript shape and the runtime validator; profile patch rows may
 * override any field, and defaults make the plugin zero-config (requirement
 * 2.2).
 *
 * @module dsh-reflect/config
 */
import Schema from '@deepseek-ai/schemastery';
export interface ReflectConfig {
    /** Master switch; when false the plugin installs nothing. */
    enabled: boolean;
    /** Layer-2 automatic detection of correction prompts (F2). */
    autoDetect: boolean;
    /** Maximum prompt length that may enter automatic detection. */
    detectMaxChars: number;
    /**
     * Optional regex pre-gate before the classifier call: prompts without any
     * correction wording are dropped early. Cheaper, but may miss unusually
     * phrased corrections (reduced recall).
     */
    detectPatternGate: boolean;
    /** Wall-clock budget for one classifier call. */
    detectTimeoutMs: number;
    /** Minimum classifier confidence before the confirm bar appears. */
    confidenceThreshold: number;
    /** Classifier provider route; empty reuses the current agent's route. */
    classifierProvider: string;
    /** Classifier model id; empty reuses the current agent's model. */
    classifierModel: string;
    /** Explicit trigger prefixes, matched case-insensitively at message start. */
    rememberPrefixes: string[];
    /** Global target file; empty resolves to `$DSH_HOME/AGENTS.md` (or `~/.dsh/AGENTS.md`). */
    globalAgentsFile: string;
    /** Project target file name, resolved against the session working directory. */
    projectAgentsFile: string;
    /** Confirm-bar copy language. */
    locale: 'zh' | 'en';
}
export declare const Config: Schema<ReflectConfig>;
