import type { AgentDef } from './types'

/**
 * Plugins: a folder in <userData>/plugins with a plugin.json (what it adds)
 * and, optionally, a main.js run in the plugin host (a separate Node
 * process). See the README a new plugin gets (Settings → Plugins → New).
 */

export interface PluginCommand {
  /** Its own id ("copy-markdown"); the app knows it as "<plugin>.<id>". */
  id: string
  title: string
  /** A default key ("ctrl+alt+m"); keybindings.json can change it like any other. */
  key?: string
  /** When the key works (keybindings.json's "when"). */
  when?: string
}

export type PluginAgent = Pick<AgentDef, 'kind' | 'name' | 'bin'> & Partial<Pick<AgentDef, 'short' | 'note' | 'resumeArgs' | 'promptFlag' | 'typesPrompt'>>

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  /** The script to run (relative to the plugin's folder); none: it only declares agents. */
  main?: string
  commands?: PluginCommand[]
  agents?: PluginAgent[]
  /** The Switchyard versions it works with: { "switchyard": ">=0.2.0" }. */
  engines?: { switchyard?: string }
}

/** Where a plugin came from: a package (file or link), made here (New plugin), or linked from a folder being worked on. */
export type PluginSource = { kind: 'installed'; from: string; at: number } | { kind: 'local' } | { kind: 'development' }

export interface PluginInfo {
  /** Its folder. */
  dir: string
  source: PluginSource
  manifest: PluginManifest | null
  enabled: boolean
  /** off · starting · running (its script is loaded) · ready (on, nothing to run) · error */
  status: 'off' | 'starting' | 'running' | 'ready' | 'error'
  error: string | null
}

/** A package looked at before it's installed (Settings shows it to confirm). */
export interface PackagePreview {
  token: string
  manifest: PluginManifest
  files: number
  bytes: number
  /** The file or link it came from. */
  from: string
  /** The plugin with this id already here. */
  current: { version: string; source: PluginSource['kind']; enabled: boolean } | null
  /** Why it can't be installed (it still shows). */
  problem: string | null
}

export type BadgeTone = 'info' | 'success' | 'warn' | 'danger' | 'muted'

/** A small label a plugin puts on a task's card. */
export interface PluginBadge {
  text: string
  tone?: BadgeTone
  tooltip?: string
}

/** What a plugin asks the app's window to do. */
export type PluginUiEvent =
  | { type: 'toast'; plugin: string; text: string }
  | { type: 'message'; plugin: string; taskId: string; text: string }
  | { type: 'createTask'; plugin: string; projectId: string; title: string; desc: string; col: 'backlog' | 'ready' }
  | { type: 'badges'; plugin: string; taskId: string; badges: PluginBadge[] }
  | { type: 'clearBadges'; plugin: string }

/** Where a command was run from, for its handler. */
export interface PluginCommandContext {
  taskId: string | null
  projectId: string | null
}

const ID = /^[a-z0-9][a-z0-9-]{0,40}$/
const BIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/
const BUILTIN_KINDS = ['claude', 'codex', 'gemini', 'aider', 'opencode', 'cursor', 'copilot']

const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === 'string' && x.length <= 200)

/** A plugin.json checked: the manifest, or what's wrong with it. `folder`: the name its folder must have (an installed plugin's). */
export function checkManifest(raw: unknown, folder?: string): { manifest: PluginManifest } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'plugin.json must be an object' }
  const m = raw as Record<string, unknown>
  if (!str(m.id) || !ID.test(m.id)) return { error: '"id" must be lowercase letters, digits and dashes (e.g. "my-plugin")' }
  if (folder !== undefined && m.id !== folder) return { error: `"id" (${m.id}) must match its folder's name (${folder})` }
  if (!str(m.name, 60)) return { error: '"name" is missing' }
  if (!str(m.version, 30)) return { error: '"version" is missing' }
  if (m.description !== undefined && typeof m.description !== 'string') return { error: '"description" must be text' }
  if (m.main !== undefined && (!str(m.main) || /(^|[\\/])\.\.([\\/]|$)/.test(m.main) || /^([a-zA-Z]:|[\\/])/.test(m.main)))
    return { error: '"main" must be a file inside the plugin\'s folder' }

  const commands: PluginCommand[] = []
  if (m.commands !== undefined) {
    if (!Array.isArray(m.commands)) return { error: '"commands" must be a list' }
    for (const c of m.commands as Record<string, unknown>[]) {
      if (!c || !str(c.id) || !ID.test(c.id)) return { error: 'each command needs an "id" (lowercase letters, digits, dashes)' }
      if (!str(c.title, 80)) return { error: `command "${c.id}" needs a "title"` }
      if (c.key !== undefined && !str(c.key, 40)) return { error: `command "${c.id}": "key" must be text like "ctrl+alt+m"` }
      if (c.when !== undefined && !str(c.when)) return { error: `command "${c.id}": "when" must be text` }
      if (commands.some((x) => x.id === c.id)) return { error: `command "${c.id}" is there twice` }
      commands.push({ id: c.id, title: c.title, key: c.key as string | undefined, when: c.when as string | undefined })
    }
  }

  const agents: PluginAgent[] = []
  if (m.agents !== undefined) {
    if (!Array.isArray(m.agents)) return { error: '"agents" must be a list' }
    for (const a of m.agents as Record<string, unknown>[]) {
      if (!a || !str(a.kind) || !ID.test(a.kind)) return { error: 'each agent needs a "kind" (lowercase letters, digits, dashes)' }
      if (BUILTIN_KINDS.includes(a.kind)) return { error: `agent "${a.kind}" is built in already` }
      if (!str(a.name, 40)) return { error: `agent "${a.kind}" needs a "name"` }
      if (!str(a.bin) || !BIN.test(a.bin)) return { error: `agent "${a.kind}": "bin" must be the program's name on PATH (e.g. "goose")` }
      if (a.resumeArgs !== undefined && !strList(a.resumeArgs)) return { error: `agent "${a.kind}": "resumeArgs" must be a list of text` }
      if (a.promptFlag !== undefined && !str(a.promptFlag, 40)) return { error: `agent "${a.kind}": "promptFlag" must be text` }
      agents.push({
        kind: a.kind,
        name: a.name,
        bin: a.bin,
        short: str(a.short, 20) ? a.short : a.kind,
        note: str(a.note, 80) ? a.note : `From the ${m.name} plugin`,
        resumeArgs: a.resumeArgs as string[] | undefined,
        promptFlag: a.promptFlag as string | undefined,
        typesPrompt: a.typesPrompt === true
      })
    }
  }
  if (!m.main && !agents.length) return { error: 'it has neither a "main" script nor "agents"' }
  let engines: PluginManifest['engines']
  if (m.engines !== undefined) {
    const e = m.engines as Record<string, unknown>
    if (!e || typeof e !== 'object' || (e.switchyard !== undefined && (typeof e.switchyard !== 'string' || !parseRange(e.switchyard))))
      return { error: '"engines.switchyard" must be a version range like ">=0.2.0" or "^0.2.0"' }
    engines = typeof e.switchyard === 'string' ? { switchyard: e.switchyard } : undefined
  }
  return {
    manifest: {
      id: m.id,
      name: m.name,
      version: m.version,
      description: typeof m.description === 'string' ? m.description.slice(0, 300) : undefined,
      main: m.main as string | undefined,
      commands,
      agents,
      engines
    }
  }
}

type Version = [number, number, number]
const parseVersion = (v: string): Version | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
/** -1, 0 or 1 (versions it can't read count as the same). */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}
function parseRange(r: string): { op: '>=' | '^' | '='; v: string } | null {
  const m = /^\s*(>=|\^|=)?\s*(v?\d+\.\d+\.\d+)\s*$/.exec(r)
  return m ? { op: (m[1] as '>=' | '^' | '=' | undefined) ?? '=', v: m[2] } : null
}
/** Whether this app's version is in a plugin's "engines.switchyard" range (">=0.2.0", "^0.2.0", "0.2.0"). */
export function appSatisfies(app: string, range: string | undefined): boolean {
  if (!range) return true
  const r = parseRange(range)
  if (!r) return false
  const c = compareVersions(app, r.v)
  if (r.op === '=') return c === 0
  if (r.op === '>=') return c >= 0
  // ^x.y.z: the same major (for 0.x, the same minor), and at least that.
  const a = parseVersion(app)!
  const b = parseVersion(r.v)!
  return c >= 0 && a[0] === b[0] && (b[0] > 0 || a[1] === b[1])
}

/** A badge as a plugin sent it, cleaned (anything odd is dropped). */
export function cleanBadges(raw: unknown): PluginBadge[] | null {
  if (!Array.isArray(raw)) return null
  const tones: BadgeTone[] = ['info', 'success', 'warn', 'danger', 'muted']
  return raw.slice(0, 20).flatMap((b): PluginBadge[] => {
    if (!b || typeof b !== 'object') return []
    const { text, tone, tooltip } = b as Record<string, unknown>
    if (typeof text !== 'string' || !text.trim()) return []
    return [{ text: text.trim().slice(0, 24), tone: tones.includes(tone as BadgeTone) ? (tone as BadgeTone) : 'info', tooltip: typeof tooltip === 'string' ? tooltip.slice(0, 300) : undefined }]
  }).slice(0, 3)
}

/** The app's id for a plugin's command. */
export const pluginCommandId = (plugin: string, command: string): string => `${plugin}.${command}`
