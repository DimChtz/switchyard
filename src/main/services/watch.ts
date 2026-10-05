import { watch, type FSWatcher } from 'fs'
import type { WebContents } from 'electron'
import { log } from './log'

/**
 * Live views: a watch on a task's folder tells its window which files
 * changed (an agent's edits, a git checkout), a batch every ~200 ms - so
 * the explorer, open files and the Changes tab follow along. One recursive
 * watch per folder, shared by everyone who asked for it.
 */

const SKIP = /(^|[\\/])(node_modules|\.git|\.next|\.venv|venv|__pycache__|\.turbo|\.cache|dist|out|build|coverage|target)([\\/]|$)/
// Inside .git only these say the status changed (a commit, a checkout, staging).
const GIT_STATE = /(^|[\\/])\.git[\\/](HEAD|index|refs[\\/])/

interface Watch {
  watcher: FSWatcher
  users: Map<number, WebContents>
  pending: Set<string>
  git: boolean
  timer: NodeJS.Timeout | null
}

const watches = new Map<string, Watch>()
let nextId = 1
const owners = new Map<number, string>()

function flush(root: string, w: Watch): void {
  w.timer = null
  const paths = [...w.pending].slice(0, 500)
  const git = w.git
  w.pending.clear()
  w.git = false
  for (const [, wc] of w.users) if (!wc.isDestroyed()) wc.send('fs:changed', { root, paths, git })
}

/** Starts telling `wc` about changes under `root`; returns an id for unwatch. */
export function watchFolder(wc: WebContents, root: string): number {
  const id = nextId++
  let w = watches.get(root)
  if (!w) {
    let watcher: FSWatcher
    try {
      watcher = watch(root, { recursive: true, persistent: false })
    } catch (err) {
      log.warn('watch', `Could not watch ${root}`, err)
      return 0
    }
    const made: Watch = { watcher, users: new Map(), pending: new Set(), git: false, timer: null }
    watcher.on('change', (_type, name) => {
      const rel = String(name ?? '')
      if (!rel) return
      if (GIT_STATE.test(rel)) made.git = true
      else if (SKIP.test(rel)) return
      else made.pending.add(rel.replace(/\\/g, '/'))
      made.timer ??= setTimeout(() => flush(root, made), 200)
    })
    watcher.on('error', (err) => log.warn('watch', `Watching ${root} stopped`, err))
    w = made
    watches.set(root, w)
  }
  w.users.set(id, wc)
  owners.set(id, root)
  wc.once('destroyed', () => unwatchFolder(id))
  return id
}

export function unwatchFolder(id: number): void {
  const root = owners.get(id)
  if (!root) return
  owners.delete(id)
  const w = watches.get(root)
  if (!w) return
  w.users.delete(id)
  if (w.users.size) return
  if (w.timer) clearTimeout(w.timer)
  w.watcher.close()
  watches.delete(root)
}
