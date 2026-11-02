import { describe, expect, it } from 'vitest'
import { expandWorktreeEnv, hasOwnPort, nameSafe, slotPort, withOwnPort } from './worktreeEnv'
import { localModelArgs, localModelEnv, parseLocalModel, runsLocal } from './localModels'

describe('each worktree its own environment', () => {
  it('gives each slot a block of ports from the base', () => {
    expect(slotPort(3100, 0)).toBe(3100)
    expect(slotPort(3100, 2)).toBe(3120)
    expect(slotPort(0, 1)).toBe(3110)
  })

  it('fills in the placeholders and adds its own variables', () => {
    const env = expandWorktreeEnv({ PORT: '{port}', API_PORT: '{port+1}', DATABASE_URL: 'postgres://localhost/app_{task}', CACHE: '/tmp/c{slot}', PLAIN: 'x' }, { slot: 2, port: 3120, task: 'SYT-42' })
    expect(env).toEqual({
      SWITCHYARD_SLOT: '2',
      SWITCHYARD_PORT: '3120',
      SWITCHYARD_TASK: 'SYT-42',
      PORT: '3120',
      API_PORT: '3121',
      DATABASE_URL: 'postgres://localhost/app_syt_42',
      CACHE: '/tmp/c2',
      PLAIN: 'x'
    })
    // Your own checkout: slot 0, "main".
    expect(expandWorktreeEnv({ DB: 'app_{task}' }, { slot: 0, port: 3100, task: null }).DB).toBe('app_main')
    expect(nameSafe('My Proj-7')).toBe('my_proj_7')
  })

  it("switches the project's own PORT line on and off", () => {
    expect(hasOwnPort('A=1\nPORT={port}')).toBe(true)
    expect(hasOwnPort('PORT=3000')).toBe(false)
    expect(withOwnPort('A=1\nPORT=3000', true)).toBe('PORT={port}\nA=1')
    expect(withOwnPort('PORT={port}\nA=1', false)).toBe('A=1')
    expect(withOwnPort('PORT = {port}', false)).toBeUndefined()
    expect(withOwnPort(undefined, true)).toBe('PORT={port}')
  })
})

describe('local models', () => {
  it('reads a local model id', () => {
    expect(parseLocalModel('ollama/qwen2.5-coder:7b')).toEqual({ provider: 'ollama', name: 'qwen2.5-coder:7b' })
    expect(parseLocalModel('lmstudio/org/model-gguf')).toEqual({ provider: 'lmstudio', name: 'org/model-gguf' })
    expect(parseLocalModel('opus')).toBeNull()
  })

  it("becomes each agent's own arguments and variables", () => {
    expect(localModelArgs('aider', 'ollama/llama3')).toEqual(['--model', 'ollama_chat/llama3'])
    expect(localModelArgs('aider', 'lmstudio/qwen')).toEqual(['--model', 'lm_studio/qwen'])
    expect(localModelArgs('codex', 'ollama/gpt-oss:20b')).toEqual(['--oss', '--model', 'gpt-oss:20b'])
    // Codex doesn't run LM Studio's; other agents get the model as typed.
    expect(localModelArgs('codex', 'lmstudio/qwen')).toBeNull()
    expect(localModelArgs('opencode', 'ollama/llama3')).toBeNull()
    expect(localModelArgs('claude', 'sonnet')).toBeNull()
    expect(runsLocal('aider', 'ollama/x')).toBe(true)
    expect(localModelEnv('aider', 'ollama/llama3', {})).toEqual({ OLLAMA_API_BASE: 'http://127.0.0.1:11434' })
    expect(localModelEnv('aider', 'lmstudio/q', { lmstudio: 'http://box:1234/' })).toEqual({ LM_STUDIO_API_BASE: 'http://box:1234/v1', LM_STUDIO_API_KEY: 'lm-studio' })
    expect(localModelEnv('codex', 'ollama/x', { ollama: 'http://gpu:11434' })).toEqual({ CODEX_OSS_BASE_URL: 'http://gpu:11434/v1' })
    expect(localModelEnv('claude', 'ollama/x', {})).toEqual({})
  })
})
