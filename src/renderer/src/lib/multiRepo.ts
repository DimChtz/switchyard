import type { Project, Task } from '@shared/types'

/**
 * Tasks in several repositories: one branch, a worktree in each, side by
 * side in the task's folder (taskDir/<repo folder>). The home repository is
 * the task's project; `repos` are the others.
 */

/** The task's projects: home first. */
export function reposOf(task: Pick<Task, 'projectId' | 'repos'>): string[] {
  return [task.projectId, ...(task.repos ?? []).filter((r) => r !== task.projectId)]
}

export function isMulti(task: Pick<Task, 'projectId' | 'repos'>): boolean {
  return reposOf(task).length > 1
}

/** Whether the task belongs on this project's board: its home, or one of its repos. */
export function inProject(task: Pick<Task, 'projectId' | 'repos'>, projectId: string | null | undefined): boolean {
  return !!projectId && reposOf(task).includes(projectId)
}

/** The folder a repository's worktree gets inside a task's folder: the repository's own folder name. */
export function repoDir(project: Pick<Project, 'repoPath' | 'name'>): string {
  return project.repoPath.split(/[\\/]/).filter(Boolean).pop() || project.name
}

/** Where the task works: its shared folder, else its worktree. */
export function taskRoot(task: Pick<Task, 'taskDir' | 'worktreePath'>): string | null {
  return task.taskDir || task.worktreePath
}

export interface Checkout {
  project: Project
  /** Its folder in the task's folder ('' for a single-repo task: the root). */
  dir: string
  /** The worktree (null before the task started). */
  path: string | null
}

/** Each repository of the task with its worktree - home first. */
export function checkoutsOf(task: Task, projects: Project[]): Checkout[] {
  const sep = task.taskDir?.includes('\\') ? '\\' : '/'
  return reposOf(task).flatMap((id): Checkout[] => {
    const project = projects.find((p) => p.id === id)
    if (!project) return []
    if (!task.taskDir) return id === task.projectId ? [{ project, dir: '', path: task.worktreePath }] : [{ project, dir: repoDir(project), path: null }]
    const dir = repoDir(project)
    return [{ project, dir, path: id === task.projectId ? task.worktreePath : `${task.taskDir}${sep}${dir}` }]
  })
}

/** A command to run in one repository's worktree (its tests, say). */
export interface RepoCommand {
  name: string
  cwd: string
  cmd: string
}

/** The task's repositories that have this command set (tests, dev server), with where to run it. */
export function repoCommands(task: Task, projects: Project[], key: 'testCmd' | 'devCmd'): (RepoCommand & { project: Project })[] {
  return checkoutsOf(task, projects).flatMap((c) => {
    const cmd = c.project[key]?.trim()
    return cmd && c.path ? [{ project: c.project, name: c.project.name, cwd: c.path, cmd }] : []
  })
}

/**
 * Several repositories' commands as one shell line: each in its folder,
 * under a header, stopping at the first that fails (its exit code is the
 * line's). `windows`: for cmd.exe, otherwise a POSIX shell.
 */
export function chainCommands(steps: RepoCommand[], windows: boolean): string {
  if (steps.length === 1) return steps[0].cmd
  const posix = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
  return steps
    .map((s) =>
      windows
        ? `cd /d "${s.cwd}" && echo. && echo -- ${s.name}: ${s.cmd.replace(/[&|<>^]/g, '^$&')} -- && ${s.cmd}`
        : `cd ${posix(s.cwd)} && printf '\\n-- %s --\\n' ${posix(`${s.name}: ${s.cmd}`)} && ${s.cmd}`
    )
    .join(' && ')
}

/**
 * A path in the task's folder ("api-gateway/src/x.ts") as its repository and
 * the path inside it. A single-repo task's paths are all the home's.
 */
export function splitRepoPath(task: Task, projects: Project[], path: string): { checkout: Checkout; rel: string } | null {
  const all = checkoutsOf(task, projects)
  if (!task.taskDir) return all[0] ? { checkout: all[0], rel: path } : null
  const seg = path.split('/')[0]
  const checkout = all.find((c) => c.dir === seg)
  return checkout ? { checkout, rel: path.slice(seg.length + 1) } : null
}
