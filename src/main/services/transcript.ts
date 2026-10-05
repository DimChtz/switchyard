import { promises as fs } from 'fs'
import { basename } from 'path'
import type { TranscriptSummary } from '@shared/types'
import { dayOf, type UsageEntry, type UsageTokens } from '@shared/usage'

/** A tool call as a short line: "Editing user.rb", "Running npm test". */
export function describeTool(tool: string, input: Record<string, unknown> | undefined): string {
  const s = (k: string): string => (typeof input?.[k] === 'string' ? (input[k] as string) : '')
  const file = basename(s('file_path') || s('notebook_path') || s('path') || '')
  switch (tool) {
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editing ${file}`
    case 'Write':
      return `Writing ${file}`
    case 'Read':
      return `Reading ${file}`
    case 'Bash':
    case 'PowerShell':
      return `Running ${s('command').replace(/\s+/g, ' ').trim().slice(0, 90)}`
    case 'Grep':
      return `Searching for ${s('pattern').slice(0, 60)}`
    case 'Glob':
      return `Finding ${s('pattern').slice(0, 60)}`
    case 'WebFetch':
      return `Fetching ${s('url').replace(/^https?:\/\//, '').split('/')[0]}`
    case 'WebSearch':
      return `Searching the web for ${s('query').slice(0, 60)}`
    case 'Task':
    case 'Agent':
      return `Subagent: ${s('description') || 'working'}`
    case 'TodoWrite':
      return 'Updating its plan'
    default:
      return tool.startsWith('mcp__') ? `Using ${tool.split('__').slice(1).join(' ')}` : `Using ${tool}`
  }
}

interface Line {
  type?: string
  isMeta?: boolean
  timestamp?: string
  message?: {
    id?: string
    model?: string
    role?: string
    content?: string | { type: string; name?: string; input?: Record<string, unknown>; text?: string }[]
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  }
}

const KEEP_TOOLS = 40

/**
 * Reads a Claude Code transcript (one JSON object per line) for what the
 * session cost in tokens and what it did.
 */
export async function summarize(path: string): Promise<TranscriptSummary> {
  if (!path.endsWith('.jsonl')) throw new Error('Not a transcript')
  const raw = await fs.readFile(path, 'utf-8')
  // A message's content blocks are separate lines sharing its id and usage.
  const usage = new Map<string, NonNullable<NonNullable<Line['message']>['usage']>>()
  const tools: TranscriptSummary['tools'] = []
  let toolCount = 0
  let prompts = 0
  let model: string | null = null
  for (const text of raw.split('\n')) {
    if (!text.trim()) continue
    let line: Line
    try {
      line = JSON.parse(text)
    } catch {
      continue
    }
    const msg = line.message
    if (!msg) continue
    if (line.type === 'assistant') {
      if (msg.model && !msg.model.startsWith('<')) model = msg.model
      if (msg.id && msg.usage) usage.set(msg.id, msg.usage)
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type !== 'tool_use' || !block.name) continue
          toolCount++
          tools.push({ name: block.name, what: describeTool(block.name, block.input), at: Date.parse(line.timestamp ?? '') || 0 })
          if (tools.length > KEEP_TOOLS) tools.shift()
        }
      }
    } else if (line.type === 'user' && !line.isMeta) {
      // Prompts are text; tool results come back as user messages too.
      const isPrompt = typeof msg.content === 'string' ? !msg.content.startsWith('<') : !!msg.content?.some((b) => b.type === 'text')
      if (isPrompt) prompts++
    }
  }
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const u of usage.values()) {
    tokens.input += u.input_tokens ?? 0
    tokens.output += u.output_tokens ?? 0
    tokens.cacheRead += u.cache_read_input_tokens ?? 0
    tokens.cacheWrite += u.cache_creation_input_tokens ?? 0
  }
  return { tokens, prompts, tools, toolCount, model }
}

/** Tokens used by the transcript's messages from `from` to `to` (ms), by model. */
export async function usageBetween(path: string, from: number, to: number): Promise<Record<string, UsageTokens>> {
  if (!path.endsWith('.jsonl')) throw new Error('Not a transcript')
  const raw = await fs.readFile(path, 'utf-8')
  const seen = new Map<string, { model: string; u: NonNullable<NonNullable<Line['message']>['usage']> }>()
  for (const text of raw.split('\n')) {
    if (!text.includes('"usage"')) continue
    let line: Line
    try {
      line = JSON.parse(text)
    } catch {
      continue
    }
    const msg = line.message
    const at = Date.parse(line.timestamp ?? '')
    if (line.type !== 'assistant' || !msg?.usage || !msg.id || !msg.model || msg.model.startsWith('<') || !(at > from && at <= to)) continue
    seen.set(msg.id, { model: msg.model, u: msg.usage })
  }
  const out: Record<string, UsageTokens> = {}
  for (const { model, u } of seen.values()) {
    const t = (out[model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    t.input += u.input_tokens ?? 0
    t.output += u.output_tokens ?? 0
    t.cacheRead += u.cache_read_input_tokens ?? 0
    t.cacheWrite += u.cache_creation_input_tokens ?? 0
  }
  return out
}

/** The text of the transcript's last assistant message (its content blocks' text, joined). */
export async function lastAssistantText(path: string): Promise<string | null> {
  if (!path.endsWith('.jsonl')) throw new Error('Not a transcript')
  const lines = (await fs.readFile(path, 'utf-8')).split('\n')
  let id: string | null = null
  const parts: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant"')) continue
    let line: Line
    try {
      line = JSON.parse(lines[i])
    } catch {
      continue
    }
    const msg = line.message
    if (line.type !== 'assistant' || !msg) continue
    // One message's blocks are consecutive lines sharing its id.
    if (id !== null && msg.id !== id) break
    id = msg.id ?? ''
    const text = typeof msg.content === 'string' ? msg.content : (msg.content ?? []).filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n')
    if (text) parts.unshift(text)
  }
  return parts.length ? parts.join('\n') : null
}

/**
 * A transcript's token use by local day and model (a message's content
 * blocks are separate lines sharing its id and usage - counted once).
 */
export async function dailyUsage(path: string): Promise<UsageEntry['days']> {
  if (!path.endsWith('.jsonl')) throw new Error('Not a transcript')
  const raw = await fs.readFile(path, 'utf-8')
  const seen = new Map<string, { day: string; model: string; u: NonNullable<NonNullable<Line['message']>['usage']> }>()
  for (const text of raw.split('\n')) {
    if (!text.includes('"usage"')) continue
    let line: Line
    try {
      line = JSON.parse(text)
    } catch {
      continue
    }
    const msg = line.message
    if (line.type !== 'assistant' || !msg?.usage || !msg.id || !msg.model || msg.model.startsWith('<')) continue
    seen.set(msg.id, { day: dayOf(Date.parse(line.timestamp ?? '') || Date.now()), model: msg.model, u: msg.usage })
  }
  const days: UsageEntry['days'] = {}
  for (const { day, model, u } of seen.values()) {
    const m = (days[day] ??= {})
    const t = (m[model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    t.input += u.input_tokens ?? 0
    t.output += u.output_tokens ?? 0
    t.cacheRead += u.cache_read_input_tokens ?? 0
    t.cacheWrite += u.cache_creation_input_tokens ?? 0
  }
  return days
}
