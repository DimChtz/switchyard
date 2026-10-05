import { useSyncExternalStore } from 'react'
import { setPluginAgents } from '@shared/constants'
import { pluginCommandId, type PackagePreview, type PluginBadge, type PluginInfo, type PluginUiEvent } from '@shared/plugins'
import type { AgentDef } from '@shared/types'
import type { KeyCommand } from '@shared/keybindings'
import { setPluginKeyCommands } from './shortcuts'
import { nextTaskKey } from './derive'
import type { Action, AppState } from '../store/types'

/**
 * The plugins in the page: their list (Settings → Plugins), their agents
 * (into AGENTS), their commands (palette, Plugins menu, keys) and the
 * badges they put on cards. What a plugin asks for arrives as a
 * PluginUiEvent - already checked by the main process.
 */

let plugins: PluginInfo[] = []
/** Badges per task, per plugin. */
let badges = new Map<string, Map<string, PluginBadge[]>>()
let version = 0
const listeners = new Set<() => void>()
const bump = (): void => {
  version += 1
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** A plugin's command, as the app knows it. */
export interface PluginCommandEntry {
  /** "<plugin>.<command>" */
  id: string
  title: string
  plugin: string
  pluginName: string
}

export function pluginCommands(): PluginCommandEntry[] {
  return plugins
    .filter((p) => p.manifest && (p.status === 'running' || p.status === 'starting'))
    .flatMap((p) => (p.manifest!.commands ?? []).map((c) => ({ id: pluginCommandId(p.manifest!.id, c.id), title: c.title, plugin: p.manifest!.id, pluginName: p.manifest!.name })))
}

export const isPluginCommand = (id: string): boolean => pluginCommands().some((c) => c.id === id)

function apply(list: PluginInfo[]): void {
  plugins = list
  const on = (p: PluginInfo): boolean => !!p.manifest && p.enabled && p.status !== 'error' && p.status !== 'off'
  const agents: AgentDef[] = list.filter(on).flatMap((p) => (p.manifest!.agents ?? []).map((a) => ({ ...a, short: a.short ?? a.kind, note: a.note ?? '', plugin: p.manifest!.id })))
  setPluginAgents(agents)
  const keys: KeyCommand[] = list
    .filter(on)
    .flatMap((p) => (p.manifest!.commands ?? []).map((c) => ({ id: pluginCommandId(p.manifest!.id, c.id), title: c.title, category: p.manifest!.name, key: c.key, when: c.when })))
  setPluginKeyCommands(keys)
  // A plugin that stopped takes its badges with it.
  const running = new Set(list.filter((p) => p.status === 'running').map((p) => p.manifest!.id))
  let dropped = false
  for (const [task, byPlugin] of badges) {
    for (const id of byPlugin.keys()) {
      if (!running.has(id)) {
        byPlugin.delete(id)
        dropped = true
      }
    }
    if (!byPlugin.size) badges.delete(task)
  }
  if (dropped) badges = new Map(badges)
  bump()
}

function nameOf(plugin: string): string {
  return plugins.find((p) => p.manifest?.id === plugin)?.manifest?.name ?? plugin
}

function onUi(e: PluginUiEvent, dispatch: (a: Action) => void, state: () => AppState): void {
  switch (e.type) {
    case 'toast':
      return dispatch({ type: 'TOAST', text: `${nameOf(e.plugin)}: ${e.text}` })
    case 'message': {
      const task = state().tasks.find((t) => t.id === e.taskId)
      if (!task) return
      return dispatch({ type: 'MESSAGE_AGENT', taskId: task.id, text: e.text, toast: `${nameOf(e.plugin)} sent a message to ${task.key}.` })
    }
    case 'createTask': {
      const s = state()
      const project = s.projects.find((p) => p.id === e.projectId)
      if (!project) return
      const key = nextTaskKey(s.tasks, project, s.keyHigh)
      return dispatch({ type: 'AGENT_ADD_TASK', key, projectId: project.id, title: e.title, desc: e.desc, col: e.col, toast: `${nameOf(e.plugin)} added ${key}: ${e.title}` })
    }
    case 'badges': {
      const byPlugin = new Map(badges.get(e.taskId) ?? [])
      if (e.badges.length) byPlugin.set(e.plugin, e.badges)
      else byPlugin.delete(e.plugin)
      // Nothing to redraw when nothing changed (plugins often set the same again).
      const before = JSON.stringify(badges.get(e.taskId)?.get(e.plugin) ?? [])
      if (before === JSON.stringify(e.badges)) return
      badges = new Map(badges)
      if (byPlugin.size) badges.set(e.taskId, byPlugin)
      else badges.delete(e.taskId)
      return bump()
    }
    case 'clearBadges': {
      let any = false
      const next = new Map<string, Map<string, PluginBadge[]>>()
      for (const [task, byPlugin] of badges) {
        const m = new Map(byPlugin)
        any = m.delete(e.plugin) || any
        if (m.size) next.set(task, m)
      }
      if (!any) return
      badges = next
      return bump()
    }
  }
}

/* The package waiting to be installed (the install dialog shows it). */
let installing: PackagePreview | null = null
const installListeners = new Set<() => void>()
const setInstalling = (p: PackagePreview | null): void => {
  // Another one replaces it: the first is let go.
  if (installing && installing.token !== p?.token) void window.api.plugins.discard(installing.token)
  installing = p
  installListeners.forEach((l) => l())
}

/** Asks to install a package (it's been looked at by the main process). */
export function askInstall(p: PackagePreview): void {
  setInstalling(p)
}
export function closeInstall(): void {
  setInstalling(null)
}
export function usePendingInstall(): PackagePreview | null {
  return useSyncExternalStore(
    (l) => {
      installListeners.add(l)
      return () => installListeners.delete(l)
    },
    () => installing
  )
}

/** At startup: the plugins as they are, then their changes and requests - and packages opened with the app. */
export function startPlugins(dispatch: (a: Action) => void, state: () => AppState): () => void {
  window.api.plugins.list().then(apply)
  const offChanged = window.api.plugins.onChanged(apply)
  const offUi = window.api.plugins.onUi((e) => onUi(e, dispatch, state))
  const opened = (p: PackagePreview | { error: string }): void => {
    if ('error' in p) return dispatch({ type: 'TOAST', text: p.error })
    dispatch({ type: 'OPEN_SETTINGS', section: 'plugins' })
    askInstall(p)
  }
  window.api.plugins.takeOpened().then((list) => list.forEach(opened))
  const offOpened = window.api.plugins.onInstallRequest(opened)
  return () => {
    offChanged()
    offUi()
    offOpened()
  }
}

/** The plugins (re-renders when they change - their agents and commands with them). */
export function usePlugins(): PluginInfo[] {
  useSyncExternalStore(subscribe, () => version)
  return plugins
}

/** The badges plugins put on a task's card, in plugin order. */
export function useTaskBadges(taskId: string): { plugin: string; badge: PluginBadge }[] {
  useSyncExternalStore(subscribe, () => version)
  const byPlugin = badges.get(taskId)
  if (!byPlugin) return []
  return [...byPlugin].flatMap(([plugin, list]) => list.map((badge) => ({ plugin: nameOf(plugin), badge })))
}

/** Runs a plugin's command for what's on screen. */
export function runPluginCommand(id: string, state: AppState, dispatch: (a: Action) => void): void {
  const taskId = state.view === 'workspace' ? state.taskId : state.view === 'board' ? state.boardFocus : null
  const projectId = (taskId && state.tasks.find((t) => t.id === taskId)?.projectId) || state.projectId
  window.api.plugins.run(id, { taskId: taskId ?? null, projectId: projectId ?? null }).catch((err: unknown) => {
    const cmd = pluginCommands().find((c) => c.id === id)
    dispatch({ type: 'TOAST', text: `${cmd?.pluginName ?? 'Plugin'}: ${err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)}` })
  })
}
