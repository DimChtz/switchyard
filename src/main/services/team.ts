import { BrowserWindow } from 'electron'
import { randomBytes } from 'crypto'
import { getPrefs, getTasks, getTeam, setTeam } from './store'
import { deliver } from './inbox'
import { AGENTS } from '@shared/constants'
import { IPC } from '@shared/ipc'
import type { ConflictPair, Task, TeamMessage } from '@shared/types'

/**
 * The Team channel: agents of tasks running in parallel message each other
 * (their send_message tool), you message them, and Switchyard introduces
 * two whose changes clash. A message is typed into the other agent's session
 * once it's between turns.
 */

const KEEP = 500
/** More than this many messages between two agents in an hour, without you, and the next are held. */
const LOOP_LIMIT = 8

function changed(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.teamChanged, getTeam())
}

function save(messages: TeamMessage[]): void {
  setTeam(messages.slice(-KEEP))
  changed()
}

function patch(id: string, p: Partial<TeamMessage>): void {
  save(getTeam().map((m) => (m.id === id ? { ...m, ...p } : m)))
}

const agentName = (t: Task | undefined): string => AGENTS.find((a) => a.kind === t?.agentKind)?.name ?? 'an agent'

/** Who sent it, as the receiving agent reads it. */
function asTyped(m: TeamMessage, tasks: Task[]): string {
  if (m.from === 'user') return `[Team channel - from the user] ${m.text}`
  if (m.from === 'switchyard') return `[Team channel - from Switchyard] ${m.text}`
  const t = tasks.find((x) => x.id === m.from)
  const who = t ? `${t.key} "${t.title}" (${agentName(t)}, branch ${t.branch ?? '-'})` : m.from
  return `[Team channel - from the agent on ${who}] ${m.text} (Answer with the send_message tool, to: "${t?.key ?? m.from}", if you need to - or just take it into account.)`
}

function hand(m: TeamMessage): void {
  const how = deliver(m.to, asTyped(m, getTasks()), () => patch(m.id, { state: 'delivered' }))
  if (how === 'queued') patch(m.id, { state: 'queued' })
}

/** Sends a message to a task's agent. `from`: a task id, 'user' or 'switchyard'. */
export function send(from: string, toKey: string, text: string): TeamMessage {
  const tasks = getTasks()
  const to = tasks.find((t) => t.id === toKey || t.key.toLowerCase() === toKey.toLowerCase())
  if (!to) throw new Error(`No task ${toKey} on the board.`)
  if (to.id === from) throw new Error('That is your own task.')
  if (to.col === 'done' || !to.agentKind) throw new Error(`${to.key} has no agent working on it.`)
  const body = text.trim()
  if (!body) throw new Error('The message is empty.')
  const now = Date.now()
  // Two agents going back and forth without you: hold the rest.
  const between = getTeam().filter(
    (m) => m.at > now - 3_600_000 && m.from !== 'user' && m.from !== 'switchyard' && ((m.from === from && m.to === to.id) || (m.from === to.id && m.to === from))
  ).length
  const held = from !== 'user' && from !== 'switchyard' && between >= LOOP_LIMIT
  const m: TeamMessage = { id: `${now.toString(36)}${randomBytes(2).toString('hex')}`, at: now, from, to: to.id, text: body.slice(0, 4000), state: held ? 'held' : 'queued' }
  save([...getTeam(), m])
  if (!held) hand(m)
  // As it is now (it may have been typed in already).
  return getTeam().find((x) => x.id === m.id) ?? m
}

/** Lets a held message through. */
export function release(id: string): void {
  const m = getTeam().find((x) => x.id === id)
  if (!m || m.state !== 'held') return
  patch(id, { state: 'queued' })
  hand({ ...m, state: 'queued' })
}

export function list(): TeamMessage[] {
  return getTeam()
}

/** The agent fetched its messages (read_messages): those for it that weren't typed in yet count as read. */
export function readFor(taskId: string): TeamMessage[] {
  const mine = getTeam().filter((m) => m.to === taskId || m.from === taskId)
  const unread = new Set(mine.filter((m) => m.to === taskId && m.state === 'queued').map((m) => m.id))
  if (unread.size) save(getTeam().map((m) => (unread.has(m.id) ? { ...m, state: 'read' } : m)))
  return mine.slice(-30)
}

// Pairs introduced already (this run), by what clashed.
const introduced = new Set<string>()

/** After a conflict check: two running agents whose changes clash newly get to know each other. */
export function introduce(pairs: ConflictPair[]): void {
  if (!getPrefs().teamIntroduce) return
  const tasks = getTasks()
  for (const p of pairs) {
    if (!p.b || !p.conflicts.length) continue
    const a = tasks.find((t) => t.id === p.a)
    const b = tasks.find((t) => t.id === p.b)
    if (!a?.agentKind || !b?.agentKind || a.col === 'done' || b.col === 'done') continue
    const key = [a.id, b.id].sort().join('|') + ':' + p.conflicts.join(',')
    if (introduced.has(key)) continue
    introduced.add(key)
    const files = p.conflicts.join(', ')
    for (const [me, other] of [
      [a, b],
      [b, a]
    ] as const) {
      try {
        send(
          'switchyard',
          me.id,
          `You and ${other.key} "${other.title}" (${agentName(other)}, branch ${other.branch ?? '-'}), running in parallel, both change ${files} - and your changes clash there. Agree with them who changes what: send_message (to: "${other.key}") says what you're doing to those files; read_messages shows what they said.`
        )
      } catch {
        // one of them has no agent now
      }
    }
  }
}

/** At start: messages still queued from last time wait for their agents again. */
export function start(): void {
  for (const m of getTeam()) if (m.state === 'queued') hand(m)
}
