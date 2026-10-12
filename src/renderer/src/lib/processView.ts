import type { ProcessEntry, Task } from '@shared/types'

/** The Processes view's helpers: what a terminal is, and how its processes read. */

export type Kind = 'agent' | 'shell' | 'dev server' | 'tests' | 'setup' | 'terminal'

/** What a terminal is, and whose, from its session id. */
export function sessionKind(id: string, tasks: Task[]): { kind: Kind; task: Task | null; label: string } {
  const prefixed = /^(agent|setup|tests|preview)-(.+)$/.exec(id)
  if (prefixed) {
    const [, kind, rest] = prefixed
    const [taskId, repo] = rest.split('~')
    const task = tasks.find((t) => t.id === taskId) ?? null
    const k: Kind = kind === 'preview' ? 'dev server' : (kind as Kind)
    return { kind: k, task, label: k === 'dev server' && repo ? `dev server (${repo})` : k }
  }
  const shell = /^(.+)-shell-(\d+)$/.exec(id)
  if (shell) return { kind: 'shell', task: tasks.find((t) => t.id === shell[1]) ?? null, label: `shell ${shell[2]}` }
  return { kind: 'terminal', task: null, label: 'terminal' }
}

export const formatMem = (bytes: number): string =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${bytes > 0 ? Math.max(1, Math.round(bytes / 1024 ** 2)) : 0} MB`

/**
 * A command line made readable: the program by its name ("node", not its full
 * path), and long paths cut to their last two parts.
 */
export function shortCmd(cmd: string): string {
  const parts = cmd.match(/"[^"]*"|\S+/g) ?? []
  return parts
    .map((part, i) => {
      const quoted = part.startsWith('"') && part.endsWith('"') && part.length > 1
      const raw = quoted ? part.slice(1, -1) : part
      if (!/[\\/]/.test(raw)) return part
      const segs = raw.split(/[\\/]+/).filter(Boolean)
      if (i === 0) return (segs.pop() ?? raw).replace(/\.exe$/i, '')
      if (raw.length <= 40 || segs.length <= 2) return part
      return `…/${segs.slice(-2).join('/')}`
    })
    .join(' ')
}

/** The command worth showing for a terminal: what runs inside its shell, not the shell. */
export function headline(procs: ProcessEntry[]): string {
  const shells = /^(cmd|powershell|pwsh|bash|zsh|sh|fish|conhost|openconsole)(\.exe)?$/i
  const inner = procs.find((p) => p.depth > 0 && !shells.test(p.name)) ?? procs[0]
  return inner ? shortCmd(inner.cmd || inner.name) : ''
}
