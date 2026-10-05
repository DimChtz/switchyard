import type { WebContents } from 'electron'
import * as ptyService from './pty'
import { screenText } from './agentStatus'
import { findLimit } from '@shared/limits'
import { IPC } from '@shared/ipc'
import type { AgentLimit } from '@shared/types'

/**
 * Watches agents' terminals for a usage limit ("…limit reached, resets at
 * 3pm"): once the output goes quiet (or the agent exits), the last lines
 * are read. The window puts the task to sleep and wakes it at the reset.
 */

const QUIET_MS = 1500
const TAIL = 8000
/**
 * After something is sent to the agent (it was woken, or you wrote), the
 * same limit message still on its screen - redrawn as terminals do - isn't
 * news for this long; if it's still the last thing there after, it is.
 */
const GRACE_MS = 3 * 60_000

interface Watch {
  tail: string
  timer: ReturnType<typeof setTimeout> | null
  sender: WebContents
  /** What was reported last, and when (not said twice). */
  said: string | null
  saidAt: number
}

const watches = new Map<string, Watch>()

function check(id: string): void {
  const w = watches.get(id)
  if (!w) return
  w.timer = null
  const hit = findLimit(screenText(w.tail), Date.now())
  if (!hit) {
    // It moved on: a limit later is news again.
    w.said = null
    return
  }
  if (w.said === hit.text) {
    const wrote = ptyService.lastWriteAt(id)
    // Nothing was sent to it since: the same limit, still on screen.
    if (wrote <= w.saidAt) return
    // Sent something just now: look again once the grace is over.
    const left = wrote + GRACE_MS - Date.now()
    if (left > 0) {
      w.timer = setTimeout(() => check(id), left + 100)
      return
    }
  }
  w.said = hit.text
  w.saidAt = Date.now()
  const limit: AgentLimit = { taskId: id.slice('agent-'.length), resetAt: hit.resetAt, text: hit.text }
  if (!w.sender.isDestroyed()) w.sender.send(IPC.agentLimit, limit)
}

export function start(): void {
  ptyService.events.on('spawn', (id: string) => {
    const w = watches.get(id)
    if (w?.timer) clearTimeout(w.timer)
    watches.delete(id)
  })
  ptyService.events.on('data', (id: string, data: string, sender: WebContents) => {
    if (!id.startsWith('agent-')) return
    let w = watches.get(id)
    if (!w || w.sender !== sender) {
      w = { tail: '', timer: null, sender, said: w?.said ?? null, saidAt: w?.saidAt ?? 0 }
      watches.set(id, w)
    }
    w.tail = (w.tail + data).slice(-TAIL)
    if (w.timer) clearTimeout(w.timer)
    w.timer = setTimeout(() => check(id), QUIET_MS)
  })
  // Some CLIs exit when they hit the limit.
  ptyService.events.on('exit', (id: string) => {
    const w = watches.get(id)
    if (!w) return
    if (w.timer) clearTimeout(w.timer)
    check(id)
  })
}
