import { app, BrowserWindow, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { execFile } from 'child_process'
import { IPC } from '@shared/ipc'
import { getProjects, getTasks } from './services/store'
import { isInside } from './services/paths'
import { log } from './services/log'
import type { CliRequest } from '@shared/types'

/**
 * Switchyard from a terminal (or a link):
 *   switchyard new "Fix the login" [--agent claude] [--start] [--project api] [--desc "…"]
 *   switchyard://new?title=Fix%20the%20login&agent=claude&start=1&project=api
 * Without --project, the project is the one the command runs in (its folder,
 * or one of its tasks' worktrees). --agent opens the Start dialog with that
 * agent; --start starts it straight away. A second copy started this way
 * hands its arguments to the running one and quits (see index).
 */

const pending: CliRequest[] = []

/** What the arguments ask for (null: nothing - just the app). */
export function parseArgs(argv: string[], cwd: string): CliRequest | null {
  const link = argv.find((a) => a.toLowerCase().startsWith('switchyard://'))
  if (link) return fromLink(link)
  const at = argv.findIndex((a) => a === 'new')
  if (at < 0) return null
  const words: string[] = []
  const opts: Record<string, string | true> = {}
  for (let i = at + 1; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s)
      if (v !== undefined) opts[k] = v
      else if (['agent', 'project', 'desc', 'description'].includes(k) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) opts[k] = argv[++i]
      else opts[k] = true
    } else words.push(a)
  }
  const title = words.join(' ').trim()
  if (!title) return null
  return {
    title,
    desc: str(opts.desc ?? opts.description),
    agent: str(opts.agent) || null,
    start: opts.start === true || opts.start === 'true',
    projectId: projectFor(str(opts.project), cwd)
  }
}

function fromLink(link: string): CliRequest | null {
  try {
    const u = new URL(link)
    if ((u.hostname || u.pathname.replace(/^\/+/, '')) !== 'new') return null
    const q = u.searchParams
    const title = (q.get('title') ?? '').trim()
    if (!title) return null
    return { title, desc: q.get('desc') ?? '', agent: q.get('agent') || null, start: ['1', 'true', 'yes'].includes((q.get('start') ?? '').toLowerCase()), projectId: projectFor(q.get('project') ?? '', '') }
  } catch {
    return null
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The project named (name, id or folder), else the one `cwd` is in (its folder, or a task's worktree). */
function projectFor(named: string, cwd: string): string | null {
  const projects = getProjects()
  if (named) {
    const n = named.toLowerCase()
    const hit = projects.find((p) => p.name.toLowerCase() === n || p.id.toLowerCase() === n) ?? projects.find((p) => p.repoPath && isInside(named, p.repoPath))
    return hit?.id ?? null
  }
  if (!cwd) return null
  const task = getTasks().find((t) => (t.taskDir && isInside(cwd, t.taskDir)) || (t.worktreePath && isInside(cwd, t.worktreePath)))
  if (task) return task.projectId
  return projects.find((p) => p.repoPath && isInside(cwd, p.repoPath))?.id ?? null
}

/** Hands a request to the window (kept until it asks, when it isn't up yet). */
export function deliver(req: CliRequest | null): void {
  if (!req) return
  log.info('cli', `New task from the command line: ${req.title}${req.agent ? ` (${req.agent})` : ''}`)
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed())
  if (w && !w.webContents.isLoading() && ready) {
    if (w.isMinimized()) w.restore()
    w.focus()
    w.webContents.send(IPC.cliRequest, req)
  } else pending.push(req)
}

let ready = false

export function registerCli(): void {
  // The window asks once it listens: what came before it was up.
  ipcMain.handle(IPC.cliTake, () => {
    ready = true
    return pending.splice(0)
  })
  ipcMain.handle(IPC.cliInstall, () => installCommand())
  // switchyard:// links open the installed app - not a development copy (it would take them over).
  if (app.isPackaged && !process.argv.includes('--smoke-test')) {
    try {
      app.setAsDefaultProtocolClient('switchyard')
    } catch (err) {
      log.warn('cli', 'Could not register switchyard:// links', err)
    }
  }
}

/** How a terminal starts this app: the executable (and, in development, the app's folder). */
function launcher(): { exe: string; pre: string[] } {
  return process.defaultApp ? { exe: process.execPath, pre: [process.argv[1] ?? '.'] } : { exe: process.execPath, pre: [] }
}

/**
 * Puts a `switchyard` command on the PATH (as VS Code's "Install 'code'
 * command"): a small launcher in a folder of the user's own - on Windows
 * %LOCALAPPDATA%\Switchyard\bin (added to the user's PATH), elsewhere
 * ~/.local/bin. Returns what was done, to show.
 */
export async function installCommand(): Promise<{ path: string; note: string }> {
  const { exe, pre } = launcher()
  const q = (s: string): string => `"${s.replace(/"/g, '""')}"`
  if (process.platform === 'win32') {
    const dir = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Switchyard', 'bin')
    await fs.mkdir(dir, { recursive: true })
    const file = join(dir, 'switchyard.cmd')
    // `start` so the terminal isn't held while the app runs.
    await fs.writeFile(file, `@echo off\r\nstart "" ${[exe, ...pre].map(q).join(' ')} %*\r\n`)
    const added = await addToUserPath(dir)
    return { path: file, note: added ? 'Added its folder to your PATH - open a new terminal to use it.' : 'Its folder is on your PATH already.' }
  }
  const dir = join(homedir(), '.local', 'bin')
  await fs.mkdir(dir, { recursive: true })
  const file = join(dir, 'switchyard')
  const sh = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
  await fs.writeFile(file, `#!/bin/sh\n# Switchyard's command line - see Settings → General.\nnohup ${[exe, ...pre].map(sh).join(' ')} "$@" >/dev/null 2>&1 &\n`, { mode: 0o755 })
  const onPath = (process.env.PATH ?? '').split(delimiter).some((p) => p.replace(/\/+$/, '') === dir)
  return { path: file, note: onPath ? 'Its folder is on your PATH.' : `Add ${dir} to your PATH (e.g. in ~/.zshrc: export PATH="$HOME/.local/bin:$PATH").` }
}

/** Adds a folder to the user's own PATH (not the system's); false when it's there already. */
function addToUserPath(dir: string): Promise<boolean> {
  const script = `$d = '${dir.replace(/'/g, "''")}'; $p = [Environment]::GetEnvironmentVariable('Path', 'User'); if (($p -split ';') -contains $d) { 'present' } else { [Environment]::SetEnvironmentVariable('Path', ($(if ($p) { $p.TrimEnd(';') + ';' } else { '' }) + $d), 'User'); 'added' }`
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (err, out) => (err ? reject(err) : resolve(out.trim() === 'added')))
  })
}
