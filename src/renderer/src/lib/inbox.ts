import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAppStore } from '../store/AppStore'
import { useNotices } from './notices'
import { useTeam } from './team'
import { useConflicts } from './conflicts'
import type { ReviewComment } from '@shared/types'
import { buildInbox, type InboxItem } from './inboxItems'

export { buildInbox, type InboxItem, type InboxKind } from './inboxItems'

// The review comments, kept current for the Inbox (and refreshed after it changes some).
let comments: ReviewComment[] = []
let started = false
const listeners = new Set<() => void>()
export function refreshComments(): void {
  window.api.store
    .getComments()
    .then((c) => {
      comments = c
      listeners.forEach((l) => l())
    })
    .catch(() => {})
}
export function useComments(): ReviewComment[] {
  useEffect(() => {
    if (started) return
    started = true
    refreshComments()
    window.api.store.onCommentsChanged(refreshComments)
  }, [])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => comments
  )
}

/** The Inbox's items, live. */
export function useInboxItems(): InboxItem[] {
  const { state } = useAppStore()
  const c = useComments()
  const notices = useNotices()
  const team = useTeam()
  const conflicts = useConflicts()
  return useMemo(() => buildInbox({ tasks: state.tasks, comments: c, notices, team, conflicts }), [state.tasks, c, notices, team, conflicts])
}
