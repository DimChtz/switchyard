import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ProcessEntry, ProcessGroup, ProcessSnapshot } from '@shared/types'
import * as ptyService from './pty'
import { log } from './log'

const execFileP = promisify(execFile)

/**
 * The processes the app's terminals started - agents, shells, dev servers,
 * test and setup runs - with what they listen on and how much memory they
 * use, and the ones left running after their terminal went away. For the
 * Processes view.
 */

interface Proc {
  pid: number
  ppid: number
  name: string
  cmd: string
  mem: number
  /** When it started (ms), when the system says - to tell a real child from a reused process id. */
  created: number | null
}

/** Windows: "pid\tppid\tbytes\tfiletime\tname\tcommand line" per process, from PowerShell. */
export function parseWinTable(out: string): Proc[] {
  const procs: Proc[] = []
  for (const row of out.split(/\r?\n/)) {
    const [pid, ppid, mem, ft, name, ...cmd] = row.split('\t')
    if (!pid || !/^\d+$/.test(pid)) continue
    const filetime = Number(ft)
    procs.push({
      pid: Number(pid),
      ppid: Number(ppid) || 0,
      name: name ?? '',
      cmd: cmd.join('\t').trim(),
      mem: Number(mem) || 0,
      // (Windows file time: 100ns steps since 1601.)
      created: filetime > 0 ? Math.round(filetime / 10_000 - 11_644_473_600_000) : null
    })
  }
  return procs
}

/** macOS and Linux: `ps -A -o pid=,ppid=,rss=,etime=,args=`. */
export function parsePs(out: string, now = Date.now()): Proc[] {
  const procs: Proc[] = []
  for (const row of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(row)
    if (!m) continue
    const cmd = m[5].trim()
    const exe = cmd.split(/\s+/)[0] ?? ''
    procs.push({ pid: Number(m[1]), ppid: Number(m[2]), mem: Number(m[3]) * 1024, created: now - elapsed(m[4]), name: exe.split('/').pop() ?? exe, cmd })
  }
  return procs
}

/** ps's elapsed time ([[dd-]hh:]mm:ss) in ms. */
export function elapsed(s: string): number {
  const [days, rest] = s.includes('-') ? s.split('-') : ['0', s]
  const parts = rest.split(':').map(Number)
  while (parts.length < 3) parts.unshift(0)
  const [h, m, sec] = parts
  return (((Number(days) * 24 + h) * 60 + m) * 60 + sec) * 1000
}

/** `netstat -ano` (Windows): the TCP ports each process listens on. */
export function parseNetstat(out: string): Map<number, number[]> {
  const ports = new Map<number, number[]>()
  for (const row of out.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(row)
    if (m) add(ports, Number(m[3]), Number(m[2]))
  }
  return ports
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpn` (macOS, most Linux): "p<pid>" then "n<addr>:<port>" lines. */
export function parseLsof(out: string): Map<number, number[]> {
  const ports = new Map<number, number[]>()
  let pid = 0
  for (const row of out.split('\n')) {
    if (row.startsWith('p')) pid = Number(row.slice(1)) || 0
    else if (row.startsWith('n') && pid) {
      const m = /:(\d+)$/.exec(row)
      if (m) add(ports, pid, Number(m[1]))
    }
  }
  return ports
}

/** `ss -ltnpH` (Linux without lsof). */
export function parseSs(out: string): Map<number, number[]> {
  const ports = new Map<number, number[]>()
  for (const row of out.split('\n')) {
    const addr = /^\s*LISTEN\s+\d+\s+\d+\s+(\S+)/.exec(row)
    const port = addr && /:(\d+)$/.exec(addr[1])
    if (!port) continue
    for (const p of row.matchAll(/pid=(\d+)/g)) add(ports, Number(p[1]), Number(port[1]))
  }
  return ports
}

function add(ports: Map<number, number[]>, pid: number, port: number): void {
  const list = ports.get(pid) ?? []
  if (!list.includes(port)) list.push(port)
  ports.set(pid, list)
}

const run = (cmd: string, args: string[]): Promise<string> =>
  execFileP(cmd, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 15_000 }).then((r) => r.stdout)

const WIN_TABLE =
  'Get-CimInstance Win32_Process | ForEach-Object { $c = if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }; "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.WorkingSetSize)`t$c`t$($_.Name)`t$($_.CommandLine)" }'

async function processTable(): Promise<Proc[]> {
  if (process.platform === 'win32') return parseWinTable(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_TABLE]))
  return parsePs(await run('ps', ['-A', '-o', 'pid=,ppid=,rss=,etime=,args=']))
}

async function listeningPorts(): Promise<Map<number, number[]>> {
  // (IPv4 and IPv6 both show as TCP.)
  if (process.platform === 'win32') return parseNetstat(await run('netstat', ['-ano']))
  const lsof = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']).catch((err: { stdout?: string; code?: unknown }) => (typeof err?.stdout === 'string' && err.stdout ? err.stdout : null))
  if (lsof !== null) return parseLsof(lsof)
  return parseSs(await run('ss', ['-ltnpH']).catch(() => ''))
}

/** Processes started under a terminal that are still alive after it went: pid → where they came from. */
const seen = new Map<number, { sessionId: string; name: string; created: number | null }>()
/** The process ids the last snapshot showed (the only ones Stop acts on). */
let shown = new Set<number>()

/** A session's process and everything below it, in tree order. */
function treeOf(root: Proc, children: Map<number, Proc[]>, ports: Map<number, number[]>): ProcessEntry[] {
  const out: ProcessEntry[] = []
  const walk = (p: Proc, depth: number): void => {
    out.push({ pid: p.pid, name: p.name, cmd: p.cmd, mem: p.mem, ports: (ports.get(p.pid) ?? []).sort((a, b) => a - b), depth })
    if (depth > 30) return
    for (const c of children.get(p.pid) ?? []) walk(c, depth + 1)
  }
  walk(root, 0)
  return out
}

export function buildSnapshot(
  sessions: { id: string; pid: number; cwd: string; startedAt: number }[],
  table: Proc[],
  ports: Map<number, number[]>,
  now = Date.now()
): ProcessSnapshot {
  const byPid = new Map(table.map((p) => [p.pid, p]))
  const children = new Map<number, Proc[]>()
  for (const p of table) {
    if (p.ppid === p.pid) continue
    const parent = byPid.get(p.ppid)
    // A process id Windows reused: the "parent" started after its child.
    if (parent && parent.created !== null && p.created !== null && parent.created > p.created + 1000) continue
    children.set(p.ppid, [...(children.get(p.ppid) ?? []), p])
  }

  const claimed = new Set<number>()
  const groups: ProcessGroup[] = []
  for (const s of sessions) {
    const root = byPid.get(s.pid)
    const procs = root ? treeOf(root, children, ports) : []
    for (const p of procs) claimed.add(p.pid)
    for (const p of procs.slice(1)) seen.set(p.pid, { sessionId: s.id, name: p.name, created: byPid.get(p.pid)?.created ?? null })
    groups.push({
      sessionId: s.id,
      cwd: s.cwd,
      pid: s.pid,
      startedAt: s.startedAt,
      procs,
      ports: [...new Set(procs.flatMap((p) => p.ports))].sort((a, b) => a - b),
      mem: procs.reduce((n, p) => n + p.mem, 0)
    })
  }

  // Left behind: seen under a terminal before, still running (the same process), under none now.
  const orphans: ProcessSnapshot['orphans'] = []
  for (const [pid, was] of seen) {
    const p = byPid.get(pid)
    if (!p || p.name !== was.name || (was.created !== null && p.created !== null && Math.abs(p.created - was.created) > 2000)) {
      seen.delete(pid)
      continue
    }
    if (claimed.has(pid)) continue
    // (Only the top of a left-behind tree: its children are listed under it.)
    if (seen.has(p.ppid) && byPid.has(p.ppid) && !claimed.has(p.ppid)) continue
    const procs = treeOf(p, children, ports)
    for (const c of procs) claimed.add(c.pid)
    orphans.push({ sessionId: was.sessionId, procs, ports: [...new Set(procs.flatMap((c) => c.ports))].sort((a, b) => a - b), mem: procs.reduce((n, c) => n + c.mem, 0) })
  }
  shown = claimed
  return { groups, orphans, at: now }
}

export async function snapshot(): Promise<ProcessSnapshot> {
  const sessions = ptyService.runningSessions()
  try {
    const [table, ports] = await Promise.all([processTable(), listeningPorts().catch(() => new Map<number, number[]>())])
    return buildSnapshot(sessions, table, ports)
  } catch (err) {
    log.warn('processes', 'Could not list processes', err)
    return { groups: sessions.map((s) => ({ sessionId: s.id, cwd: s.cwd, pid: s.pid, startedAt: s.startedAt, procs: [], ports: [], mem: 0 })), orphans: [], at: Date.now(), error: String((err as Error)?.message ?? err) }
  }
}

/** Ends a process and everything it started. Only for processes the last snapshot showed. */
export async function stopProcess(pid: number): Promise<void> {
  if (!shown.has(pid)) throw new Error('That process is no longer listed - refresh and try again.')
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(pid), '/T', '/F']).catch((err: { stderr?: string }) => {
      // (Gone already is fine.)
      if (!/not found|no running instance/i.test(err?.stderr ?? '')) throw new Error(err?.stderr?.trim() || 'taskkill failed')
    })
    return
  }
  const table = await processTable()
  const kids = new Map<number, number[]>()
  for (const p of table) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid])
  const all: number[] = []
  const walk = (p: number): void => {
    for (const c of kids.get(p) ?? []) walk(c)
    all.push(p)
  }
  walk(pid)
  const signal = (sig: NodeJS.Signals): void => {
    for (const p of all)
      try {
        process.kill(p, sig)
      } catch {
        // gone already
      }
  }
  signal('SIGTERM')
  await new Promise((r) => setTimeout(r, 1500))
  signal('SIGKILL')
}

/**
 * Ends a terminal's process tree. The terminal then ends as if its program had
 * exited (its tab says so); if it somehow didn't, it's closed outright.
 */
export async function stopSession(id: string): Promise<void> {
  const s = ptyService.runningSessions().find((x) => x.id === id)
  if (!s) return
  if (shown.has(s.pid)) await stopProcess(s.pid).catch(() => {})
  for (let i = 0; i < 30 && ptyService.exists(id); i++) await new Promise((r) => setTimeout(r, 100))
  if (ptyService.exists(id)) ptyService.kill(id)
}
