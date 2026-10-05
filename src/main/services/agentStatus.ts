import type { WebContents } from 'electron'
import * as usage from './usage'
import type { AgentSession, AgentStatusUpdate } from '@shared/types'
import * as ptyService from './pty'
import type { HookEvent } from './hooks'
import { describeTool } from './transcript'
import { takeReplies } from './review'
import * as checkpoints from './checkpoints'
import * as inbox from './inbox'
import { beforeTool } from './coedit'
import * as repoMap from './repoMap'

// Agent CLIs are interactive TUIs, not structured event streams, so status is
// inferred from their terminal output:
//  - working: the TUI keeps redrawing (spinners, streamed text, tool output)
//  - waiting: output has gone quiet. If the last screen is an approval
//    prompt it's a yes/no question, otherwise the agent finished its turn
//    and wants the next message.
//  - failed / done: the process exited, non-zero / zero.
const QUIET_MS = 2500
// Output right after the user typed or the terminal resized is an echo or a
// redraw, not the agent doing work.
const INPUT_ECHO_MS = 400
const TAIL_CHARS = 12_000
// While waiting, output must keep arriving (gaps under BURST_GAP_MS) for
// CONFIRM_MS before the agent counts as working again.
const CONFIRM_MS = 1000
const BURST_GAP_MS = 600

const PERMISSION_RE =
  /do you want to (proceed|make this edit|create|run|allow|continue|overwrite|delete)|do you trust the files|allow (once|always|execution)|yes, (allow|and don't ask again)|approve\?|\(y\/n\)|\[y\/n\]|would you like to (run|make|apply|allow)|waiting for (your )?approval|apply this change\?|\(y\)es\/\(n\)o|run this command\?|allow this (?:tool|command)/i

interface Watch {
  st: 'working' | 'waiting'
  tail: string
  timer: NodeJS.Timeout | null
  sender: WebContents
  last: AgentStatusUpdate | null
  burstStart: number | null
  lastDataAt: number
  /** Hooks: the tool it last started, and its session. */
  lastTool: string | null
  session: AgentSession | null
}

const watches = new Map<string, Watch>()

// eslint-disable-next-line no-control-regex
const CURSOR_LINE = /\x1b\[\d*(;\d*)?[HfABEF]/g
// eslint-disable-next-line no-control-regex
const CURSOR_FWD = /\x1b\[\d*C/g
// eslint-disable-next-line no-control-regex
const OTHER_ESC = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

/** Rough plain-text rendering of TUI output: cursor moves become breaks. */
export function screenText(raw: string): string {
  return raw
    .replace(CURSOR_LINE, '\n')
    .replace(CURSOR_FWD, ' ')
    .replace(OTHER_ESC, '')
    .split('\n')
    .map((l) => {
      const parts = l.split('\r').filter((p) => p.length > 0)
      return (parts[parts.length - 1] ?? '')
        .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '') // eslint-disable-line no-control-regex
        .replace(/[│┃╭╮╰╯─━┌┐└┘├┤]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    })
    .filter((l) => l.length > 0)
    .join('\n')
}

/** Claude Code's first-run question for a folder (each new worktree can be one). Hooks don't run before it's answered. */
export const TRUST_ASK = 'Trust this folder? Claude Code asks once per new folder.'
const TRUST_RE = /yes, i trust this folder|is this a project you created or one you trust/i

export function classify(raw: string): Pick<AgentStatusUpdate, 'askKind' | 'ask'> {
  const lines = screenText(raw).split('\n').slice(-40)
  const recent = lines.join('\n')
  if (TRUST_RE.test(recent)) return { askKind: 'permission', ask: TRUST_ASK }
  if (!PERMISSION_RE.test(recent)) return { askKind: 'input', ask: null }
  const question =
    [...lines].reverse().find((l) => PERMISSION_RE.test(l) && /\?/.test(l)) ??
    [...lines].reverse().find((l) => /\?\s*$/.test(l)) ??
    [...lines].reverse().find((l) => PERMISSION_RE.test(l)) ??
    null
  return { askKind: 'permission', ask: question ? question.slice(0, 240) : null }
}

function emit(w: Watch, update: AgentStatusUpdate): void {
  const prev = w.last
  if (
    prev &&
    prev.st === update.st &&
    prev.ask === update.ask &&
    prev.askKind === update.askKind &&
    prev.exitCode === update.exitCode &&
    (prev.activity ?? null) === (update.activity ?? null) &&
    prev.session?.id === update.session?.id
  )
    return
  w.last = update
  if (!w.sender.isDestroyed()) w.sender.send('agent:status', update)
  // Waiting for its next message: what Switchyard has for it goes now.
  if (update.st === 'waiting' && update.askKind === 'input') inbox.flush(update.taskId)
}

/** Whether the task's agent is at its prompt, waiting for a message (not working, not asking for approval). */
export function waitingForInput(taskId: string): boolean {
  const id = `agent-${taskId}`
  const w = watches.get(id)
  return !!w && ptyService.exists(id) && w.st === 'waiting' && w.last?.st === 'waiting' && w.last.askKind === 'input'
}

// ── Claude Code hooks ───────────────────────────────────────────────
// Sessions that report through hooks get their status from those events
// instead of from reading the screen.
const hooked = new Set<string>()

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

export function fromHook(taskId: string, ev: HookEvent): Record<string, unknown> | null | void {
  const id = `agent-${taskId}`
  const sender = ptyService.senderOf(id)
  if (!sender || !ptyService.exists(id)) return null
  hooked.add(id)
  let w = watches.get(id)
  if (!w || w.sender !== sender) {
    w = { st: 'working', tail: '', timer: null, sender, last: null, burstStart: null, lastDataAt: 0, lastTool: null, session: null }
    watches.set(id, w)
  }
  if (w.timer) clearTimeout(w.timer)
  w.timer = null
  if (ev.session_id && ev.transcript_path) w.session = { id: ev.session_id, transcript: ev.transcript_path }
  // What it has used so far: after each turn, and now and then while it works.
  if (w.session && (ev.hook_event_name === 'Stop' || ev.hook_event_name === 'PostToolUse' || ev.hook_event_name === 'SessionEnd'))
    usage.refresh(taskId, w.session, ev.hook_event_name === 'PostToolUse' ? 10_000 : 1500)
  const base = { taskId, exitCode: null, session: w.session }
  const working = (activity: string | null): null => {
    w!.st = 'working'
    emit(w!, { ...base, st: 'working', askKind: null, ask: null, activity })
    return null
  }

  switch (ev.hook_event_name) {
    case 'SessionStart':
      // Idle at the prompt until one arrives - a start with a first
      // message follows up with UserPromptSubmit right away; a resume
      // without one just waits.
      emit(w, { ...(w.last ?? { st: 'working', askKind: null, ask: null }), ...base, activity: null })
      w.timer = setTimeout(() => {
        w!.timer = null
        w!.st = 'waiting'
        emit(w!, { ...base, st: 'waiting', askKind: 'input', ask: null, activity: null })
      }, 3000)
      return
    case 'UserPromptSubmit':
      if (ev.prompt) checkpoints.promptSent(taskId, ev.prompt)
      return working('Thinking…')
    case 'PreToolUse': {
      w.lastTool = describeTool(ev.tool_name ?? 'a tool', ev.tool_input)
      // The file it's on, for the repository map.
      repoMap.noteTool(taskId, ev.tool_name, ev.tool_input)
      working(w.lastTool)
      // Writing over a file you just changed: refused until it reads it again.
      return beforeTool(taskId, ev.tool_name, ev.tool_input)
    }
    case 'PostToolUse':
      return working(w.last?.activity ?? w.lastTool)
    case 'Notification': {
      const msg = ev.message ?? ''
      if (ev.notification_type === 'permission_prompt' || /permission/i.test(msg)) {
        w.st = 'waiting'
        const ask = w.lastTool ? `${oneLine(msg, 120)} · ${w.lastTool}` : oneLine(msg, 200)
        return emit(w, { ...base, st: 'waiting', askKind: 'permission', ask, activity: w.lastTool })
      }
      if (ev.notification_type === 'idle_prompt' || /waiting for your input/i.test(msg)) {
        w.st = 'waiting'
        return emit(w, { ...base, st: 'waiting', askKind: 'input', ask: null, activity: w.last?.activity ?? null })
      }
      return
    }
    case 'Stop': {
      // Finished its turn. Its last words say what it did.
      w.st = 'waiting'
      // Its answers to review comments it was asked about.
      takeReplies(taskId, ev.last_assistant_message, w.session?.transcript).catch(() => {})
      // The files as the turn left them.
      checkpoints.turnEnded(taskId, { said: ev.last_assistant_message?.trim().slice(0, 1500) || null, lastSent: ptyService.takeLastSent(id), transcript: w.session?.transcript })
      const said = ev.last_assistant_message ? oneLine(ev.last_assistant_message, 200) : null
      return emit(w, { ...base, st: 'waiting', askKind: 'input', ask: null, activity: said })
    }
  }
}

function taskIdOf(sessionId: string): string {
  return sessionId.slice('agent-'.length)
}

function evaluate(id: string): void {
  const w = watches.get(id)
  if (!w || !ptyService.exists(id) || hooked.has(id)) return
  w.timer = null
  const was = w.st
  w.st = 'waiting'
  w.burstStart = null
  const ask = classify(w.tail)
  // Done with a turn (not stopped to ask): the files as it left them.
  if (was === 'working' && ask.askKind === 'input') {
    checkpoints.turnEnded(taskIdOf(id), { said: null, lastSent: ptyService.takeLastSent(id) })
    // Agents without hooks (Codex): what the turn used, from its session log.
    usage.refreshCodex(taskIdOf(id))
  }
  emit(w, { taskId: taskIdOf(id), st: 'waiting', ...ask, exitCode: null })
}

export function start(): void {
  inbox.setReadiness(waitingForInput)
  // A new process under the same id starts over (it may not report through hooks).
  ptyService.events.on('spawn', (id: string, cwd: string) => {
    // An agent's session: its files as they are when it starts.
    if (id.startsWith('agent-')) checkpoints.sessionStarted(taskIdOf(id), cwd)
    const w = watches.get(id)
    if (w?.timer) clearTimeout(w.timer)
    watches.delete(id)
    hooked.delete(id)
  })

  ptyService.events.on('data', (id: string, data: string, sender: WebContents) => {
    if (!id.startsWith('agent-') || hooked.has(id)) return
    let w = watches.get(id)
    if (!w || w.sender !== sender) {
      w = { st: 'working', tail: '', timer: null, sender, last: null, burstStart: null, lastDataAt: 0, lastTool: null, session: null }
      watches.set(id, w)
    }
    w.tail = (w.tail + data).slice(-TAIL_CHARS)
    const now = Date.now()

    if (w.timer) clearTimeout(w.timer)
    w.timer = setTimeout(() => evaluate(id), QUIET_MS)

    if (w.st === 'waiting') {
      if (now - ptyService.lastInputAt(id) < INPUT_ECHO_MS) return
      // A single redraw (focus change, notice, resize) isn't work: only
      // flip back to working once output keeps coming for a while, the
      // way a spinner or streamed response does.
      if (w.burstStart === null || now - w.lastDataAt > BURST_GAP_MS) w.burstStart = now
      w.lastDataAt = now
      if (now - w.burstStart < CONFIRM_MS) return
      w.st = 'working'
    }
    w.lastDataAt = now
    emit(w, { taskId: taskIdOf(id), st: 'working', askKind: null, ask: null, exitCode: null })
  })

  ptyService.events.on('exit', (id: string, exitCode: number, sender: WebContents) => {
    if (!id.startsWith('agent-')) return
    const w = watches.get(id)
    if (w?.timer) clearTimeout(w.timer)
    // It exited in the middle of a turn: what it left.
    if (w?.st === 'working') checkpoints.turnEnded(taskIdOf(id), { said: null, lastSent: ptyService.takeLastSent(id), transcript: w.session?.transcript })
    usage.refreshCodex(taskIdOf(id))
    watches.delete(id)
    hooked.delete(id)
    const update: AgentStatusUpdate = {
      taskId: taskIdOf(id),
      st: exitCode === 0 ? 'done' : 'failed',
      askKind: null,
      ask: exitCode === 0 ? null : `Exited with code ${exitCode}`,
      exitCode,
      activity: null,
      session: w?.session ?? null
    }
    if (!sender.isDestroyed()) sender.send('agent:status', update)
  })
}

/** Latest known status of every running agent session (for a reloaded renderer). */
export function current(): AgentStatusUpdate[] {
  return [...watches.entries()]
    .filter(([id]) => ptyService.exists(id))
    .map(([id, w]) => w.last ?? { taskId: taskIdOf(id), st: w.st, askKind: null, ask: null, exitCode: null })
}
