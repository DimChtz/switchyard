import * as ptyService from './pty'

/**
 * Messages for a task's agent from Switchyard (the Team channel, your
 * edits): typed into its session when it's waiting for input, otherwise
 * kept until its turn ends - never into the middle of a turn, or into an
 * approval question.
 */

interface Item {
  text: string
  delivered?: () => void
}

const queue = new Map<string, Item[]>()
let ready: (taskId: string) => boolean = () => false

/** How to tell an agent is waiting for its next message (agentStatus says). */
export function setReadiness(fn: (taskId: string) => boolean): void {
  ready = fn
}


/** Delivers now if the agent is waiting for input, else when it next is. */
export function deliver(taskId: string, text: string, delivered?: () => void): 'now' | 'queued' {
  const items = queue.get(taskId) ?? []
  items.push({ text, delivered })
  queue.set(taskId, items)
  if (ready(taskId)) {
    flush(taskId)
    return 'now'
  }
  return 'queued'
}

let timers = new Map<string, ReturnType<typeof setTimeout>>()

/** The agent is waiting for input: what's queued goes, as one message (a moment later, so its prompt is ready). */
export function flush(taskId: string): void {
  if (!queue.get(taskId)?.length || timers.has(taskId)) return
  timers.set(
    taskId,
    setTimeout(() => {
      timers.delete(taskId)
      const items = queue.get(taskId) ?? []
      const id = `agent-${taskId}`
      if (!items.length || !ptyService.exists(id) || !ready(taskId)) return
      queue.delete(taskId)
      // (Several lines go as one paste where the agent takes those - see sendText.)
      ptyService.sendText(id, items.map((i) => i.text.trim()).join('\n\n---\n\n'))
      for (const i of items) i.delivered?.()
    }, 700)
  )
}

/** How many wait for the task's agent. */
export function waiting(taskId: string): number {
  return queue.get(taskId)?.length ?? 0
}

/** For tests. */
export function reset(): void {
  queue.clear()
  for (const t of timers.values()) clearTimeout(t)
  timers = new Map()
}
