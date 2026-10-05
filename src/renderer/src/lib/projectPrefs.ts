import type { Prefs, Project, Task } from '@shared/types'

// One merged object per project override, so screens memoizing on prefs
// (the editors) don't rebuild on every render.
const merged = new WeakMap<Partial<Prefs>, { base: Prefs; prefs: Prefs }>()

/**
 * The preferences for a project: this machine's settings.json, with what the
 * project's .switchyard/settings(.local).json sets on top - as VS Code's
 * workspace settings go over the user's.
 */
export function prefsFor(state: { prefs: Prefs; projects: Project[] }, projectId: string | null | undefined): Prefs {
  const own = projectId ? state.projects.find((p) => p.id === projectId)?.prefs : undefined
  if (!own) return state.prefs
  const hit = merged.get(own)
  if (hit && hit.base === state.prefs) return hit.prefs
  const prefs = { ...state.prefs, ...own }
  merged.set(own, { base: state.prefs, prefs })
  return prefs
}

/** The project a folder belongs to: a task's worktree, else a repository it's in. */
export function projectIdForPath(state: { projects: Project[]; tasks: Task[] }, path: string | undefined): string | null {
  if (!path) return null
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const target = norm(path)
  const inside = (dir: string): boolean => target === norm(dir) || target.startsWith(`${norm(dir)}/`)
  const task = state.tasks.find((t) => (t.taskDir && inside(t.taskDir)) || (t.worktreePath && inside(t.worktreePath)))
  if (task) return task.projectId
  return state.projects.find((p) => p.repoPath && inside(p.repoPath))?.id ?? null
}
