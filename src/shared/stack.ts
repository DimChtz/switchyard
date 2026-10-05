import type { Project, Task } from './types'

/**
 * Tasks that build on each other: a task's branch starts from the branch of
 * the task it builds on (its parent), and compares against it - diffs, sync,
 * its pull request - until the parent is merged; then against the project's
 * default branch, like any other.
 */

/** The task this one builds on. */
export function parentOf(task: Pick<Task, 'buildsOn'>, tasks: Task[]): Task | undefined {
  return task.buildsOn ? tasks.find((t) => t.id === task.buildsOn) : undefined
}

/** The tasks building on this one. */
export function childrenOf(task: Task, tasks: Task[]): Task[] {
  return tasks.filter((t) => t.buildsOn === task.id)
}

/** Whether a task works in a repository (its home one, or one attached). */
function worksIn(task: Task, projectId: string): boolean {
  return task.projectId === projectId || !!task.repos?.includes(projectId)
}

/** The parent whose branch a task's work sits on in a repository: not merged yet, with a branch there. */
export function liveParent(task: Pick<Task, 'buildsOn'>, projectId: string, tasks: Task[]): Task | undefined {
  const p = parentOf(task, tasks)
  return p && p.branch && p.col !== 'done' && worksIn(p, projectId) ? p : undefined
}

/** The branch a task branches from, compares against and merges into, in a repository. */
export function baseFor(task: Pick<Task, 'buildsOn'>, project: Pick<Project, 'id' | 'defaultBranch'>, tasks: Task[]): string {
  return liveParent(task, project.id, tasks)?.branch ?? project.defaultBranch ?? 'main'
}

/** The parent it waits for before it can start: one that has no branch yet. */
export function waitsFor(task: Task, tasks: Task[]): Task | undefined {
  const p = parentOf(task, tasks)
  return p && !p.branch && p.col !== 'done' ? p : undefined
}

/** Whether its parent's agent is done with it (in Review, or merged) - a queued task starts then. */
export function parentFinished(task: Task, tasks: Task[]): boolean {
  const p = parentOf(task, tasks)
  return !p || p.col === 'review' || p.col === 'done'
}

/** Whether `parentId` building under `taskId` would make a loop (it, or a task building on it). */
export function wouldLoop(taskId: string, parentId: string, tasks: Task[]): boolean {
  for (let id: string | null | undefined = parentId, n = 0; id && n < 100; n++) {
    if (id === taskId) return true
    id = tasks.find((t) => t.id === id)?.buildsOn
  }
  return false
}

/** Whether one of the two builds on the other (directly or further down). */
export function stacked(a: Task, b: Task, tasks: Task[]): boolean {
  const above = (x: Task, y: Task): boolean => {
    for (let id = x.buildsOn, n = 0; id && n < 100; n++) {
      if (id === y.id) return true
      id = tasks.find((t) => t.id === id)?.buildsOn
    }
    return false
  }
  return above(a, b) || above(b, a)
}
