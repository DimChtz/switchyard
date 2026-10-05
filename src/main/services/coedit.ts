import { BrowserWindow } from 'electron'
import { relative, resolve, sep } from 'path'
import { getTasks } from './store'
import * as ptyService from './pty'
import { deliver } from './inbox'
import { IPC } from '@shared/ipc'
import type { Task } from '@shared/types'

/**
 * Editing alongside the agent: when you save a file in a task's worktree
 * while its agent runs, the agent is told what you changed; and (Claude
 * Code, through its PreToolUse hook) an edit of that file is refused until
 * it has read the file again - so it can't write over your change from a
 * stale copy.
 */

interface Guard {
  rel: string
  lines: string
  at: number
}

const GUARD_MS = 30 * 60_000
const guards = new Map<string, Map<string, Guard>>()
const norm = (p: string): string => {
  const r = resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/** The task whose worktree (or task folder) the file is in. */
function taskAt(path: string): { task: Task; root: string } | null {
  const target = norm(path)
  for (const task of getTasks()) {
    if (task.col === 'done') continue
    const root = task.taskDir || task.worktreePath
    if (root && (target === norm(root) || target.startsWith(norm(root) + sep))) return { task, root }
  }
  return null
}

/** Which lines changed, as the new file numbers them: "lines 40-52", "line 7", "the whole file". */
export function changedLines(before: string | null, after: string): string {
  if (before === null) return 'a new file'
  const a = before.replace(/\r\n/g, '\n').split('\n')
  const b = after.replace(/\r\n/g, '\n').split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  if (start === a.length && start === b.length) return 'no change'
  let endA = a.length - 1
  let endB = b.length - 1
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--
    endB--
  }
  if (endB < start) return `removed lines after line ${start}`
  return endB === start ? `line ${start + 1}` : `lines ${start + 1}-${endB + 1}`
}

function tell(taskId: string, text: string): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.agentToolsRequest, 0, { kind: 'note', taskId, text })
}

/** You saved a file (the Files tab). If its task's agent runs, it hears about it - and must re-read before editing it. */
export function userSaved(path: string, before: string | null, after: string): void {
  const hit = taskAt(path)
  if (!hit || !ptyService.exists(`agent-${hit.task.id}`)) return
  const lines = changedLines(before, after)
  if (lines === 'no change') return
  const rel = relative(hit.root, path).split(sep).join('/')
  const mine = guards.get(hit.task.id) ?? new Map<string, Guard>()
  mine.set(norm(path), { rel, lines, at: Date.now() })
  guards.set(hit.task.id, mine)
  deliver(hit.task.id, `Heads-up from Switchyard: the user just edited ${rel} (${lines}) in the editor. Keep their changes - read the file again before you change it.`)
  tell(hit.task.id, `Told the agent about your edit to ${rel} (${lines}).`)
}

const WRITES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

/**
 * Claude Code is about to use a tool (its PreToolUse hook). An edit of a
 * file you changed since it last read it is refused, with the reason;
 * reading the file lifts that.
 */
export function beforeTool(taskId: string, tool: string | undefined, input: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const mine = guards.get(taskId)
  if (!mine?.size || !tool) return null
  const file = typeof input?.file_path === 'string' ? input.file_path : typeof input?.notebook_path === 'string' ? input.notebook_path : null
  if (!file) return null
  const task = getTasks().find((t) => t.id === taskId)
  const root = task?.taskDir || task?.worktreePath
  const key = norm(root ? resolve(root, file) : file)
  const g = mine.get(key)
  if (!g) return null
  if (Date.now() - g.at > GUARD_MS) {
    mine.delete(key)
    return null
  }
  if (tool === 'Read') {
    mine.delete(key)
    return null
  }
  if (!WRITES.has(tool)) return null
  tell(taskId, `Stopped the agent from overwriting your edit to ${g.rel} - it has to read the file again first.`)
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `The user edited ${g.rel} (${g.lines}) in Switchyard after you last read it. Read the file again, keep their changes, then make your edit.`
    }
  }
}

/** For tests. */
export function reset(): void {
  guards.clear()
}
