import { useSyncExternalStore } from 'react'

// The main sidebar collapsed to its icon rail (⌘B), remembered on this machine.
const KEY = 'sy.sbMini'
const listeners = new Set<() => void>()
let mini = ((): boolean => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
})()

export function toggleSidebar(): void {
  mini = !mini
  try {
    localStorage.setItem(KEY, mini ? '1' : '0')
  } catch {
    // (Not remembered, then.)
  }
  listeners.forEach((f) => f())
}

export function useSidebarMini(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => mini
  )
}
