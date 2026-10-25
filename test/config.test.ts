import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import type { ReflectConfig } from '../src/config.ts'

describe('Config schema', () => {
  it('fills every field from defaults for an empty override', () => {
    const config = Config({} as never) as unknown as ReflectConfig
    expect(config).toEqual({
      enabled: true,
      autoDetect: true,
      detectMaxChars: 500,
      detectPatternGate: false,
      detectTimeoutMs: 8000,
      confidenceThreshold: 0.7,
      classifierProvider: '',
      classifierModel: '',
      rememberPrefixes: ['remember:', '记住:', '记住：'],
      globalAgentsFile: '',
      projectAgentsFile: 'AGENTS.md',
      locale: 'zh',
    })
  })

  it('accepts partial overrides', () => {
    const config = Config({ autoDetect: false, detectMaxChars: 200, locale: 'en' } as never) as unknown as ReflectConfig
    expect(config.autoDetect).toBe(false)
    expect(config.detectMaxChars).toBe(200)
    expect(config.locale).toBe('en')
    expect(config.confidenceThreshold).toBe(0.7)
  })

  it('rejects invalid values', () => {
    expect(() => Config({ detectMaxChars: 'lots' } as never)).toThrow()
    expect(() => Config({ confidenceThreshold: 5 } as never)).toThrow()
  })
})
