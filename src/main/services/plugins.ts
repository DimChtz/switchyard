import { app, BrowserWindow, clipboard, net, shell, utilityProcess, type UtilityProcess } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, join, resolve, sep } from 'path'
import { setPluginAgents } from '@shared/constants'
import { appSatisfies, checkManifest, cleanBadges, pluginCommandId, type PluginCommandContext, type PluginInfo, type PackagePreview, type PluginManifest, type PluginSource, type PluginUiEvent } from '@shared/plugins'
import type { AgentDef } from '@shared/types'
import { getPrefs, getProjects, getTasks, onTasksChanged, setPrefs } from './store'
import { onUserPrefsChanged } from './settings'
import { notify } from './system'
import { log } from './log'
import { EXAMPLE_FILES } from './pluginExample'
import { PACKAGE_EXT, openPackage, packFolder, unpack, type PackageContents } from './pluginPackage'
import { PACKAGE_LIMITS } from './zip'
import { IPC } from '@shared/ipc'

/**
 * Plugins (see @shared/plugins): found in <userData>/plugins, turned on in
 * Settings → Plugins. Their agents join the list; their scripts run in the
 * plugin host (pluginHost.ts) - a separate process, restarted should it
 * crash - and everything they ask for is checked here.
 */

export function pluginsDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

interface Found {
  dir: string
  /** Its folder's name (what it's called before its plugin.json is read). */
  folder: string
  manifest: PluginManifest | null
  error: string | null
  source: PluginSource
}

/** Written into an installed plugin's folder: where it came from. */
const META = '.syplugin.json'

function readPlugin(dir: string, source: PluginSource, mustBeNamed?: string): Found {
  const folder = basename(dir)
  const file = join(dir, 'plugin.json')
  if (!existsSync(file)) return { dir, folder, manifest: null, error: 'No plugin.json in this folder', source }
  try {
    const checked = checkManifest(JSON.parse(readFileSync(file, 'utf-8')), mustBeNamed)
    if ('error' in checked) return { dir, folder, manifest: null, error: `plugin.json: ${checked.error}`, source }
    const m = checked.manifest
    if (m.main && !existsSync(join(dir, m.main))) return { dir, folder, manifest: m, error: `${m.main} isn't there`, source }
    if (!appSatisfies(app.getVersion(), m.engines?.switchyard)) return { dir, folder, manifest: m, error: `It needs Switchyard ${m.engines!.switchyard} - this is ${app.getVersion()}`, source }
    return { dir, folder, manifest: m, error: null, source }
  } catch (err) {
    return { dir, folder, manifest: null, error: `plugin.json: ${err instanceof Error ? err.message : String(err)}`, source }
  }
}

function sourceOf(dir: string): PluginSource {
  try {
    const meta = JSON.parse(readFileSync(join(dir, META), 'utf-8')) as { from?: unknown; at?: unknown }
    return { kind: 'installed', from: typeof meta.from === 'string' ? meta.from : '', at: typeof meta.at === 'number' ? meta.at : 0 }
  } catch {
    return { kind: 'local' }
  }
}

/** Every plugin: those in the plugins folder (installed, or made here), then the folders being developed. */
function scan(): Found[] {
  const root = pluginsDir()
  const inRoot = existsSync(root)
    ? readdirSync(root)
        .filter((f) => !f.startsWith('.') && statSync(join(root, f)).isDirectory())
        .sort()
        .map((folder) => readPlugin(join(root, folder), sourceOf(join(root, folder)), folder))
    : []
  const dev = (getPrefs().pluginFolders ?? []).map((dir) =>
    existsSync(dir) ? readPlugin(dir, { kind: 'development' }) : { dir, folder: basename(dir), manifest: null, error: "This folder isn't there any more", source: { kind: 'development' } as const }
  )
  // One plugin per id: a second with the same one waits.
  const seen = new Map<string, string>()
  return [...inRoot, ...dev].map((f) => {
    if (!f.manifest) return f
    const first = seen.get(f.manifest.id)
    if (first) return { ...f, error: `Another plugin has the id "${f.manifest.id}" (${first})` }
    seen.set(f.manifest.id, f.dir)
    return f
  })
}

let found: Found[] = []
/** What happened to each enabled plugin's script (absent: not loaded yet). */
const loadErrors = new Map<string, string | null>()
let host: UtilityProcess | null = null
let hostRunning: string[] = []
let stopping = false
let crashes = 0
let started = false

const enabledIds = (): string[] => getPrefs().plugins ?? []

export function list(): PluginInfo[] {
  const on = enabledIds()
  return found.map((f) => {
    const id = f.manifest?.id ?? f.folder
    const enabled = on.includes(id)
    const error = f.error ?? (enabled ? (loadErrors.get(id) ?? null) : null)
    const status: PluginInfo['status'] = error
      ? 'error'
      : !enabled
        ? 'off'
        : !f.manifest?.main
          ? 'ready'
          : loadErrors.has(id) && hostRunning.includes(id)
            ? 'running'
            : 'starting'
    return { dir: f.dir, source: f.source, manifest: f.manifest, enabled, status, error }
  })
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}
const changed = (): void => broadcast(IPC.pluginsChanged, list())
const ui = (e: PluginUiEvent): void => broadcast(IPC.pluginsUi, e)

/** The enabled plugins that are fine. */
function active(): Found[] {
  const on = enabledIds()
  return found.filter((f) => f.manifest && !f.error && on.includes(f.manifest.id))
}

/** (Re)reads the plugins folder, and starts what's enabled. */
export function start(): void {
  started = true
  found = scan()
  const agents: AgentDef[] = active().flatMap((f) => (f.manifest!.agents ?? []).map((a) => ({ ...a, short: a.short ?? a.kind, note: a.note ?? '', plugin: f.manifest!.id })))
  setPluginAgents(agents)
  startHost()
  changed()
}

export function stop(): void {
  stopHost()
}

function startHost(): void {
  const scripts = active().filter((f) => f.manifest!.main)
  const ids = scripts.map((f) => f.manifest!.id)
  if (host && ids.join() === hostRunning.join()) return
  stopping = true
  host?.kill()
  host = null
  hostRunning = []
  loadErrors.clear()
  if (!scripts.length) return
  stopping = false
  const proc = utilityProcess.fork(join(__dirname, 'pluginHost.js'), [], { serviceName: 'Switchyard plugins', stdio: 'pipe' })
  host = proc
  hostRunning = ids
  proc.stdout?.on('data', (d: Buffer) => log.info('plugins', d.toString().trimEnd().slice(0, 2000)))
  proc.stderr?.on('data', (d: Buffer) => log.warn('plugins', d.toString().trimEnd().slice(0, 2000)))
  proc.on('message', (m: Record<string, unknown>) => onHostMessage(proc, m))
  proc.on('exit', (code) => {
    if (host !== proc) return
    host = null
    hostRunning = []
    if (stopping) return
    // A plugin brought it down: start again, a few times.
    crashes += 1
    log.error('plugins', `The plugin host stopped (exit ${code})${crashes <= 3 ? ' - restarting it' : ' - not again (Settings → Plugins → Reload)'}`)
    for (const id of ids) loadErrors.set(id, `The plugin host stopped (exit ${code})`)
    changed()
    if (crashes <= 3) setTimeout(() => !host && startHost(), 1500 * crashes)
  })
  proc.once('spawn', () => {
    proc.postMessage({
      type: 'load',
      plugins: scripts.map((f) => ({ id: f.manifest!.id, main: resolve(f.dir, f.manifest!.main!), commands: (f.manifest!.commands ?? []).map((c) => c.id) }))
    })
  })
}

// The tasks, to plugins listening for them (a moment after a change, once).
let tasksTimer: NodeJS.Timeout | null = null
function sendTasks(): void {
  if (tasksTimer) clearTimeout(tasksTimer)
  tasksTimer = setTimeout(() => {
    tasksTimer = null
    host?.postMessage({ type: 'tasks', tasks: getTasks() })
  }, 250)
}

const pendingRuns = new Map<number, { resolve: () => void; reject: (e: Error) => void }>()
let runSeq = 0

function onHostMessage(proc: UtilityProcess, m: Record<string, unknown>): void {
  const plugin = typeof m.plugin === 'string' ? m.plugin : ''
  switch (m.type) {
    case 'loaded': {
      const id = String(m.id)
      loadErrors.set(id, typeof m.error === 'string' ? m.error : null)
      if (!m.error) log.info('plugins', `${id} started`)
      changed()
      // Once all have started, they hear about the tasks.
      if (hostRunning.every((x) => loadErrors.has(x))) {
        crashes = 0
        sendTasks()
      }
      return
    }
    case 'log': {
      const level = m.level === 'error' ? 'error' : m.level === 'warn' ? 'warn' : 'info'
      log[level](`plugin ${plugin}`, String(m.text ?? '').slice(0, 4000))
      return
    }
    case 'ran': {
      const r = pendingRuns.get(m.callId as number)
      if (!r) return
      pendingRuns.delete(m.callId as number)
      if (m.error) r.reject(new Error(String(m.error)))
      else r.resolve()
      return
    }
    case 'call': {
      const reply = (value: unknown, error?: string): void => proc.postMessage({ type: 'result', callId: m.callId, value, error })
      // Only a plugin that's running may ask.
      if (!hostRunning.includes(plugin)) return reply(null, 'not running')
      try {
        reply(answer(plugin, String(m.method), Array.isArray(m.args) ? m.args : []))
      } catch (err) {
        reply(null, err instanceof Error ? err.message : String(err))
      }
      return
    }
  }
}

const text = (v: unknown, what: string, max: number): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${what} must be text`)
  return v.slice(0, max)
}
const taskOf = (id: unknown): string => {
  const t = getTasks().find((x) => x.id === id)
  if (!t) throw new Error(`No task ${String(id)}`)
  return t.id
}

/** What a plugin asked for (sy.*), checked. */
function answer(plugin: string, method: string, args: unknown[]): unknown {
  switch (method) {
    case 'tasks.list':
      return getTasks()
    case 'tasks.get':
      return getTasks().find((t) => t.id === args[0]) ?? null
    case 'projects.list':
      return getProjects().map((p) => ({ id: p.id, name: p.name, repoPath: p.repoPath, prefix: p.prefix, defaultBranch: p.defaultBranch ?? null }))
    case 'tasks.create': {
      const t = (args[0] ?? {}) as Record<string, unknown>
      if (!getProjects().some((p) => p.id === t.projectId)) throw new Error(`No project ${String(t.projectId)}`)
      ui({ type: 'createTask', plugin, projectId: t.projectId as string, title: text(t.title, 'title', 200), desc: typeof t.desc === 'string' ? t.desc.slice(0, 20_000) : '', col: t.col === 'ready' ? 'ready' : 'backlog' })
      return null
    }
    case 'agents.message':
      ui({ type: 'message', plugin, taskId: taskOf(args[0]), text: text(args[1], 'text', 20_000) })
      return null
    case 'badges.set': {
      const badges = cleanBadges(args[1])
      if (!badges) throw new Error('badges must be a list of { text, tone?, tooltip? }')
      ui({ type: 'badges', plugin, taskId: text(args[0], 'taskId', 100), badges })
      return null
    }
    case 'badges.clear':
      if (args[0]) ui({ type: 'badges', plugin, taskId: text(args[0], 'taskId', 100), badges: [] })
      else ui({ type: 'clearBadges', plugin })
      return null
    case 'ui.toast':
      ui({ type: 'toast', plugin, text: text(args[0], 'text', 300) })
      return null
    case 'ui.notify':
      notify(text(args[0], 'title', 120), typeof args[1] === 'string' ? args[1].slice(0, 400) : '', typeof args[2] === 'string' ? taskOf(args[2]) : null)
      return null
    case 'ui.copy':
      clipboard.writeText(text(args[0], 'text', 100_000))
      return null
    case 'ui.openExternal': {
      const url = text(args[0], 'url', 2000)
      if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links open')
      void shell.openExternal(url)
      return null
    }
  }
  throw new Error(`sy has no ${method}`)
}

/** Runs a plugin's command (from the palette, a menu or its key). */
export function run(command: string, ctx: PluginCommandContext): Promise<void> {
  const plugin = command.split('.')[0]
  const f = active().find((x) => x.manifest!.id === plugin)
  if (!f || !(f.manifest!.commands ?? []).some((c) => pluginCommandId(plugin, c.id) === command)) return Promise.reject(new Error(`No command ${command}`))
  if (!host || !hostRunning.includes(plugin)) return Promise.reject(new Error(`${f.manifest!.name} isn't running`))
  const callId = ++runSeq
  const proc = host
  return new Promise<void>((resolve, reject) => {
    pendingRuns.set(callId, { resolve, reject })
    proc.postMessage({ type: 'run', callId, command, ctx: { taskId: ctx.taskId ?? null, projectId: ctx.projectId ?? null } })
    // A command that never finishes doesn't keep a promise forever.
    setTimeout(() => {
      if (pendingRuns.delete(callId)) resolve()
    }, 60_000)
  })
}

export function setEnabled(id: string, on: boolean): PluginInfo[] {
  const ids = new Set(enabledIds())
  if (on) ids.add(id)
  else ids.delete(id)
  // (The settings listener below restarts what changed.)
  setPrefs({ plugins: [...ids] })
  return list()
}

/** Reads the folder again and restarts the host (after editing a plugin). */
export function reload(): PluginInfo[] {
  crashes = 0
  stopHost()
  start()
  return list()
}

/** A new plugin from the example (named hello, hello-2…), in the plugins folder. */
export function scaffold(): string {
  const root = pluginsDir()
  mkdirSync(root, { recursive: true })
  let id = 'hello'
  for (let n = 2; existsSync(join(root, id)); n++) id = `hello-${n}`
  const dir = join(root, id)
  mkdirSync(dir)
  for (const [name, body] of Object.entries(EXAMPLE_FILES(id))) writeFileSync(join(dir, name), body)
  start()
  return dir
}

export function openFolder(): Promise<string> {
  mkdirSync(pluginsDir(), { recursive: true })
  return shell.openPath(pluginsDir())
}

/** Whether a path is a plugin's folder (or in the plugins folder) - what may be opened from Settings. */
export function isPluginDir(path: string): boolean {
  const p = resolve(path)
  return p.startsWith(resolve(pluginsDir()) + sep) || found.some((f) => resolve(f.dir) === p)
}

/* ---------- installing (packages: see pluginPackage.ts) ---------- */

const pending = new Map<string, { contents: PackageContents; from: string }>()
let tokenSeq = 0

function preview(contents: PackageContents, from: string): PackagePreview {
  const m = contents.manifest
  const here = found.find((f) => f.manifest?.id === m.id)
  const problem = !appSatisfies(app.getVersion(), m.engines?.switchyard)
    ? `It needs Switchyard ${m.engines!.switchyard} - this is ${app.getVersion()}.`
    : here?.source.kind === 'development'
      ? `"${m.id}" is loaded from a folder you're developing (${here.dir}) - remove that first.`
      : null
  const token = `p${++tokenSeq}`
  pending.set(token, { contents, from })
  // Not installed within the hour: forgotten.
  setTimeout(() => pending.delete(token), 60 * 60 * 1000)
  return {
    token,
    manifest: m,
    files: contents.files.length,
    bytes: contents.bytes,
    from,
    current: here?.manifest ? { version: here.manifest.version, source: here.source.kind, enabled: enabledIds().includes(m.id) } : null,
    problem
  }
}

export function previewFile(path: string): PackagePreview {
  if (!path.toLowerCase().endsWith(PACKAGE_EXT)) throw new Error(`Not a plugin package (${PACKAGE_EXT})`)
  if (statSync(path).size > PACKAGE_LIMITS.maxBytes) throw new Error('The package is too big')
  return preview(openPackage(readFileSync(path)), path)
}

/** A package from an https link (downloaded, at most the package size limit). */
export async function previewUrl(url: string): Promise<PackagePreview> {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    throw new Error("That isn't a link")
  }
  if (u.protocol !== 'https:') throw new Error('Only https links')
  const res = await net.fetch(u.toString(), { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`The download failed (${res.status} ${res.statusText})`)
  if (Number(res.headers.get('content-length') ?? 0) > PACKAGE_LIMITS.maxBytes) throw new Error('The package is too big')
  const reader = res.body?.getReader()
  if (!reader) throw new Error('The download was empty')
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > PACKAGE_LIMITS.maxBytes) {
      void reader.cancel()
      throw new Error('The package is too big')
    }
    parts.push(value)
  }
  return preview(openPackage(Buffer.concat(parts)), u.toString())
}

export function discard(token: string): void {
  pending.delete(token)
}

/** Installs a previewed package (an update replaces the plugin's folder); `turnOn` turns it on too. */
export function install(token: string, turnOn: boolean): PluginInfo[] {
  const p = pending.get(token)
  if (!p) throw new Error('That package is no longer here - open it again')
  pending.delete(token)
  const m = p.contents.manifest
  // Checked again: things may have changed since it was looked at.
  const again = preview(p.contents, p.from)
  pending.delete(again.token)
  if (again.problem) throw new Error(again.problem)

  const root = pluginsDir()
  mkdirSync(root, { recursive: true })
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const staging = join(root, `.staging-${m.id}-${stamp}`)
  const target = join(root, m.id)
  try {
    unpack(p.contents.files, staging)
    writeFileSync(join(staging, META), `${JSON.stringify({ from: p.from, at: Date.now(), version: m.version }, null, 2)}\n`)
  } catch (err) {
    rmSync(staging, { recursive: true, force: true })
    throw err
  }
  // Its script may be running from the old folder: the host stops while they're swapped.
  stopHost()
  try {
    if (existsSync(target)) {
      const old = join(root, `.old-${m.id}-${stamp}`)
      renameSync(target, old)
      rmSync(old, { recursive: true, force: true, maxRetries: 3 })
    }
    renameSync(staging, target)
  } catch (err) {
    rmSync(staging, { recursive: true, force: true })
    start()
    throw new Error(`Could not put it in place (is a file in ${target} open?): ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
  log.info('plugins', `Installed ${m.id} ${m.version} from ${p.from}`)
  if (turnOn && !enabledIds().includes(m.id)) setPrefs({ plugins: [...enabledIds(), m.id] })
  start()
  return list()
}

/** Removes a plugin: an installed or local one's folder is deleted; a development folder is only unlinked. */
export function uninstall(id: string): PluginInfo[] {
  const f = found.find((x) => x.manifest?.id === id || (!x.manifest && x.folder === id))
  if (!f) throw new Error(`No plugin ${id}`)
  if (enabledIds().includes(id)) setPrefs({ plugins: enabledIds().filter((x) => x !== id) })
  if (f.source.kind === 'development') setPrefs({ pluginFolders: (getPrefs().pluginFolders ?? []).filter((d) => resolve(d) !== resolve(f.dir)) })
  else {
    if (!resolve(f.dir).startsWith(resolve(pluginsDir()) + sep)) throw new Error('Not in the plugins folder')
    stopHost()
    rmSync(f.dir, { recursive: true, force: true, maxRetries: 3 })
  }
  log.info('plugins', `Removed ${id}`)
  start()
  return list()
}

/** A plugin being written, loaded from its own folder (changes show after Reload). */
export function linkFolder(dir: string): PluginInfo[] {
  const f = readPlugin(resolve(dir), { kind: 'development' })
  if (!f.manifest) throw new Error(f.error ?? 'No plugin.json there')
  const other = found.find((x) => x.manifest?.id === f.manifest!.id)
  if (other) throw new Error(`A plugin with the id "${f.manifest.id}" is here already (${other.dir})`)
  setPrefs({ pluginFolders: [...(getPrefs().pluginFolders ?? []), resolve(dir)] })
  start()
  return list()
}

/** The packager: a plugin's folder as a .syplugin at `out`. */
export function packageTo(dir: string, out: string): { path: string; files: number; bytes: number } {
  const pack = packFolder(dir)
  writeFileSync(out, pack.zip)
  log.info('plugins', `Packaged ${pack.manifest.id} ${pack.manifest.version} -> ${out}`)
  return { path: out, files: pack.files.length, bytes: pack.zip.length }
}

/** The package's file name (<id>-<version>.syplugin) for a folder, to suggest when saving. */
export function packageName(dir: string): string {
  const f = readPlugin(dir, { kind: 'development' })
  if (!f.manifest) throw new Error(f.error ?? 'No plugin.json there')
  return `${f.manifest.id}-${f.manifest.version}${PACKAGE_EXT}`
}

// Packages opened with the app (a double-click on a .syplugin) before the window could show them.
const opened: string[] = []
/** A .syplugin opened with Switchyard: Settings shows it, to confirm the install. */
export function openedWith(path: string): void {
  try {
    const p = previewFile(path)
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.webContents.isLoading()) win.webContents.send(IPC.pluginsInstallRequest, p)
    else opened.push(p.token)
  } catch (err) {
    log.warn('plugins', `Could not open ${path}`, err)
    broadcast(IPC.pluginsInstallRequest, { error: `Could not open ${basename(path)}: ${err instanceof Error ? err.message : String(err)}` })
  }
}
/** Packages opened before the window was ready. */
export function takeOpened(): PackagePreview[] {
  return opened.splice(0).flatMap((token) => {
    const p = pending.get(token)
    if (!p) return []
    pending.delete(token)
    return [preview(p.contents, p.from)]
  })
}

/** Leftovers of an install that stopped half-way. */
function cleanStaging(): void {
  const root = pluginsDir()
  if (!existsSync(root)) return
  for (const f of readdirSync(root)) if (/^\.(staging|old)-/.test(f)) rmSync(join(root, f), { recursive: true, force: true })
}

function stopHost(): void {
  stopping = true
  host?.kill()
  host = null
  hostRunning = []
}

let wired = false
/** At startup: load, and follow the settings and the tasks from then on. */
export function init(): void {
  if (wired) return
  wired = true
  cleanStaging()
  start()
  // What's on, and the folders being developed: a change to either (here or in settings.json) reloads.
  const key = (): string => `${enabledIds().slice().sort().join()}|${(getPrefs().pluginFolders ?? []).join('|')}`
  let last = key()
  onUserPrefsChanged(() => {
    const now = key()
    if (now === last || !started) return
    last = now
    start()
  })
  onTasksChanged(sendTasks)
  app.on('before-quit', stop)
}
