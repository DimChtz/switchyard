import type { Project, Task } from '@shared/types'
import type { Action } from '../store/types'
import { nextTaskKey } from './derive'

/**
 * Terminal output - an error, a stack trace, a failing test - as a new
 * task: a title from its telling line, the output in the description with
 * where it came from. The task opens for a look before anything starts.
 */

const TELLING = /\b(error|exception|failed|failure|fatal|panic|cannot|can't|unable|undefined|not found|denied|refused|timed? ?out|traceback|assert)/i

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g

/** The output, cleaned: no colour codes, no trailing blanks, at most 200 lines (the last ones). */
export function cleanOutput(text: string): string {
  const lines = text
    .replace(ANSI, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return (lines.length > 200 ? ['…', ...lines.slice(-200)] : lines).join('\n')
}

// A shell's prompt line - what was typed, not what went wrong: C:\x>, PS C:\x>, user@host:~$, $ cmd.
const PROMPT = /^(PS )?[A-Za-z]:\\[^>]*>|^[\w.@-]+[:~][^$#]*[$#]\s|^[$#%❯➜>]\s/

/** A title: "Fix: " and the line that says what went wrong - the last such, not a command or a stack frame (else the first line). */
export function titleFromOutput(text: string): string {
  const all = cleanOutput(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== '…')
  const output = all.filter((l) => !PROMPT.test(l) && !/^at\s/.test(l))
  const line = [...output].reverse().find((l) => TELLING.test(l)) ?? output[0] ?? all[0]?.replace(PROMPT, '').trim() ?? 'Terminal output'
  const short = line.length > 90 ? `${line.slice(0, 87).trimEnd()}…` : line
  return TELLING.test(line) ? `Fix: ${short}` : short
}

export function descFromOutput(text: string, cwd: string | undefined, from: Task | null): string {
  const where = [cwd ? `\`${cwd}\`` : null, from ? `while working on ${from.key} (${from.title})` : null].filter(Boolean).join(', ')
  const fence = text.includes('```') ? '~~~' : '```'
  return `Seen in a terminal${where ? ` - ${where}` : ''}:\n\n${fence}\n${cleanOutput(text)}\n${fence}\n`
}

/** The task whose worktree the terminal is in, if any. */
export function taskForPath(tasks: Task[], path: string | undefined): Task | null {
  if (!path) return null
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const target = norm(path)
  const inside = (dir: string | null | undefined): boolean => !!dir && (target === norm(dir) || target.startsWith(`${norm(dir)}/`))
  return tasks.find((t) => t.col !== 'done' && (inside(t.taskDir) || inside(t.worktreePath))) ?? null
}

/** Adds the task (Ready) and opens it to look over and edit. */
export function taskFromOutput(text: string, cwd: string | undefined, project: Project, tasks: Task[], dispatch: (a: Action) => void): string {
  const from = taskForPath(tasks, cwd)
  const key = nextTaskKey(tasks, project)
  const now = Date.now()
  dispatch({
    type: 'ADD_TASK',
    task: { id: key, key, projectId: project.id, title: titleFromOutput(text), desc: descFromOutput(text, cwd, from), col: 'ready', agentKind: null, st: null, worktreeId: null, worktreePath: null, branch: null, ask: null, doneNote: null, firstMessage: null, createdAt: now, startedAt: null, lastActivityAt: now }
  })
  dispatch({ type: 'OPEN_TASK_SHEET', taskId: key })
  return key
}
