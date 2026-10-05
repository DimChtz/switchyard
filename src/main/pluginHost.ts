/**
 * The plugin host: a separate Node process (Electron's utilityProcess) that
 * runs the enabled plugins' scripts, so a plugin that crashes or hangs
 * doesn't take the app with it. Each plugin's `activate(sy)` gets the API
 * below; everything it does goes to the app as a message (see
 * services/plugins.ts, which checks each one).
 */
import { createRequire } from 'module'
import type { PluginCommandContext } from '@shared/plugins'

type Msg = Record<string, unknown> & { type: string }

const port = process.parentPort
const send = (m: Msg): void => port.postMessage(m)

let seq = 0
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
/** Asks the app for something (a call answered with a result). */
function call(plugin: string, method: string, ...args: unknown[]): Promise<unknown> {
  const callId = ++seq
  return new Promise((resolve, reject) => {
    waiting.set(callId, { resolve, reject })
    send({ type: 'call', callId, plugin, method, args })
  })
}

type Handler = (ctx: PluginCommandContext) => unknown
const handlers = new Map<string, Handler>()
const listeners = new Map<string, Set<(...a: unknown[]) => void>>()
/** Each task as last seen, to tell plugins which ones changed. */
let known = new Map<string, string>()

function log(plugin: string, level: 'info' | 'warn' | 'error', parts: unknown[]): void {
  const text = parts.map((p) => (p instanceof Error ? (p.stack ?? p.message) : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')
  send({ type: 'log', plugin, level, text: text.slice(0, 4000) })
}

function apiFor(plugin: string, commands: string[]): unknown {
  const on = (event: string, fn: (...a: unknown[]) => void): (() => void) => {
    if (typeof fn !== 'function') throw new TypeError('sy.on needs a function')
    const key = `${plugin}\0${event}`
    if (!listeners.has(key)) listeners.set(key, new Set())
    listeners.get(key)!.add(fn)
    return () => listeners.get(key)?.delete(fn)
  }
  return Object.freeze({
    id: plugin,
    commands: {
      register(id: string, fn: Handler): () => void {
        if (!commands.includes(id)) throw new Error(`Command "${id}" isn't in plugin.json's "commands" - add it there first`)
        if (typeof fn !== 'function') throw new TypeError('commands.register needs a function')
        handlers.set(`${plugin}.${id}`, fn)
        return () => handlers.delete(`${plugin}.${id}`)
      }
    },
    tasks: {
      list: () => call(plugin, 'tasks.list'),
      get: (id: string) => call(plugin, 'tasks.get', id),
      create: (task: { projectId: string; title: string; desc?: string; col?: 'backlog' | 'ready' }) => call(plugin, 'tasks.create', task)
    },
    projects: { list: () => call(plugin, 'projects.list') },
    agents: { message: (taskId: string, text: string) => call(plugin, 'agents.message', taskId, text) },
    badges: {
      set: (taskId: string, badges: unknown) => call(plugin, 'badges.set', taskId, badges),
      clear: (taskId?: string) => call(plugin, 'badges.clear', taskId ?? null)
    },
    ui: {
      toast: (text: string) => call(plugin, 'ui.toast', text),
      notify: (title: string, body: string, taskId?: string) => call(plugin, 'ui.notify', title, body, taskId ?? null),
      copy: (text: string) => call(plugin, 'ui.copy', text),
      openExternal: (url: string) => call(plugin, 'ui.openExternal', url)
    },
    on,
    log: (...parts: unknown[]) => log(plugin, 'info', parts),
    warn: (...parts: unknown[]) => log(plugin, 'warn', parts),
    error: (...parts: unknown[]) => log(plugin, 'error', parts)
  })
}

function emit(plugin: string | null, event: string, ...args: unknown[]): void {
  for (const [key, set] of listeners) {
    const [p, e] = key.split('\0')
    if (e !== event || (plugin && p !== plugin)) continue
    for (const fn of set) {
      try {
        const r = fn(...args) as unknown
        if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch((err: unknown) => log(p, 'error', [`${event} handler:`, err]))
      } catch (err) {
        log(p, 'error', [`${event} handler:`, err])
      }
    }
  }
}

async function load(plugins: { id: string; main: string; commands: string[] }[]): Promise<void> {
  for (const p of plugins) {
    try {
      const mod = createRequire(p.main)(p.main) as { activate?: (sy: unknown) => unknown }
      if (typeof mod.activate !== 'function') throw new Error('main.js must export an activate(sy) function')
      await mod.activate(apiFor(p.id, p.commands))
      send({ type: 'loaded', id: p.id })
    } catch (err) {
      send({ type: 'loaded', id: p.id, error: err instanceof Error ? err.message : String(err) })
      log(p.id, 'error', ['activate failed:', err])
    }
  }
}

port.on('message', (e) => {
  const m = e.data as Msg
  switch (m.type) {
    case 'load':
      void load(m.plugins as { id: string; main: string; commands: string[] }[])
      break
    case 'result': {
      const w = waiting.get(m.callId as number)
      if (!w) break
      waiting.delete(m.callId as number)
      if (m.error) w.reject(new Error(String(m.error)))
      else w.resolve(m.value)
      break
    }
    case 'run': {
      const fn = handlers.get(m.command as string)
      const done = (error?: string): void => send({ type: 'ran', callId: m.callId, error })
      if (!fn) {
        done('Its plugin has no handler for it (did activate() register it?)')
        break
      }
      Promise.resolve()
        .then(() => fn(m.ctx as PluginCommandContext))
        .then(
          () => done(),
          (err: unknown) => {
            log(String(m.command).split('.')[0], 'error', [`${m.command}:`, err])
            done(err instanceof Error ? err.message : String(err))
          }
        )
      break
    }
    case 'tasks': {
      // "tasks": all of them; "task": each one that changed (with how it was).
      const tasks = m.tasks as { id: string }[]
      const next = new Map(tasks.map((t) => [t.id, JSON.stringify(t)]))
      emit(null, 'tasks', tasks)
      for (const t of tasks) {
        const before = known.get(t.id)
        if (before !== next.get(t.id)) emit(null, 'task', t, before ? JSON.parse(before) : null)
      }
      known = next
      break
    }
  }
})

process.on('uncaughtException', (err) => log('host', 'error', ['uncaught:', err]))
process.on('unhandledRejection', (err) => log('host', 'error', ['unhandled rejection:', err]))
send({ type: 'ready' })
