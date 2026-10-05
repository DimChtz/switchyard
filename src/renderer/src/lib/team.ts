import { useEffect, useSyncExternalStore } from 'react'
import type { TeamMessage } from '@shared/types'

/** The Team channel's messages (see main's team service), kept current. */
let messages: TeamMessage[] = []
let started = false
const listeners = new Set<() => void>()
const heldListeners = new Set<(m: TeamMessage) => void>()

function set(next: TeamMessage[]): void {
  const known = new Set(messages.map((m) => `${m.id}:${m.state}`))
  const fresh = started && messages.length ? next.filter((m) => m.state === 'held' && !known.has(`${m.id}:held`)) : []
  messages = next
  listeners.forEach((l) => l())
  for (const m of fresh) heldListeners.forEach((l) => l(m))
}

function start(): void {
  if (started) return
  window.api.team
    .list()
    .then((m) => {
      messages = m
      started = true
      listeners.forEach((l) => l())
    })
    .catch(() => {})
  window.api.team.onChanged(set)
}

export function useTeam(): TeamMessage[] {
  useEffect(start, [])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => messages
  )
}

/** A message the loop guard held (to say so). */
export function onHeld(fn: (m: TeamMessage) => void): () => void {
  start()
  heldListeners.add(fn)
  return () => heldListeners.delete(fn)
}

/** The conversations: each pair of participants, latest first. */
export function conversations(list: TeamMessage[]): { key: string; a: string; b: string; last: TeamMessage; count: number }[] {
  const by = new Map<string, { key: string; a: string; b: string; last: TeamMessage; count: number }>()
  for (const m of list) {
    const [a, b] = [m.from, m.to].sort()
    const key = `${a}|${b}`
    const c = by.get(key)
    if (c) {
      c.last = m
      c.count++
    } else by.set(key, { key, a, b, last: m, count: 1 })
  }
  return [...by.values()].sort((x, y) => y.last.at - x.last.at)
}
