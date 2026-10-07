import type { AgentDef, BoardColumn, Prefs, ProjectSettingKey } from './types'

export const AGENTS: AgentDef[] = [
  { kind: 'claude', name: 'Claude Code', short: 'claude', bin: 'claude', note: 'Anthropic · general purpose', resumeArgs: ['--continue'], tools: 'claude' },
  { kind: 'codex', name: 'Codex', short: 'codex', bin: 'codex', note: 'OpenAI · general purpose', resumeArgs: ['resume', '--last'], tools: 'codex' },
  // A bare prompt makes Gemini CLI answer once and exit; -i keeps the session open.
  { kind: 'gemini', name: 'Gemini CLI', short: 'gemini', bin: 'gemini', note: 'Google · general purpose', resumeArgs: ['--resume', 'latest'], promptFlag: '-i' },
  // A message on the command line makes Aider answer once and exit: it's typed in instead.
  { kind: 'aider', name: 'Aider', short: 'aider', bin: 'aider', note: 'Open source · any model', resumeArgs: ['--restore-chat-history'], typesPrompt: true },
  { kind: 'opencode', name: 'OpenCode', short: 'opencode', bin: 'opencode', note: 'Open source · any model', resumeArgs: ['--continue'], promptFlag: '--prompt', tools: 'opencode' },
  { kind: 'cursor', name: 'Cursor CLI', short: 'cursor', bin: 'cursor-agent', note: 'Cursor · general purpose', resumeArgs: ['resume'] },
  { kind: 'copilot', name: 'Copilot CLI', short: 'copilot', bin: 'copilot', note: 'GitHub · general purpose', resumeArgs: ['--continue'], promptFlag: '-i', tools: 'copilot' }
]
const BUILTIN_AGENTS = AGENTS.length

/**
 * The agents plugins add, after the built-in ones (replacing what plugins
 * added before). AGENTS is changed in place: everything that lists agents
 * reads it.
 */
export function setPluginAgents(defs: AgentDef[]): void {
  AGENTS.splice(BUILTIN_AGENTS, AGENTS.length - BUILTIN_AGENTS, ...defs.filter((d, i) => !AGENTS.slice(0, BUILTIN_AGENTS).some((a) => a.kind === d.kind) && defs.findIndex((x) => x.kind === d.kind) === i))
}

export const COLUMN_ORDER: BoardColumn[] = ['backlog', 'ready', 'progress', 'review', 'done']
export const COLUMN_LABEL: Record<BoardColumn, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  progress: 'In Progress',
  review: 'Review',
  done: 'Done'
}

/** What .switchyard/settings.json (and settings.local.json) may set for a project. */
export const PROJECT_SETTING_KEYS: ProjectSettingKey[] = ['prefix', 'defaultBranch', 'lang', 'agentKind', 'setupCmd', 'testCmd', 'devCmd', 'copyFiles', 'messageTemplate', 'env']

/**
 * Preferences that belong to the app as a whole, not to a project - a
 * project's .switchyard/settings.json can't set these (the rest it can).
 */
export const APP_PREF_KEYS: (keyof Prefs)[] = [
  'defaultAgent',
  'notifyInput',
  'notifyDone',
  'sound',
  'confirmQuit',
  'agentsOff',
  'maxAgents',
  'notesDir',
  'theme',
  'modelPrices',
  'noticeKinds',
  'mutedProjects',
  'spendAlert',
  'spendAlertWeek',
  'agentTools',
  'teamIntroduce',
  'dailySummary',
  'summaryAt',
  'spendAlertMonth',
  'projectBudgets',
  'worktreeRoot',
  'cloneDir',
  'staleDays',
  'autoPrune',
  'fetchMinutes',
  'autoPullBase',
  'autoUpdate',
  // A repository's settings file can't turn a plugin on (plugins run code).
  'plugins',
  'pluginFolders'
]

export const DEFAULT_PREFS: Prefs = {
  defaultAgent: 'claude',
  openAfterStart: true,
  notifyInput: true,
  notifyDone: true,
  sound: false,
  confirmQuit: true,
  agentsOff: [],
  maxAgents: 0,
  notesDir: '',
  agentArgs: {},
  editPerm: 'agent',
  shellPerm: 'agent',
  allowlist: 'npm, pnpm, yarn, bundle, git status, git diff',
  worktreeRoot: '',
  branchPattern: 'feature/{slug}',
  pruneAfterMerge: true,
  deleteBranchOnFinish: true,
  finishOnPrMerge: true,
  prMergeMethod: 'squash',
  confirmRemove: true,
  syncMode: 'rebase',
  warnBehind: true,
  cloneDir: '',
  shell: '',
  termFontSize: 13,
  termFont: '',
  termScrollback: 5000,
  termCursor: 'block',
  termCursorBlink: true,
  termCopyOnSelect: false,
  staleDays: 14,
  autoPrune: false,
  editor: '',
  editorFont: '',
  editorFontSize: 12.5,
  editorLineHeight: 1.5,
  editorLigatures: true,
  editorTabSize: 2,
  editorUseTabs: false,
  editorWordWrap: false,
  editorLineNumbers: true,
  editorActiveLine: true,
  theme: 'dark',
  modelPrices: {},
  noticeKinds: ['waiting', 'permission', 'failed', 'done', 'tests-passed', 'tests-failed', 'finished', 'pr-merged', 'spend', 'review-reply', 'agent-question', 'team', 'limit', 'pr'],
  mutedProjects: [],
  spendAlert: 0,
  spendAlertWeek: 0,
  agentTools: true,
  teamIntroduce: true,
  dailySummary: true,
  summaryAt: '09:00',
  spendAlertMonth: 0,
  projectBudgets: {},
  editorWhitespace: false,
  editorBracketMatching: true,
  editorTrimOnSave: false,
  editorFinalNewline: false,
  editorAutoSave: 'off',
  editorConfig: true,
  fetchMinutes: 10,
  autoPullBase: false,
  autoUpdate: true,
  plugins: [],
  pluginFolders: [],
  termGpu: true
}

/** Monospace fonts offered for the file editor, when installed. */
export const EDITOR_FONTS = [
  'Geist Mono',
  'Cascadia Code',
  'Cascadia Mono',
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro',
  'Consolas',
  'SF Mono',
  'Menlo',
  'Monaco',
  'Ubuntu Mono',
  'DejaVu Sans Mono',
  'Hack',
  'IBM Plex Mono',
  'Roboto Mono',
  'Courier New'
]

/** Languages offered in project settings (detection may add others). */
export const LANGUAGES = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Ruby', 'Java', 'Kotlin', 'C#', 'PHP', 'Elixir', 'Other']

/** Branch name for a task from the pattern in Git settings. */
export function branchFor(pattern: string, title: string, key: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40)
  return (pattern || 'feature/{slug}').replace(/\{slug\}/g, slug || 'task').replace(/\{key\}/g, key.toLowerCase()).replace(/\s/g, '-')
}

/** Task prefix from a project name: initials of a multi-word name, else its first letters. */
export function prefixFor(name: string, used: string[] = []): string {
  const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  const base = (parts.length > 1 ? parts.map((w) => w[0]).join('').slice(0, 3) : name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3)).toUpperCase() || 'TSK'
  let prefix = base
  for (let i = 2; used.includes(prefix); i++) prefix = base + i
  return prefix
}

export const DEFAULT_MESSAGE_TEMPLATE = 'Implement {key}: {desc} Add tests.'

/** The Start modal's first message from a project's template. {desc} falls back to the title. */
export function firstMessage(template: string | undefined, t: { key: string; title: string; desc?: string }, branch: string): string {
  return (template || DEFAULT_MESSAGE_TEMPLATE)
    .replace(/\{key\}/g, t.key)
    .replace(/\{title\}/g, t.title)
    .replace(/\{desc\}/g, t.desc || t.title)
    .replace(/\{branch\}/g, branch)
}

/** Parses KEY=value lines (# comments, optional quotes, "export " allowed). */
export function parseEnv(text: string | undefined): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    env[m[1]] = v
  }
  return env
}

/**
 * Why a worktree can be cleaned up, or null. Only worktrees no open task
 * uses: ones whose branch has no commits of its own (merged, or never
 * worked on), and ones untouched for `days`.
 */
export function staleReason(
  w: { linked: boolean; ahead: number; dirty: number; lastCommitAt: number },
  days: number,
  base: string,
  now = Date.now()
): string | null {
  if (w.linked) return null
  const dirty = w.dirty ? ` · ${w.dirty} uncommitted change${w.dirty > 1 ? 's' : ''}` : ''
  if (w.ahead === 0) return `No task · nothing beyond ${base}${dirty}`
  const age = w.lastCommitAt ? Math.floor((now - w.lastCommitAt) / 86_400_000) : Infinity
  if (age >= days) return `No task · last commit ${age === Infinity ? 'unknown' : `${age} days ago`}${dirty}`
  return null
}
