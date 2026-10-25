/**
 * Plugin configuration schema (Schemastery). The exported `Config` is both
 * the TypeScript shape and the runtime validator; profile patch rows may
 * override any field, and defaults make the plugin zero-config (requirement
 * 2.2).
 *
 * @module dsh-reflect/config
 */

import Schema from '@deepseek-ai/schemastery'

export interface ReflectConfig {
  /** Master switch; when false the plugin installs nothing. */
  enabled: boolean
  /** Layer-2 automatic detection of correction prompts (F2). */
  autoDetect: boolean
  /** Maximum prompt length that may enter automatic detection. */
  detectMaxChars: number
  /**
   * Optional regex pre-gate before the classifier call: prompts without any
   * correction wording are dropped early. Cheaper, but may miss unusually
   * phrased corrections (reduced recall).
   */
  detectPatternGate: boolean
  /** Wall-clock budget for one classifier call. */
  detectTimeoutMs: number
  /** Minimum classifier confidence before the confirm bar appears. */
  confidenceThreshold: number
  /** Classifier provider route; empty reuses the current agent's route. */
  classifierProvider: string
  /** Classifier model id; empty reuses the current agent's model. */
  classifierModel: string
  /** Explicit trigger prefixes, matched case-insensitively at message start. */
  rememberPrefixes: string[]
  /** Global target file; empty resolves to `$DSH_HOME/AGENTS.md` (or `~/.dsh/AGENTS.md`). */
  globalAgentsFile: string
  /** Project target file name, resolved against the session working directory. */
  projectAgentsFile: string
  /** Confirm-bar copy language. */
  locale: 'zh' | 'en'
}

export const Config: Schema<ReflectConfig> = Schema.object({
  enabled: Schema.boolean().description('总开关；关闭后插件不拦截也不检测').default(true),
  autoDetect: Schema.boolean().description('自动检测纠正类短提示（F2）').default(true),
  detectMaxChars: Schema.number().min(4).max(4000).description('参与自动检测的最大提示长度（字符）').default(500),
  detectPatternGate: Schema.boolean()
    .description('分类前先做纠正模式正则初筛：省一次模型调用，但可能漏掉不合常见措辞的纠正')
    .default(false),
  detectTimeoutMs: Schema.number().min(1000).max(60000).description('分类模型超时（毫秒）').default(8000),
  confidenceThreshold: Schema.number().min(0).max(1).description('弹出确认条的最低置信度').default(0.7),
  classifierProvider: Schema.string().description('分类模型 provider；留空复用当前会话模型路由').default(''),
  classifierModel: Schema.string().description('分类模型 id；留空复用当前会话模型').default(''),
  rememberPrefixes: Schema.array(Schema.string())
    .description('显式触发前缀（大小写不敏感，需匹配消息开头）')
    .default(['remember:', '记住:', '记住：']),
  globalAgentsFile: Schema.string().description('全局规则文件；留空为 $DSH_HOME/AGENTS.md（默认 ~/.dsh/AGENTS.md）').default(''),
  projectAgentsFile: Schema.string().description('项目规则文件名（相对会话工作目录）').default('AGENTS.md'),
  locale: Schema.union(['zh', 'en']).description('确认条文案语言').default('zh'),
}) as Schema<ReflectConfig>
