import { useEffect, useRef } from 'react'

/**
 * Asks a task's workspace to do something only it can (its tabs and side
 * bars are opened through wsStore) - from a menu or a key. A request is
 * delivered at once when the workspace is open, and otherwise kept for
 * when it next is.
 */
export interface WorkspaceRequests {
  /** The search side bar, its box focused (Ctrl+Shift+F). */
  search: Record<string, never>
}
type Kind = keyof WorkspaceRequests

const pending = new Map<string, unknown>()
const EVENT = 'switchyard:workspace-request'
const keyOf = (kind: Kind, taskId: string): string => `${kind}:${taskId}`

export function requestWorkspace<K extends Kind>(kind: K, taskId: string, payload: WorkspaceRequests[K]): void {
  pending.set(keyOf(kind, taskId), payload)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: keyOf(kind, taskId) }))
}

/** Handles this task's requests of one kind, including one made before the tab mounted. */
export function useWorkspaceRequest<K extends Kind>(kind: K, taskId: string, handler: (payload: WorkspaceRequests[K]) => void): void {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    const key = keyOf(kind, taskId)
    const take = (): void => {
      if (!pending.has(key)) return
      const payload = pending.get(key) as WorkspaceRequests[K]
      pending.delete(key)
      latest.current(payload)
    }
    take()
    const onRequest = (e: Event): void => {
      if ((e as CustomEvent<string>).detail === key) take()
    }
    window.addEventListener(EVENT, onRequest)
    return () => window.removeEventListener(EVENT, onRequest)
  }, [kind, taskId])
}
