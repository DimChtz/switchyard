import { app } from 'electron'
import { resolve, sep } from 'path'
import type { ActivityLog, Checkpoint, Notice, Prefs, Project, ReviewComment, Task, TeamMessage } from '@shared/types'
import type { UsageEntry } from '@shared/usage'
import { effectiveProject, getUserPrefs, setUserPrefs } from './settings'
import * as db from './db'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

// Opened on first use rather than on import, so a data folder set at
// startup (SWITCHYARD_USER_DATA in dev) is the one it lives in.
let opened = false
function ready(): void {
  if (opened) return
  db.open(app.getPath('userData'))
  opened = true
}
function all<T>(coll: db.Coll): T[] {
  ready()
  return db.all<T>(coll)
}
function put<T>(coll: db.Coll, items: T[]): void {
  ready()
  db.put(coll, items)
}
function kv<T>(key: string): T | undefined {
  ready()
  return db.getKv<T>(key)
}
function setKv(key: string, value: unknown): void {
  ready()
  db.setKv(key, value)
}

/** Closes the database (on quit). */
export function closeStore(): void {
  if (opened) db.close()
  opened = false
}

// Earlier builds seeded demo projects that have no local repo (empty
// repoPath). Drop them, and everything hanging off their tasks, from
// stores created back then.
export function removeDemoData(): void {
  const demoIds = new Set(storedProjects().filter((p) => !p.repoPath).map((p) => p.id))
  if (demoIds.size > 0) {
    const demoTaskIds = new Set(getTasks().filter((t) => demoIds.has(t.projectId)).map((t) => t.id))
    put('projects', storedProjects().filter((p) => !demoIds.has(p.id)))
    put('tasks', getTasks().filter((t) => !demoTaskIds.has(t.id)))
    put('comments', getComments().filter((c) => !demoTaskIds.has(c.taskId)))
    put('viewedFiles', all<string>('viewedFiles').filter((k) => !demoTaskIds.has(k.split('|')[0])))
  }
}

/** What Switchyard keeps for each project, before the repository's settings files. */
function storedProjects(): Project[] {
  return all<Project>('projects')
}

/** Only Switchyard's own values are stored - never what came from a settings file. */
function stored(p: Project): Project {
  const { sources: _sources, settingsError: _error, prefs: _prefs, untrusted: _untrusted, ...rest } = p
  return rest
}

/** The projects as they apply: stored values, then .switchyard/settings.json, then settings.local.json. */
export function getProjects(): Project[] {
  return storedProjects().map(effectiveProject)
}

export function setProjects(projects: Project[]): void {
  put('projects', projects.map(stored))
}

export function addProject(project: Project): void {
  const projects = storedProjects()
  if (projects.some((p) => p.id === project.id || p.repoPath === project.repoPath)) {
    throw new Error('Project already tracked.')
  }
  put('projects', [...projects, stored(project)])
}

/** Changes what Switchyard keeps for the project; returns it as it now applies. */
export function updateProject(id: string, patch: Partial<Project>): Project | null {
  const projects = storedProjects()
  const idx = projects.findIndex((p) => p.id === id)
  if (idx === -1) return null
  const next = stored({ ...projects[idx], ...patch })
  const nextProjects = projects.slice()
  nextProjects[idx] = next
  put('projects', nextProjects)
  return effectiveProject(next)
}

export function getProject(id: string): Project | null {
  const p = storedProjects().find((x) => x.id === id)
  return p ? effectiveProject(p) : null
}

export function removeProject(id: string): void {
  const taskIds = getTasks().filter((t) => t.projectId === id).map((t) => t.id)
  put(
    'projects',
    storedProjects().filter((p) => p.id !== id)
  )
  put(
    'tasks',
    getTasks().filter((t) => t.projectId !== id)
  )
  clearTaskData(taskIds)
}

/** Drops the review comments and viewed-file marks of tasks that are gone or finished. */
export function clearTaskData(taskIds: string[]): void {
  const ids = new Set(taskIds)
  put('comments', getComments().filter((c) => !ids.has(c.taskId)))
  put('viewedFiles', all<string>('viewedFiles').filter((k) => !ids.has(k.split('|')[0])))
}

/** Window size and position, restored on the next start. */
export function getWindowBounds(): WindowBounds | null {
  return kv<WindowBounds>('window') ?? null
}

export function setWindowBounds(bounds: WindowBounds): void {
  setKv('window', bounds)
}

export function getTasks(): Task[] {
  return all<Task>('tasks')
}

// Told whenever the tasks change (plugins hear about it).
const taskListeners = new Set<() => void>()
export function onTasksChanged(cb: () => void): () => void {
  taskListeners.add(cb)
  return () => void taskListeners.delete(cb)
}
const tasksChanged = (): void => taskListeners.forEach((cb) => cb())

export function setTasks(tasks: Task[]): void {
  put('tasks', tasks)
  noteKeys(tasks)
  tasksChanged()
}

/**
 * The highest task number each project has used, so a key is never given
 * out twice - not after its task was deleted either (its notes, usage and
 * history still carry it).
 */
export function keyHigh(): Record<string, number> {
  return kv<Record<string, number>>('keyHigh') ?? {}
}

function noteKeys(tasks: Task[]): void {
  const high = keyHigh()
  let changed = false
  for (const t of tasks) {
    const n = Number(t.key.split('-').pop()) || 0
    if (n > (high[t.projectId] ?? 0)) {
      high[t.projectId] = n
      changed = true
    }
  }
  if (changed) setKv('keyHigh', high)
}

export function addTask(task: Task): void {
  setTasks([...getTasks(), task])
}

export function updateTask(id: string, patch: Partial<Task>): Task | null {
  const tasks = getTasks()
  const idx = tasks.findIndex((t) => t.id === id)
  if (idx === -1) return null
  const next = { ...tasks[idx], ...patch }
  const nextTasks = tasks.slice()
  nextTasks[idx] = next
  put('tasks', nextTasks)
  tasksChanged()
  return next
}

export function deleteTask(id: string): void {
  put(
    'tasks',
    getTasks().filter((t) => t.id !== id)
  )
  clearTaskData([id])
  tasksChanged()
}

export function getComments(): ReviewComment[] {
  return all<ReviewComment>('comments')
}

export function addComment(comment: ReviewComment): void {
  put('comments', [...getComments(), comment])
}

export function getCheckpoints(): Checkpoint[] {
  return all<Checkpoint>('checkpoints')
}

export function setCheckpoints(checkpoints: Checkpoint[]): void {
  put('checkpoints', checkpoints)
}

export function getTeam(): TeamMessage[] {
  return all<TeamMessage>('team')
}

export function setTeam(messages: TeamMessage[]): void {
  put('team', messages)
}

export function getActivity(): ActivityLog {
  return { seenAt: 0, announced: '', ...kv<Omit<ActivityLog, 'events'>>('activityMeta'), events: all('activity') }
}

export function setActivity(log: ActivityLog): void {
  put('activity', log.events)
  setKv('activityMeta', { seenAt: log.seenAt, announced: log.announced })
}

export function getNotices(): Notice[] {
  return all<Notice>('notices')
}

export function setNotices(notices: Notice[]): void {
  put('notices', notices.slice(0, 200))
}

export function updateComments(patches: { id: string; patch: Partial<ReviewComment> }[]): ReviewComment[] {
  const by = new Map(patches.map((p) => [p.id, p.patch]))
  const next = getComments().map((c) => (by.has(c.id) ? { ...c, ...by.get(c.id) } : c))
  put('comments', next)
  return next
}

export function deleteComment(id: string): void {
  put('comments', getComments().filter((c) => c.id !== id))
}

export function getViewedFiles(taskId: string): string[] {
  const prefix = `${taskId}|`
  return all<string>('viewedFiles')
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
}

export function setFileViewed(taskId: string, path: string, viewed: boolean): void {
  const key = `${taskId}|${path}`
  const marks = all<string>('viewedFiles')
  if (viewed) {
    if (!marks.includes(key)) put('viewedFiles', [...marks, key])
  } else {
    put(
      'viewedFiles',
      marks.filter((k) => k !== key)
    )
  }
}

/**
 * Preferences: settings.json over the defaults, so new settings get theirs.
 * For a path inside a project (its repository or a task's worktree), that
 * project's own preferences go on top.
 */
export function getPrefs(forPath?: string): Prefs {
  const user = getUserPrefs()
  const project = forPath ? projectAt(forPath) : null
  return project?.prefs ? { ...user, ...project.prefs } : user
}

/** The project a path belongs to: a task's worktree, else a repository it's in. */
function projectAt(path: string): Project | null {
  const norm = (p: string): string => resolve(p).toLowerCase()
  const inside = (dir: string): boolean => {
    const d = norm(dir)
    const target = norm(path)
    return target === d || target.startsWith(d + sep)
  }
  const task = getTasks().find((t) => (t.taskDir && inside(t.taskDir)) || (t.worktreePath && inside(t.worktreePath)))
  const own = storedProjects().find((p) => (task ? p.id === task.projectId : !!p.repoPath && inside(p.repoPath)))
  return own ? effectiveProject(own) : null
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  return setUserPrefs(patch)
}

/** Preferences as earlier versions kept them, in this store - moved to settings.json once. */
export function legacyPrefs(): Partial<Prefs> {
  return kv<Partial<Prefs>>('legacyPrefs') ?? {}
}

export function clearLegacyPrefs(): void {
  if (kv('legacyPrefs')) setKv('legacyPrefs', undefined)
}

/** Agents' token use, per session (see usage). */
export function getUsage(): UsageEntry[] {
  return all<UsageEntry>('usage')
}

export function setUsage(entries: UsageEntry[]): void {
  put('usage', entries)
}
