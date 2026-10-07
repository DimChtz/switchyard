import type { Project, Task } from './types'

/**
 * Tasks that don't get a branch and worktree of their own: they work in the
 * project's checkout, on whatever is checked out there (Task.inPlace). The
 * project's scratchpad is one of them - always there, off the board, for
 * terminals, agents and files outside any task.
 */

/** A task under way: it has an agent, and a branch - or the project's own checkout. */
export function isStarted(t: Task): boolean {
  return !!t.agentKind && (!!t.branch || !!t.inPlace)
}

/** Where the task works, for "project · …" lines: its branch, or the project's folder. */
export function whereLabel(t: Task): string {
  return t.branch ?? (t.scratch ? 'scratchpad' : t.inPlace ? 'project folder' : '')
}

export function scratchId(projectId: string): string {
  return `scratch-${projectId}`
}

/** The project's scratchpad task, new (nothing running in it yet). */
export function makeScratch(project: Project, now = Date.now()): Task {
  return {
    id: scratchId(project.id),
    key: `${project.prefix}-S`,
    projectId: project.id,
    title: 'Scratchpad',
    desc: '',
    col: 'progress',
    agentKind: null,
    st: null,
    worktreeId: null,
    worktreePath: project.repoPath,
    branch: null,
    ask: null,
    doneNote: null,
    firstMessage: null,
    createdAt: now,
    startedAt: now,
    lastActivityAt: now,
    inPlace: true,
    scratch: true
  }
}
