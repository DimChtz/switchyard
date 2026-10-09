import { app, BrowserWindow } from 'electron'
import { createHash } from 'crypto'
import * as db from './db'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'fs'
import { join, dirname, basename, resolve, sep } from 'path'
import { watch, type FSWatcher } from 'chokidar'
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from 'jsonc-parser'
import { AGENTS, APP_PREF_KEYS, DEFAULT_PREFS, PROJECT_SETTING_KEYS } from '@shared/constants'
import { keyCommands, normalizeKey, readBindings, type KeyBinding } from '@shared/keybindings'
import type { KeybindingsState, Prefs, Project, ProjectSettingKey, SettingsFileError } from '@shared/types'

/**
 * Settings as JSON files, the way VS Code keeps them:
 *
 * - settings.json in Switchyard's data folder: this machine's preferences.
 *   Only what differs from the defaults is written; comments are allowed and
 *   kept. The Settings screen edits it, and so can any editor - a save shows
 *   up at once.
 * - <repo>/.switchyard/settings.json: a project's shared settings (setup and
 *   test commands, branch, task prefix…), meant to be committed so the team
 *   gets them too.
 * - <repo>/.switchyard/settings.local.json: the same for this checkout only
 *   (kept out of git through .git/info/exclude). It wins over the shared file,
 *   which wins over what Switchyard keeps for the project.
 */

const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }

function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

/** A JSON-with-comments file: its value, or what's wrong with it. Missing or empty: undefined. */
function readJson(path: string): { value: unknown; text: string | null; error: string | null } {
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return { value: undefined, text: null, error: null }
  }
  if (!text.trim()) return { value: undefined, text, error: null }
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    const line = text.slice(0, errors[0].offset).split('\n').length
    return { value: undefined, text, error: `${printParseErrorCode(errors[0].error)} at line ${line}` }
  }
  return { value, text, error: null }
}

/** A JSON-with-comments object file: its values, or what's wrong with it. Missing: empty. */
function readObject(path: string): { data: Record<string, unknown>; text: string | null; error: string | null } {
  const r = readJson(path)
  if (r.error) return { data: {}, text: r.text, error: r.error }
  if (r.value === undefined) return { data: {}, text: r.text, error: null }
  if (!r.value || typeof r.value !== 'object' || Array.isArray(r.value)) return { data: {}, text: r.text, error: 'expected an object - { … }' }
  return { data: r.value as Record<string, unknown>, text: r.text, error: null }
}

// Our own writes, so the watcher doesn't report them back.
const written = new Map<string, string>()

/** Sets (or, with undefined, removes) top-level keys, keeping the rest of the file - comments too. */
function writeKeys(path: string, patch: Record<string, unknown>, header: string): void {
  const current = readObject(path)
  if (current.error) throw new Error(`${basename(path)} has an error (${current.error}) - fix it first`)
  let text = current.text?.trim() ? current.text : `${header}{}\n`
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined && !(key in current.data)) continue
    text = applyEdits(text, modify(text, [key], value, FORMAT))
  }
  save(path, text)
}

function save(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  written.set(resolve(path), text)
  writeFileSync(path, text, 'utf-8')
}

/* ---------- this machine's preferences ---------- */

export function userSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

const USER_HEADER = `// Switchyard settings for this machine. Only what differs from the defaults
// is kept here; the Settings screen edits this file too. Saved changes apply
// right away.
`

let userPrefs: Partial<Prefs> = {}
let userError: SettingsFileError | null = null

/** Keeps the known keys whose value has the default's type; the rest is ignored. */
function validPrefs(data: Record<string, unknown>): Partial<Prefs> {
  const out: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(DEFAULT_PREFS)) {
    const v = data[key]
    if (v === undefined) continue
    const ok = Array.isArray(def) ? Array.isArray(v) : def !== null && typeof def === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : typeof v === typeof def
    if (ok) out[key] = v
  }
  return out as Partial<Prefs>
}

function loadUser(): void {
  const r = readObject(userSettingsPath())
  if (r.error) {
    // The last good settings stay in use until the file is fixed.
    userError = { file: userSettingsPath(), message: r.error }
    return
  }
  userError = null
  userPrefs = validPrefs(r.data)
}

/**
 * Reads settings.json - first moving preferences that earlier versions kept
 * in the store into it, once.
 */
export function initUserSettings(legacy: Partial<Prefs>, clearLegacy: () => void): void {
  if (!existsSync(userSettingsPath())) {
    const changed = Object.fromEntries(Object.entries(validPrefs(legacy)).filter(([k, v]) => !same(v, DEFAULT_PREFS[k as keyof Prefs])))
    writeKeys(userSettingsPath(), changed, USER_HEADER)
  }
  clearLegacy()
  loadUser()
  loadKeys()
}

export function getUserPrefs(): Prefs {
  return { ...DEFAULT_PREFS, ...userPrefs }
}

export function userSettingsError(): SettingsFileError | null {
  return userError
}

/** Saves changed preferences; a value set back to its default leaves the file. */
// Told after the user's settings change (through the app or settings.json).
const prefListeners = new Set<() => void>()
export function onUserPrefsChanged(cb: () => void): () => void {
  prefListeners.add(cb)
  return () => void prefListeners.delete(cb)
}
const prefsChanged = (): void => prefListeners.forEach((cb) => cb())

export function setUserPrefs(patch: Partial<Prefs>): Prefs {
  const edits: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) edits[k] = same(v, DEFAULT_PREFS[k as keyof Prefs]) ? undefined : v
  writeKeys(userSettingsPath(), edits, USER_HEADER)
  userPrefs = validPrefs({ ...userPrefs, ...patch })
  for (const [k, v] of Object.entries(edits)) if (v === undefined) delete (userPrefs as Record<string, unknown>)[k]
  prefsChanged()
  return getUserPrefs()
}

/** Creates settings.json if needed and returns its path (to open in an editor). */
export function ensureUserSettingsFile(): string {
  if (!existsSync(userSettingsPath())) writeKeys(userSettingsPath(), {}, USER_HEADER)
  return userSettingsPath()
}

/* ---------- keyboard shortcuts ---------- */

export function keybindingsPath(): string {
  return join(app.getPath('userData'), 'keybindings.json')
}

const KEYS_HEADER = `// Keyboard shortcuts for this machine. Each entry sets a key for a command;
// a command starting with "-" removes that command's default key:
//   { "key": "ctrl+alt+m", "command": "new-note" },
//   { "key": "ctrl+alt+n", "command": "-new-note" }
// Settings -> Keyboard shortcuts lists every command. Saved changes apply
// right away.
`

let keyState: KeybindingsState = { bindings: [], error: null, problems: [] }

function loadKeys(): void {
  const r = readJson(keybindingsPath())
  if (r.error) {
    // The last good shortcuts stay in use until the file is fixed.
    keyState = { ...keyState, error: r.error }
    return
  }
  const { bindings, problems } = readBindings(r.value ?? [], keyCommands(process.platform === 'darwin'))
  keyState = { bindings, error: null, problems }
}

export function getKeybindings(): KeybindingsState {
  return keyState
}

export function ensureKeybindingsFile(): string {
  if (!existsSync(keybindingsPath())) save(keybindingsPath(), `${KEYS_HEADER}[]\n`)
  return keybindingsPath()
}

/**
 * Gives a command a new key from the Settings screen (null: no key), in
 * place of what keybindings.json had for it. Setting the default key again
 * just removes the command's entries.
 */
export function setKeybinding(command: string, key: string | null): KeybindingsState {
  const path = keybindingsPath()
  const r = readJson(path)
  if (r.error) throw new Error(`keybindings.json has an error (${r.error}) - fix it first`)
  if (r.value !== undefined && !Array.isArray(r.value)) throw new Error('keybindings.json should be a list - [ … ]')
  const list = (r.value ?? []) as unknown[]
  let text = r.text?.trim() ? r.text : `${KEYS_HEADER}[]\n`
  const def = keyCommands(process.platform === 'darwin').find((c) => c.id === command)
  if (!def) throw new Error(`Unknown command ${command}`)
  // Its own entries go (from the end, so the indexes stay right).
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i] as { command?: unknown } | null
    if (e && typeof e === 'object' && (e.command === command || e.command === `-${command}`)) text = applyEdits(text, modify(text, [i], undefined, FORMAT))
  }
  const same = key !== null && def.key !== undefined && normalizeKey(key) === normalizeKey(def.key)
  if (!same) {
    const add = (entry: KeyBinding): void => {
      text = applyEdits(text, modify(text, [-1], entry, { ...FORMAT, isArrayInsertion: true }))
    }
    if (def.key) add({ key: def.key, command: `-${command}` })
    if (key !== null) add({ key, command, ...(def.when ? { when: def.when } : {}) })
  }
  save(path, text)
  loadKeys()
  return keyState
}

/* ---------- a project's files ---------- */

export function projectSettingsPath(repoPath: string, scope: 'shared' | 'local'): string {
  return join(repoPath, '.switchyard', scope === 'shared' ? 'settings.json' : 'settings.local.json')
}

const PROJECT_HEADER = `// Switchyard settings for this repository, shared with everyone who
// uses Switchyard on it - commit this file. Personal values go in
// settings.local.json next to it (git ignores that one). Preferences such as
// "editorTabSize" set here apply to this project over the user settings.
`
const LOCAL_HEADER = `// Switchyard settings for this checkout only - not committed.
// They win over settings.json.
`

function validProject(data: Record<string, unknown>): Partial<Project> {
  const out: Record<string, unknown> = {}
  for (const key of PROJECT_SETTING_KEYS) {
    const v = data[key]
    if (v === undefined) continue
    if (key === 'copyFiles' || key === 'depFolders') {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[key] = v
    } else if (key === 'shareDeps') {
      if (v === 'copy') out[key] = v
    } else if (key === 'agentKind') {
      if (AGENTS.some((a) => a.kind === v)) out[key] = v
    } else if (key === 'env' && v && typeof v === 'object' && !Array.isArray(v)) {
      // { "KEY": "value" } is the natural JSON way; Switchyard keeps KEY=value lines.
      out[key] = Object.entries(v as Record<string, unknown>)
        .map(([k, x]) => `${k}=${String(x)}`)
        .join('\n')
    } else if (typeof v === 'string') {
      out[key] = v
    }
  }
  return out as Partial<Project>
}

/**
 * Settings a repository's committed settings file can't apply on its own:
 * they run commands on your machine (setup, tests, dev server, the shell,
 * the editor), set the environment, or let agents do more without asking.
 * A cloned repository could otherwise run anything the moment a task
 * starts - so they wait until you trust them (VS Code's Workspace Trust,
 * for these). Trust is for these exact values: a change asks again.
 */
export const TRUST_KEYS = ['setupCmd', 'testCmd', 'devCmd', 'env', 'agentArgs', 'editPerm', 'shellPerm', 'allowlist', 'shell', 'editor'] as const

/** A fingerprint of what's being trusted. */
export function trustHash(values: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(Object.keys(values).sort().map((k) => [k, values[k]]))).digest('hex').slice(0, 32)
}

function trusted(repoPath: string): string | undefined {
  try {
    return db.getKv<Record<string, string>>('trustedSettings')?.[resolve(repoPath).toLowerCase()]
  } catch {
    return undefined
  }
}

/** You trusted what the repository's settings file asks for (this exact version of it). */
export function trustProjectSettings(repoPath: string, hash: string): void {
  const all = db.getKv<Record<string, string>>('trustedSettings') ?? {}
  db.setKv('trustedSettings', { ...all, [resolve(repoPath).toLowerCase()]: hash })
  broadcast('projects:changed')
}

/** The project with its repository's settings files on top, noting where each value came from. */
export function effectiveProject(p: Project): Project {
  const shared = readObject(projectSettingsPath(p.repoPath, 'shared'))
  const local = readObject(projectSettingsPath(p.repoPath, 'local'))
  const sources: NonNullable<Project['sources']> = {}
  const s = validProject(shared.data)
  const l = validProject(local.data)
  // Preferences the project sets for itself, over this machine's settings.json.
  const sp = projectPrefs(shared.data)
  const lp = projectPrefs(local.data)
  // The shared file's commands, environment and permissions: only once trusted.
  const asked: Record<string, unknown> = {}
  for (const k of TRUST_KEYS) {
    const v = (s as Record<string, unknown>)[k] ?? (sp as Record<string, unknown>)[k]
    if (v !== undefined) asked[k] = v
  }
  const hash = Object.keys(asked).length ? trustHash(asked) : ''
  const held = hash && trusted(p.repoPath) !== hash
  if (held) {
    for (const k of TRUST_KEYS) {
      delete (s as Record<string, unknown>)[k]
      delete (sp as Record<string, unknown>)[k]
    }
  }
  for (const k of [...Object.keys(s), ...Object.keys(sp)] as (keyof typeof sources)[]) sources[k] = 'shared'
  for (const k of [...Object.keys(l), ...Object.keys(lp)] as (keyof typeof sources)[]) sources[k] = 'local'
  const prefs = { ...sp, ...lp }
  const errors = [shared.error && `.switchyard/settings.json: ${shared.error}`, local.error && `.switchyard/settings.local.json: ${local.error}`].filter(Boolean)
  return { ...p, ...s, ...l, prefs: Object.keys(prefs).length ? prefs : undefined, sources, settingsError: errors.length ? errors.join(' · ') : undefined, untrusted: held ? { hash, values: asked } : null }
}

/** The preferences in a project's file that a project may set (not the app-wide ones). */
function projectPrefs(data: Record<string, unknown>): Partial<Prefs> {
  const out = validPrefs(data) as Record<string, unknown>
  for (const k of APP_PREF_KEYS) delete out[k]
  return out as Partial<Prefs>
}

/** Writes project settings into one of its files (undefined removes a key). */
export function setProjectSettings(repoPath: string, scope: 'shared' | 'local', patch: Partial<Record<ProjectSettingKey | keyof Prefs, unknown>>): void {
  const path = projectSettingsPath(repoPath, scope)
  // What the file asked for, trusted before this change: still trusted after it (you made the change).
  const before = scope === 'shared' ? effectiveProject({ id: '', name: '', repo: '', repoPath, prefix: '' } as Project) : null
  writeKeys(path, patch, scope === 'shared' ? PROJECT_HEADER : LOCAL_HEADER)
  if (scope === 'local') excludeFromGit(repoPath)
  if (before && !before.untrusted) {
    const now = effectiveProject({ id: '', name: '', repo: '', repoPath, prefix: '' } as Project)
    if (now.untrusted) trustProjectSettings(repoPath, now.untrusted.hash)
  }
}

/** Creates the file if needed (with its explanation) and returns its path. */
export function ensureProjectSettingsFile(repoPath: string, scope: 'shared' | 'local'): string {
  const path = projectSettingsPath(repoPath, scope)
  if (!existsSync(path)) setProjectSettings(repoPath, scope, {})
  return path
}

/** settings.local.json never gets committed by accident - without touching the repo's .gitignore. */
function excludeFromGit(repoPath: string): void {
  try {
    const gitDir = join(repoPath, '.git')
    if (!statSync(gitDir).isDirectory()) return
    const exclude = join(gitDir, 'info', 'exclude')
    const line = '.switchyard/settings.local.json'
    const cur = existsSync(exclude) ? readFileSync(exclude, 'utf-8') : ''
    if (cur.split(/\r?\n/).includes(line)) return
    mkdirSync(dirname(exclude), { recursive: true })
    appendFileSync(exclude, `${cur && !cur.endsWith('\n') ? '\n' : ''}${line}\n`)
  } catch {
    // Not a plain git checkout - nothing to do.
  }
}

/* ---------- live changes ---------- */

let userWatcher: FSWatcher | null = null
const projectWatchers = new Map<string, FSWatcher>()

function changedByUs(path: string): boolean {
  const mine = written.get(resolve(path))
  if (mine === undefined) return false
  try {
    return readFileSync(path, 'utf-8') === mine
  } catch {
    return false
  }
}

/** Edits to settings.json made elsewhere apply at once; an error is reported and the last good values kept. */
export function watchUserSettings(): void {
  userWatcher?.close()
  const dir = resolve(dirname(userSettingsPath()))
  userWatcher = watch(dir, {
    depth: 0,
    ignoreInitial: true,
    // (chokidar passes "/" paths on Windows - compare them resolved.)
    ignored: (p) => resolve(p) !== dir && !WATCHED.includes(basename(p)),
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 }
  })
  userWatcher.on('all', (_ev, path) => {
    if (!WATCHED.includes(basename(path)) || changedByUs(path)) return
    if (basename(path) === 'keybindings.json') {
      loadKeys()
      if (keyState.error) broadcast('settings:error', { file: keybindingsPath(), message: keyState.error })
      else broadcast('keybindings:changed', keyState)
      return
    }
    loadUser()
    if (userError) broadcast('settings:error', userError)
    else {
      broadcast('prefs:changed', getUserPrefs())
      prefsChanged()
    }
  })
}

const WATCHED = ['settings.json', 'keybindings.json']

/** Watches each project's .switchyard folder; any change reloads the projects in the page. */
export function watchProjectSettings(projects: Project[]): void {
  const repos = new Set(projects.map((p) => p.repoPath).filter(Boolean))
  for (const [repo, w] of projectWatchers) {
    if (!repos.has(repo)) {
      w.close()
      projectWatchers.delete(repo)
    }
  }
  for (const repo of repos) {
    if (projectWatchers.has(repo)) continue
    const root = resolve(repo)
    const dir = join(root, '.switchyard')
    const w = watch(root, {
      depth: 1,
      ignoreInitial: true,
      // Only the .switchyard folder - never the rest of the repository.
      ignored: (p) => {
        const r = resolve(p)
        return r !== root && r !== dir && !r.startsWith(dir + sep)
      },
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 }
    })
    w.on('all', (_ev, path) => {
      if (!/settings(\.local)?\.json$/.test(path) || changedByUs(path)) return
      broadcast('projects:changed')
    })
    w.on('error', () => {})
    projectWatchers.set(repo, w)
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
