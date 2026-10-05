import { useSyncExternalStore } from 'react'
import type { Notice } from '@shared/types'

/**
 * The notification center's history: what agents and tasks did that you'd
 * want to know about - kept (the latest 200) across restarts.
 */
const MAX = 200
let notices: Notice[] = []
let loaded = false
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

let saving: ReturnType<typeof setTimeout> | undefined
function save(): void {
  clearTimeout(saving)
  saving = setTimeout(() => window.api.store.setNotices(notices).catch(() => {}), 300)
}

export function loadNotices(): void {
  if (loaded) return
  loaded = true
  window.api.store
    .getNotices()
    .then((n) => {
      // Anything added before they came in stays on top.
      notices = [...notices, ...n.filter((x) => !notices.some((y) => y.id === x.id))].slice(0, MAX)
      emit()
    })
    .catch(() => {})
}

export function addNotice(n: Omit<Notice, 'id' | 'at' | 'read'>): void {
  const at = Date.now()
  notices = [{ ...n, id: `${at}-${Math.random().toString(36).slice(2, 8)}`, at, read: false }, ...notices].slice(0, MAX)
  emit()
  save()
}

export function markRead(ids?: string[]): void {
  const set = ids ? new Set(ids) : null
  if (!notices.some((n) => !n.read && (!set || set.has(n.id)))) return
  notices = notices.map((n) => (!n.read && (!set || set.has(n.id)) ? { ...n, read: true } : n))
  emit()
  save()
}

export function clearNotices(): void {
  notices = []
  emit()
  save()
}

export function useNotices(): Notice[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => notices
  )
}

/** Toggles the notification center (the bell, and its shortcut). */
export function toggleNoticeCenter(): void {
  window.dispatchEvent(new CustomEvent('switchyard:notices'))
}
