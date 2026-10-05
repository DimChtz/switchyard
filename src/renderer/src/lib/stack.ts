import { baseFor, parentOf } from '@shared/stack'
import type { Project, Task } from '@shared/types'

// The board's tasks as the store last had them, for the git helpers that
// only get a task and a project (see shared/stack).
let known: Task[] = []

export function knowTasks(tasks: Task[]): void {
  known = tasks
}

/** The branch a task compares against and merges into in a repository: the default one, or the branch of the task it builds on. */
export function baseOf(task: Pick<Task, 'buildsOn'>, project: Pick<Project, 'id' | 'defaultBranch'>): string {
  return baseFor(task, project, known)
}

/** The task it builds on, while that one isn't merged: it has to go first. */
export function unmergedParent(task: Pick<Task, 'buildsOn'>): Task | undefined {
  const p = parentOf(task, known)
  return p && p.col !== 'done' ? p : undefined
}
