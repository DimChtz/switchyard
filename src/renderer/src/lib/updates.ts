import { useSyncExternalStore } from 'react'
import type { UpdateState } from '@shared/types'
import { addNotice } from './notices'
import { confirm } from '../components/ui'

/**
 * A new version of Switchyard, as the main process found it: downloaded and
 * ready to install, or out to download by hand. It stays in the status bar
 * until Switchyard restarts; the bell keeps a note of it, and the system
 * says so when the window isn't in front.
 */
let state: UpdateState | null = null
const listeners = new Set<() => void>()

function set(next: UpdateState | null): void {
  if (!next || (state?.kind === next.kind && state.version === next.version)) return
  state = next
  listeners.forEach((l) => l())
  announce(next).catch(() => {})
}

/** Once per version (and kind): a note in the bell, and the system's notification while the window isn't in front. */
async function announce(u: UpdateState): Promise<void> {
  const text = u.kind === 'ready' ? `Switchyard ${u.version} is ready to install` : `Switchyard ${u.version} is out`
  const said = (await window.api.store.getNotices().catch(() => [])).some((n) => n.kind === 'update' && n.text === text)
  if (said || announced.has(text)) return
  announced.add(text)
  addNotice({
    kind: 'update',
    taskId: '',
    taskKey: '',
    taskTitle: '',
    projectId: '',
    text,
    detail: u.kind === 'ready' ? 'Restart to install it now, or it installs when you quit.' : 'Download it from its release page - this build can’t install updates itself.'
  })
  if (!document.hasFocus())
    window.api.sys.notify(u.kind === 'ready' ? 'Switchyard update ready' : 'Switchyard update out', u.kind === 'ready' ? `${u.version} installs when you quit - or restart now.` : `${u.version} is on its release page.`, null)
}
const announced = new Set<string>()

let started = false
/** Follows the main process's updates (once; AppStore). */
export function startUpdateWatch(): () => void {
  if (started) return () => {}
  started = true
  window.api.updates
    .status()
    .then((s) => set(s))
    .catch(() => {})
  const off = window.api.updates.onState((s) => set(s))
  return () => {
    started = false
    off()
  }
}

export function useUpdate(): UpdateState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

/** The update's action: restart and install it (after asking), or open its release page. */
export async function actOnUpdate(u: UpdateState): Promise<void> {
  if (u.kind === 'available') return window.api.sys.openExternal(u.url)
  const ok = await confirm({
    title: `Restart and install Switchyard ${u.version}?`,
    body: 'Switchyard quits, installs the update and opens again. Running agents stop - their worktrees stay, and you can resume them.',
    confirmLabel: 'Restart now',
    cancelLabel: 'Later'
  })
  if (ok) await window.api.updates.install()
}

