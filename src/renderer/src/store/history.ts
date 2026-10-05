import type { AppState } from './types'
import type { ViewName } from '@shared/types'

/** Where the app was: what the back and forward buttons return to. */
export interface Place {
  view: ViewName
  projectId: string | null
  taskId: string | null
  settingsSection: string
  noteId: string | null
}

export interface NavHistory {
  back: Place[]
  forward: Place[]
}

const LIMIT = 50

export function placeOf(s: AppState): Place {
  return { view: s.view, projectId: s.projectId, taskId: s.taskId, settingsSection: s.settingsSection, noteId: s.noteId }
}

/** What tells two places apart on their screen (a board's project, a workspace's task...). */
function placeKey(p: Place): string {
  switch (p.view) {
    case 'workspace':
      return `workspace:${p.taskId}`
    case 'board':
      return `board:${p.projectId}`
    case 'settings':
      return `settings:${p.settingsSection}`
    case 'notes':
      return `notes:${p.noteId ?? ''}`
    default:
      return p.view
  }
}

/** A place that can still be shown (its task or project may have gone since). */
function stillThere(s: AppState, p: Place): boolean {
  if (p.view === 'workspace') return s.tasks.some((t) => t.id === p.taskId)
  if (p.view === 'board') return s.projects.some((x) => x.id === p.projectId)
  return true
}

/** After an update: when it moved somewhere else, the place it left goes onto the back list. */
export function remember(prev: AppState, next: AppState): AppState {
  if (next.view === prev.view && next.projectId === prev.projectId && next.taskId === prev.taskId && next.settingsSection === prev.settingsSection && next.noteId === prev.noteId) return next
  const from = placeOf(prev)
  if (placeKey(from) === placeKey(placeOf(next))) return next
  const back = [...next.nav.back, from].slice(-LIMIT)
  return { ...next, nav: { back, forward: [] } }
}

/** Back (-1) or forward (1), past places that are gone. */
export function travel(s: AppState, dir: -1 | 1): AppState {
  const from = dir < 0 ? [...s.nav.back] : [...s.nav.forward]
  const other = dir < 0 ? [...s.nav.forward] : [...s.nav.back]
  let to: Place | undefined
  while ((to = from.pop()) && !stillThere(s, to)) {
    // skipped: its task or project was removed
  }
  if (!to) {
    // Nowhere left to go (what was there is gone).
    if (!(dir < 0 ? s.nav.back : s.nav.forward).length) return s
    return { ...s, nav: dir < 0 ? { back: [], forward: s.nav.forward } : { back: s.nav.back, forward: [] } }
  }
  other.push(placeOf(s))
  return {
    ...s,
    ...to,
    palette: null,
    nav: dir < 0 ? { back: from, forward: other } : { back: other, forward: from }
  }
}

export function canGo(s: AppState, dir: -1 | 1): boolean {
  return (dir < 0 ? s.nav.back : s.nav.forward).some((p) => stillThere(s, p))
}
