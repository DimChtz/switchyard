import { app, BrowserWindow, shell } from 'electron'
import { promises as fs, watch, type FSWatcher } from 'fs'
import { isAbsolute, join } from 'path'
import { getPrefs } from './store'
import { expandPath } from './repos'
import type { Note, NoteDraft } from '@shared/types'

/**
 * Notes are plain Markdown files in one folder (Settings → General), so
 * they can be read, grepped, synced or edited anywhere else too. What
 * Switchyard adds - the project and task a note belongs to, pinning - is a
 * small front matter block at the top:
 *
 *   ---
 *   project: flipflop
 *   task: FF-12
 *   pinned: true
 *   ---
 *   # The title
 *   …
 */

export function notesDir(): string {
  const pref = getPrefs().notesDir
  if (pref) return expandPath(pref)
  // A copy run with its own data folder (development, tests) keeps its notes there too - never the real ones.
  if (!app.isPackaged && process.env['SWITCHYARD_USER_DATA']) return join(app.getPath('userData'), 'notes')
  return join(app.getPath('documents'), 'Switchyard Notes')
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function parse(id: string, raw: string, mtime: number, file: string, birth = 0): Note {
  const meta: Record<string, string> = {}
  let body = raw
  const m = raw.match(FRONT)
  if (m) {
    body = raw.slice(m[0].length)
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*(.*)$/)
      if (kv) meta[kv[1]] = kv[2].trim()
    }
  }
  return {
    id,
    title: titleOf(body),
    body,
    projectId: meta.project || null,
    taskId: meta.task || null,
    pinned: meta.pinned === 'true',
    createdAt: birth || mtime,
    updatedAt: mtime,
    file
  }
}

/** The first heading, else the first line, else "Untitled" (a bare "#" isn't a title yet). */
export function titleOf(body: string): string {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}$/.test(l))
  const heading = lines.find((l) => /^#{1,6}\s/.test(l))
  const t = (heading ?? lines[0] ?? '').replace(/^#{1,6}\s+/, '').replace(/[*_`]/g, '').trim()
  return t.slice(0, 120) || 'Untitled'
}

/** The file's text. A note with no project, task or pin stays a plain Markdown file. */
function serialize(n: { body: string; projectId: string | null; taskId: string | null; pinned: boolean }): string {
  const meta = [n.projectId ? `project: ${n.projectId}` : null, n.taskId ? `task: ${n.taskId}` : null, n.pinned ? 'pinned: true' : null].filter(Boolean)
  return meta.length ? `---\n${meta.join('\n')}\n---\n${n.body}` : n.body
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export async function list(): Promise<Note[]> {
  const dir = notesDir()
  let names: string[]
  try {
    names = (await fs.readdir(dir)).filter((n) => n.toLowerCase().endsWith('.md'))
  } catch {
    return [] // no folder yet - made on the first save
  }
  const notes = await Promise.all(
    names.map(async (name) => {
      const file = join(dir, name)
      try {
        const [raw, st] = await Promise.all([fs.readFile(file, 'utf-8'), fs.stat(file)])
        return parse(name.slice(0, -3), raw, st.mtimeMs, file, st.birthtimeMs)
      } catch {
        return null
      }
    })
  )
  return notes.filter((n): n is Note => n !== null)
}

/**
 * Creates (no id) or updates a note. A new note's file is named after its
 * title; it keeps that name when the title changes later.
 */
export async function save(draft: NoteDraft): Promise<Note> {
  const dir = notesDir()
  await fs.mkdir(dir, { recursive: true })
  // A save that was on its way under a note's old name goes to its new file.
  let id = draft.id ? (renamed.get(draft.id) ?? draft.id) : undefined
  const title = titleOf(draft.body)
  const titleSlug = title === 'Untitled' ? '' : slug(title)
  if (!id) {
    id = await freeName(dir, titleSlug || 'note')
  } else if (draft.nameFromTitle && /^note(-\d+)?$/.test(id) && titleSlug && (await exists(join(dir, `${id}.md`)))) {
    // Made before it had a title: take the title's name now.
    const to = await freeName(dir, titleSlug)
    const from = join(dir, `${id}.md`)
    selfWrites.set(from, Date.now())
    await fs.rename(from, join(dir, `${to}.md`))
    renamed.set(id, to)
    id = to
  }
  const file = join(dir, `${id}.md`)
  selfWrites.set(file, Date.now())
  await fs.writeFile(file, serialize(draft), 'utf-8')
  const st = await fs.stat(file)
  return parse(id, await fs.readFile(file, 'utf-8'), st.mtimeMs, file, st.birthtimeMs)
}

// Old name → new name, for saves still under the old one.
const renamed = new Map<string, string>()

// A name that was renamed away is never handed out again: saves under it
// still go to the renamed file, and would land in another note's file.
async function freeName(dir: string, base: string): Promise<string> {
  let id = base
  for (let i = 2; renamed.has(id) || (await exists(join(dir, `${id}.md`))); i++) id = `${base}-${i}`
  return id
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Moves the note's file to the system trash (it can be restored from there). */
export async function remove(id: string): Promise<void> {
  const file = join(notesDir(), `${renamed.get(id) ?? id}.md`)
  if (!(await exists(file))) return // already gone
  selfWrites.set(file, Date.now())
  await shell.trashItem(file)
}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' }

/**
 * An image a note shows (![alt](path)), as a data: URL - a path on disk, or
 * one relative to the notes folder. Null when it isn't a readable image
 * (or is over 15 MB).
 */
export async function imageData(ref: string): Promise<string | null> {
  let p = ref.trim().replace(/^<|>$/g, '')
  try {
    p = decodeURIComponent(p)
  } catch {
    // not %-encoded
  }
  p = p.replace(/^file:\/\/\/?/i, '')
  const type = IMAGE_TYPES[p.split('.').pop()?.toLowerCase() ?? '']
  if (!type || /^[a-z][\w+.-]*:\/\//i.test(p)) return null
  const file = isAbsolute(p) ? p : join(notesDir(), p)
  try {
    const st = await fs.stat(file)
    if (!st.isFile() || st.size > 15 * 1024 * 1024) return null
    return `data:${type};base64,${(await fs.readFile(file)).toString('base64')}`
  } catch {
    return null
  }
}

// Edits made outside the app (another editor, a sync client) show up live.
let watcher: FSWatcher | null = null
let watchedDir = ''
// Files we just wrote: their change events (often several per write) are ours.
const selfWrites = new Map<string, number>()
let timer: NodeJS.Timeout | null = null

export function watchNotes(): void {
  const dir = notesDir()
  if (watcher && watchedDir === dir) return
  watcher?.close()
  watcher = null
  watchedDir = dir
  fs.mkdir(dir, { recursive: true })
    .then(() => {
      watcher = watch(dir, (_ev, name) => {
        if (!name || !name.toLowerCase().endsWith('.md')) return
        const file = join(dir, name)
        // Our own saves are already known to the page.
        if (Date.now() - (selfWrites.get(file) ?? 0) < 1500) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          for (const w of BrowserWindow.getAllWindows()) w.webContents.send('notes:changed')
        }, 300)
      })
      watcher.on('error', () => {})
    })
    .catch(() => {})
}
