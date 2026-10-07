import { useSyncExternalStore } from 'react'
import type { ShellOption } from '@shared/types'
import { closeWhere, defaultLayout, groupsOf, openBeside, openTab, readBars, readLayout, renameTabs, showView, type Layout, type SideBars, type TabId, type ViewId, type Zone } from './wsLayout'
import { shellPrefix } from './agentControl'

/**
 * The workspace's arrangement: each task's editor groups and the side bars
 * (the same for every task). Kept here rather than in a component, so a
 * menu anywhere (Worktrees' "Open terminal here", the palette's Go to
 * file) can open a tab in a task's workspace, open or not - and so it's
 * there again next time (also after a restart: it's saved).
 */

type Listener = () => void
const listeners = new Set<Listener>()
const emit = (): void => listeners.forEach((l) => l())
const subscribe = (l: Listener): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const LAYOUTS_KEY = 'sy.ws.layouts'
const BARS_KEY = 'sy.ws.bars'

function load<T>(key: string, read: (raw: unknown) => T): T {
  try {
    const raw = localStorage.getItem(key)
    return read(raw ? JSON.parse(raw) : null)
  } catch {
    return read(null)
  }
}

let layouts: Record<string, Layout> = load(LAYOUTS_KEY, (raw) => {
  const out: Record<string, Layout> = {}
  if (raw && typeof raw === 'object') for (const [id, l] of Object.entries(raw)) {
    const L = readLayout(l)
    // (The all-notes tab is gone: notes are a side bar, and each note its own tab.)
    if (L) out[id] = closeWhere(L, (t) => t === 'notes')
  }
  return out
})
let bars: SideBars = load(BARS_KEY, readBars)

let saveTimer: ReturnType<typeof setTimeout> | null = null
function save(): void {
  saveTimer ??= setTimeout(() => {
    saveTimer = null
    try {
      localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts))
      localStorage.setItem(BARS_KEY, JSON.stringify(bars))
    } catch {
      // not saved: it's only the arrangement
    }
  }, 400)
}

// --- layouts -----------------------------------------------------------------

/** The Notes screen's arrangement (its note tabs), kept like a task's. */
export const NOTES_LAYOUT = '~notes'

export function getLayout(taskId: string): Layout {
  return layouts[taskId] ?? (layouts[taskId] = taskId === NOTES_LAYOUT ? defaultLayout([]) : defaultLayout(['agent', ...shellsOf(taskId).map((s) => `shell:${s.id}`)]))
}

/** A change to every arrangement - the tasks' and the Notes screen's. */
function everyLayout(fn: (L: Layout) => Layout): void {
  let changed = false
  const next: Record<string, Layout> = {}
  for (const [k, L] of Object.entries(layouts)) {
    next[k] = fn(L)
    if (next[k] !== L) changed = true
  }
  if (!changed) return
  layouts = next
  save()
  emit()
}

/** A note saved under a new id (its title became its file name): its tabs follow. */
export function renameNoteTabs(from: string, to: string): void {
  everyLayout((L) => renameTabs(L, (id) => (id === `note:${from}` ? `note:${to}` : id)))
}

/** A note that's gone (deleted): its tabs close everywhere. */
export function closeNoteTabs(id: string): void {
  everyLayout((L) => closeWhere(L, (t) => t === `note:${id}`))
}

export function setLayout(taskId: string, fn: (L: Layout) => Layout): void {
  const cur = getLayout(taskId)
  const next = fn(cur)
  if (next === cur) return
  layouts = { ...layouts, [taskId]: next }
  save()
  emit()
}

export function useLayout(taskId: string): Layout {
  return useSyncExternalStore(subscribe, () => getLayout(taskId))
}

/** Back to one group with the agent and the shells, and the side bars as they first were. */
export function resetLayout(taskId: string): void {
  layouts = { ...layouts, [taskId]: defaultLayout(['agent', ...shellsOf(taskId).map((s) => `shell:${s.id}`)]) }
  bars = readBars(null)
  save()
  emit()
}

/** A task that's gone: its arrangement goes too. */
export function forgetLayout(taskId: string): void {
  if (!layouts[taskId]) return
  const { [taskId]: _gone, ...rest } = layouts
  layouts = rest
  save()
}

/** Shows a tab in a task's workspace (opening it in the focused group when it isn't open). */
export function wsOpen(taskId: string, id: TabId, inGroup?: string): void {
  setLayout(taskId, (L) => openTab(L, id, inGroup))
}

/**
 * What the old tabs were, in the new workspace: the agent's terminal, the
 * Explorer, the Changes, or a tab of its own.
 */
export function showInWorkspace(taskId: string, what: 'terminal' | 'files' | 'changes' | 'timeline' | 'preview' | 'notes'): void {
  if (what === 'terminal') wsOpen(taskId, 'agent')
  else if (what === 'files') wsShowView('explorer')
  else if (what === 'changes') wsShowView('changes')
  else if (what === 'notes') wsShowView('notes')
  else wsOpen(taskId, what)
}

// --- side bars ---------------------------------------------------------------

export function getBars(): SideBars {
  return bars
}

export function setBars(fn: (b: SideBars) => SideBars): void {
  const next = fn(bars)
  if (next === bars) return
  bars = next
  save()
  emit()
}

export function useBars(): SideBars {
  return useSyncExternalStore(subscribe, getBars)
}

export function wsShowView(id: ViewId): void {
  setBars((b) => showView(b, id))
}

// --- shells ------------------------------------------------------------------

export interface ShellTab {
  id: string
  name: string
  /** Where it starts, when not the task's folder (Files → Open in Terminal). */
  cwd?: string
  /** The terminal profile it runs (none: the default one, Settings → Terminal). */
  profile?: ShellOption
}

// The shells keep running when the workspace closes (they're the main
// process's); their names and how they started are kept here.
const shells = new Map<string, ShellTab[]>()
const NONE: ShellTab[] = []

export function shellsOf(taskId: string): ShellTab[] {
  return shells.get(taskId) ?? NONE
}

export function useShells(taskId: string): ShellTab[] {
  return useSyncExternalStore(subscribe, () => shellsOf(taskId))
}

function setShells(taskId: string, list: ShellTab[]): void {
  shells.set(taskId, list)
  emit()
}

/**
 * A new shell tab - in `cwd` (the task's folder when unset), with a
 * profile - in the focused group, or in a new group beside one.
 */
export function addShell(taskId: string, o: { cwd?: string; profile?: ShellOption; taskRoot?: string; beside?: { gid: string; zone: Exclude<Zone, 'center'> } } = {}): string {
  const id = `${shellPrefix(taskId)}${Date.now().toString(36)}`
  const list = shellsOf(taskId)
  // Named after its folder when it starts somewhere inside the task's, or its profile.
  const norm = (p: string): string => p.split(/[\\/]/).filter(Boolean).join('/').toLowerCase()
  const folder = o.cwd && (!o.taskRoot || norm(o.cwd) !== norm(o.taskRoot)) ? o.cwd.split(/[\\/]/).filter(Boolean).pop() : undefined
  const name = folder ?? (o.profile ? o.profile.label.replace(/ \(WSL\)$/, '') : `shell ${list.length + 1}`)
  setShells(taskId, [...list, { id, name, cwd: o.cwd, profile: o.profile }])
  const tab = `shell:${id}`
  setLayout(taskId, (L) => (o.beside ? openBeside(L, o.beside.gid, o.beside.zone, tab) : openTab(L, tab)))
  return id
}

/** A shell started outside the workspace (an agent's run_in_terminal): it becomes a tab, without taking the focus. */
export function adoptShell(taskId: string, id: string, name: string): void {
  if (shellsOf(taskId).some((s) => s.id === id)) return
  setShells(taskId, [...shellsOf(taskId), { id, name }])
  setLayout(taskId, (L) => addQuietly(L, `shell:${id}`))
}

export function renameShell(taskId: string, id: string, name: string): void {
  setShells(
    taskId,
    shellsOf(taskId).map((s) => (s.id === id ? { ...s, name } : s))
  )
}

/** Closes a shell: its process stops and its tab goes. */
export function closeShell(taskId: string, id: string): void {
  window.api.pty.kill(id)
  setShells(
    taskId,
    shellsOf(taskId).filter((s) => s.id !== id)
  )
  setLayout(taskId, (L) => closeWhere(L, (tab) => tab === `shell:${id}`))
}

/**
 * The shells running for a task (after a reload, or coming back to it):
 * the main process has them. Ones it doesn't have any more are dropped,
 * with their tabs; ones the layout doesn't show yet are added to it.
 */
export async function syncShells(taskId: string): Promise<void> {
  const ids = await window.api.pty.list(shellPrefix(taskId))
  const known = shellsOf(taskId)
  const kept = known.filter((s) => ids.includes(s.id))
  const found = ids.filter((id) => !known.some((s) => s.id === id)).map((id, i) => ({ id, name: `shell ${kept.length + i + 1}` }))
  const list = [...kept, ...found]
  if (list.length !== known.length || found.length) setShells(taskId, list)
  setLayout(taskId, (L) => {
    let next = closeWhere(L, (tab) => tab.startsWith('shell:') && !ids.includes(tab.slice(6)))
    const shown = new Set(groupsOf(next.root).flatMap((g) => g.tabs))
    for (const s of list) if (!shown.has(`shell:${s.id}`)) next = addQuietly(next, `shell:${s.id}`)
    return next
  })
}

/** A tab added to the first group without showing it. */
function addQuietly(L: Layout, tab: TabId): Layout {
  const draft = structuredClone(L)
  const g = groupsOf(draft.root)[0]
  g.tabs.push(tab)
  g.a ??= tab
  return draft
}

// --- dragging ----------------------------------------------------------------

/** What's being dragged around the workspace: a tab (from a group, or a side bar's row), or a side bar's view. */
export type WsDrag = { type: 'tab'; id: TabId; from: string | null } | { type: 'view'; id: ViewId } | null
let drag: WsDrag = null
export function setDrag(d: WsDrag): void {
  if (d === drag) return
  drag = d
  emit()
}
export function getDrag(): WsDrag {
  return drag
}
export function useDrag(): WsDrag {
  return useSyncExternalStore(subscribe, getDrag)
}

/** For dragstart: the tab goes with the drag (and the browser gets something to carry). */
export function startTabDrag(e: React.DragEvent, id: TabId, from: string | null): void {
  e.dataTransfer.effectAllowed = 'copyMove'
  try {
    if (!e.dataTransfer.types.length) e.dataTransfer.setData('text/plain', id)
  } catch {
    // some drags can't carry data; ours is kept here anyway
  }
  // After the browser has taken its picture of what's dragged.
  setTimeout(() => setDrag({ type: 'tab', id, from }), 0)
}
