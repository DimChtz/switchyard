import * as pty from '@lydell/node-pty'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import type { WebContents } from 'electron'
import type { PtyInfo, PtySpawnOptions } from '@shared/types'
import { getPrefs } from './store'
import { USER_GIT_ENV } from './gitEnv'
import { findOnPath, windowsLaunch } from './winLaunch'
import { profileFor } from './system'
import { log } from './log'

interface Session {
  proc: pty.IPty
  sender: WebContents
  buffer: string
  exitCode: number | null
  killed: boolean
  lastInputAt: number
  /** When something was last typed or sent (not a resize). */
  lastWriteAt: number
  cwd: string
  /** The last message sent to it (sendText). */
  lastSent: string | null
  /** The program turned on bracketed paste (ESC[?2004h): pasted text arrives as one paste, newlines and all. */
  bracketed: boolean
  /** Output not sent to the window yet (sent in batches). */
  outbox: string
  outTimer: NodeJS.Timeout | null
}

const sessions = new Map<string, Session>()
const MAX_BUFFER = 500_000

/**
 * 'data' (id, data, sender, session) and 'exit' (id, exitCode, sender) for
 * every session - lets other main-process services (agent status detection)
 * observe output without owning the IPC plumbing.
 */
export const events = new EventEmitter()

// Markers a parent Claude Code session sets on its child processes. If the
// app itself was launched from inside one (e.g. an IDE terminal driven by
// Claude), agents started here would otherwise think they're nested
// sub-sessions - which, among other things, turns off transcript saving and
// breaks `claude --continue`.
const INHERITED_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_PID'
]

function childEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>
  for (const key of INHERITED_SESSION_VARS) delete env[key]
  // The app's own git settings (no terminal prompts) aren't for terminals: git may ask there.
  for (const [k, v] of Object.entries(USER_GIT_ENV)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  return env
}

/** The shell commands run through (setup, tests, dev servers): cmd.exe on Windows, the login shell elsewhere. */
function commandShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe'
  return process.env.SHELL || '/bin/bash'
}

/** A terminal tab's shell when none is picked: PowerShell 7 or Windows PowerShell (as VS Code), the login shell elsewhere. */
function terminalShell(): string {
  if (process.platform !== 'win32') return process.env.SHELL || '/bin/bash'
  return findOnPath('pwsh') ?? findOnPath('powershell') ?? (process.env.COMSPEC || 'cmd.exe')
}

const BRACKETED_ON = '\x1b[?2004h'
const BRACKETED_OFF = '\x1b[?2004l'

export function spawn(sender: WebContents, opts: PtySpawnOptions): void {
  kill(opts.id)

  // Terminal tabs use the shell picked in Settings (or the tab's own
  // profile); commands the app runs itself (setup, tests, dev server)
  // always go through the system one.
  const profile = opts.cmd ? null : profileFor(getPrefs(opts.cwd).shell)
  let shell = opts.cmd || profile?.path || getPrefs(opts.cwd).shell || terminalShell()
  let args: string[] | string = opts.args ?? profile?.args ?? []
  if (opts.execCommand) {
    shell = commandShell()
    // On Windows the command line goes to cmd.exe as written (quotes
    // included) - an argument array would get its quotes escaped as \",
    // which cmd doesn't understand. Same as Node's `shell: true`.
    args = process.platform === 'win32' ? `/d /s /c "${opts.execCommand}"` : ['-lc', opts.execCommand]
  } else if (opts.cmd && process.platform === 'win32') {
    // An agent CLI: its .cmd shim is read for the program it really runs,
    // started directly - so a multi-line message and the flags after it
    // arrive intact (see winLaunch). Only an unknown batch file still goes
    // through cmd.exe.
    const launch = windowsLaunch(opts.cmd, args)
    shell = launch.file
    args = launch.args
    if (launch.viaCmd) log.info('pty', `${opts.cmd} runs through cmd.exe - multi-line arguments are joined into one line`)
  }

  let proc: pty.IPty
  try {
    proc = pty.spawn(shell, args, {
      // 256 colors and truecolor, as the agents' TUIs and modern CLIs expect.
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd || homedir(),
      env: { ...childEnv(), COLORTERM: 'truecolor', TERM_PROGRAM: 'Switchyard', ...opts.env }
    })
  } catch (err) {
    log.error('pty', `Could not start ${shell} in ${opts.cwd}`, err)
    throw err
  }

  const session: Session = {
    proc,
    sender,
    buffer: '',
    exitCode: null,
    killed: false,
    lastInputAt: 0,
    lastWriteAt: 0,
    cwd: opts.cwd || homedir(),
    lastSent: null,
    bracketed: false,
    outbox: '',
    outTimer: null
  }
  sessions.set(opts.id, session)
  events.emit('spawn', opts.id, session.cwd)

  proc.onData((data) => {
    // A real terminal UI may not be mounted yet when this session was spawned
    // eagerly (e.g. right when a task starts, before the user opens the
    // Terminal tab) - buffer everything so a later `getBuffer` can replay
    // output that would otherwise be sent over IPC with nobody listening.
    session.buffer += data
    if (session.buffer.length > MAX_BUFFER) session.buffer = session.buffer.slice(-MAX_BUFFER)
    const on = data.lastIndexOf(BRACKETED_ON)
    const off = data.lastIndexOf(BRACKETED_OFF)
    if (on >= 0 || off >= 0) session.bracketed = on > off
    // Output goes to the window in batches (every few ms), not a message per
    // chunk - a flood of output (a build log) stays smooth.
    session.outbox += data
    session.outTimer ??= setTimeout(() => sendOut(opts.id, session), 6)
    events.emit('data', opts.id, data, sender, session)
  })

  proc.onExit(({ exitCode }) => {
    if (session.killed) return
    // Keep the exited session (and its output) around so reopening the
    // terminal shows what happened instead of silently starting a new
    // process. It's replaced on the next spawn under the same id.
    session.exitCode = exitCode
    sendOut(opts.id, session)
    if (!sender.isDestroyed()) sender.send('pty:exit', { id: opts.id, exitCode })
    events.emit('exit', opts.id, exitCode, sender)
  })
}

function sendOut(id: string, s: Session): void {
  if (s.outTimer) clearTimeout(s.outTimer)
  s.outTimer = null
  const data = s.outbox
  s.outbox = ''
  if (data && !s.sender.isDestroyed()) s.sender.send('pty:data', { id, data })
}

/** The window a session's output goes to. */
export function senderOf(id: string): WebContents | null {
  return sessions.get(id)?.sender ?? null
}

export function getBuffer(id: string): string {
  return sessions.get(id)?.buffer ?? ''
}

/** True only while the process is still running. */
export function exists(id: string): boolean {
  const s = sessions.get(id)
  return !!s && s.exitCode === null
}

export function info(id: string): PtyInfo | null {
  const s = sessions.get(id)
  return s ? { running: s.exitCode === null, exitCode: s.exitCode } : null
}

/** Where the session runs, and the last message sent to it. */
export function cwdOf(id: string): string | null {
  return sessions.get(id)?.cwd ?? null
}

/** The last message sendText gave it - and forgets it. */
export function takeLastSent(id: string): string | null {
  const s = sessions.get(id)
  const text = s?.lastSent ?? null
  if (s) s.lastSent = null
  return text
}

/** When something was last typed or sent to the session (a resize doesn't count). */
export function lastWriteAt(id: string): number {
  return sessions.get(id)?.lastWriteAt ?? 0
}

export function lastInputAt(id: string): number {
  return sessions.get(id)?.lastInputAt ?? 0
}

export function write(id: string, data: string): void {
  const s = sessions.get(id)
  if (!s || s.exitCode !== null) return
  s.lastInputAt = Date.now()
  s.lastWriteAt = s.lastInputAt
  s.proc.write(data)
}

/**
 * Types a message into an interactive agent TUI and submits it. Several
 * lines go as one bracketed paste when the program asked for those (Claude
 * Code, Codex, Gemini do), so they arrive as lines of one message; otherwise
 * they're joined into one line, since Enter would send each separately. The
 * Enter is sent apart: TUIs treat a burst ending in \r as part of a paste.
 */
export function sendText(id: string, text: string): void {
  const s = sessions.get(id)
  if (s) s.lastSent = text
  write(id, pasteText(text, !!s?.bracketed))
  setTimeout(() => write(id, '\r'), text.includes('\n') ? 150 : 80)
}

/** How `text` is typed: a bracketed paste (multi-line, when the program takes those), else one line. */
export function pasteText(text: string, bracketed: boolean): string {
  const t = text.replace(/\r\n/g, '\n').trim()
  if (!t.includes('\n')) return t
  // (Its own end-of-paste marker can't be in it.)
  if (bracketed) return `\x1b[200~${t.split('\x1b[201~').join('')}\x1b[201~`
  return t.replace(/\s*\n\s*/g, ' ')
}

export function resize(id: string, cols: number, rows: number): void {
  const s = sessions.get(id)
  if (!s || s.exitCode !== null) return
  s.lastInputAt = Date.now()
  try {
    s.proc.resize(cols, rows)
  } catch {
    // ignore resize races during shutdown
  }
}

export function kill(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session.killed = true
  sessions.delete(id)
  if (session.exitCode !== null) return
  try {
    session.proc.kill()
  } catch {
    // already dead
  }
}

/** Sessions whose id starts with `prefix` (running or exited), oldest first. */
export function list(prefix: string): string[] {
  return [...sessions.keys()].filter((id) => id.startsWith(prefix))
}

/** Stops every session whose id starts with `prefix` - e.g. all of a task's terminals. */
export function killPrefix(prefix: string): void {
  for (const id of list(prefix)) kill(id)
}

/** Agent processes that are still running (for the quit confirmation). */
export function runningAgents(): number {
  return [...sessions.entries()].filter(([id, s]) => id.startsWith('agent-') && s.exitCode === null).length
}

export function killAll(): void {
  for (const id of [...sessions.keys()]) kill(id)
}
