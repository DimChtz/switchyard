import { app, BrowserWindow, dialog } from 'electron'
import { promises as fs, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { basename, dirname, extname, join, resolve } from 'path'
import * as notes from './notes'
import { convertNote, fileNameFor, relinkBatch, type Attach, type ImportSource } from '@shared/noteImport'
import type { NoteImportResult } from '@shared/types'

const TEXT = /\.(md|markdown|txt)$/i
// Folders an app keeps for itself, not notes: Obsidian's settings and trash, git, dependencies.
const SKIP_DIR = /^(\.|node_modules$)/
const MAX_FILES = 5000
const MAX_BYTES = 5 * 1024 * 1024
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
/** Where imported images go, in the notes folder. */
export const ATTACHMENTS = 'attachments'

/**
 * The Markdown and text files in these paths; folders are walked (an
 * Obsidian vault, a Notion export). Images found on the way are indexed by
 * name, for Obsidian's ![[image.png]].
 */
async function collect(paths: string[]): Promise<{ files: string[]; images: Map<string, string>; truncated: boolean }> {
  const files: string[] = []
  const images = new Map<string, string>()
  const walk = async (p: string, depth: number): Promise<void> => {
    if (files.length >= MAX_FILES) return
    let st
    try {
      st = await fs.stat(p)
    } catch {
      return
    }
    if (st.isDirectory()) {
      if (depth > 12) return
      const names = await fs.readdir(p).catch(() => [] as string[])
      for (const n of names.sort()) if (!SKIP_DIR.test(n)) await walk(join(p, n), depth + 1)
    } else if (TEXT.test(p) && st.size <= MAX_BYTES) files.push(p)
    else if (IMAGE.test(p) && !images.has(basename(p).toLowerCase())) images.set(basename(p).toLowerCase(), p)
  }
  for (const p of paths) await walk(p, 0)
  return { files, images, truncated: files.length >= MAX_FILES }
}

/**
 * Copies images notes show into the notes folder's attachments folder
 * (once each; the same image already there is used again), resolving with
 * their path from the notes folder.
 */
function attacher(images: Map<string, string>, copied: string[]): Attach {
  const done = new Map<string, string | null>()
  const dir = join(notes.notesDir(), ATTACHMENTS)
  return (ref, note, byName) => {
    const src = byName ? (images.get(basename(ref).toLowerCase()) ?? (note.dir ? resolve(note.dir, ref) : null)) : note.dir ? resolve(note.dir, ref) : null
    if (!src) return null
    if (done.has(src)) return done.get(src)!
    let out: string | null = null
    try {
      const st = statSync(src)
      if (st.isFile() && st.size <= MAX_IMAGE_BYTES) {
        mkdirSync(dir, { recursive: true })
        const ext = extname(src)
        const base = basename(src, ext)
        let name = `${base}${ext}`
        for (let i = 2; existsSync(join(dir, name)) && !sameFile(join(dir, name), src); i++) name = `${base}-${i}${ext}`
        if (!existsSync(join(dir, name))) {
          copyFileSync(src, join(dir, name))
          copied.push(name)
        }
        out = `${ATTACHMENTS}/${name}`
      }
    } catch {
      out = null
    }
    done.set(src, out)
    return out
  }
}

function sameFile(a: string, b: string): boolean {
  try {
    return statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b))
  } catch {
    return false
  }
}

/**
 * Imports files and folders as notes. A note that's already here (same
 * title and text) is skipped, so importing the same vault twice is safe.
 * `link` links the new notes (the task pane imports into its task) unless
 * a file says otherwise in its own front matter.
 */
export async function importPaths(paths: string[], link: { projectId: string | null; taskId: string | null } = { projectId: null, taskId: null }): Promise<NoteImportResult> {
  const { files, images, truncated } = await collect(paths)
  const failed: string[] = []
  const sources: ImportSource[] = []
  for (const f of files) {
    try {
      sources.push({ name: basename(f), raw: await fs.readFile(f, 'utf-8'), dir: dirname(f) })
    } catch {
      failed.push(basename(f))
    }
  }
  const copied: string[] = []
  const converted = relinkBatch(sources.map(convertNote), attacher(images, copied))
  const existing = new Set((await notes.list()).map((n) => key(n.body)))
  const ids: string[] = []
  let skipped = 0
  for (const n of converted) {
    if (existing.has(key(n.body))) {
      skipped++
      continue
    }
    try {
      const own = n.projectId || n.taskId
      const saved = await notes.save({ body: n.body, projectId: own ? n.projectId : link.projectId, taskId: own ? n.taskId : link.taskId, pinned: n.pinned })
      existing.add(key(n.body))
      ids.push(saved.id)
    } catch {
      failed.push(n.source)
    }
  }
  return { ids, skipped, failed, found: files.length, truncated, images: copied.length }
}

function key(body: string): string {
  return body.replace(/\r\n?/g, '\n').trim()
}

/** Asks for Markdown files, or a folder (a vault, an export), and imports them. Null when cancelled. */
export async function importPicked(win: BrowserWindow | null, kind: 'files' | 'folder', link?: { projectId: string | null; taskId: string | null }): Promise<NoteImportResult | null> {
  const opts: Electron.OpenDialogOptions =
    kind === 'files'
      ? { title: 'Import notes', buttonLabel: 'Import', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown and text', extensions: ['md', 'markdown', 'txt'] }] }
      : { title: 'Import a folder of notes', buttonLabel: 'Import', properties: ['openDirectory'] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths.length) return null
  return importPaths(res.filePaths, link)
}

/** The note as a file: its Markdown, without Switchyard's front matter. */
function exportText(body: string): string {
  const text = body.replace(/\r\n?/g, '\n')
  return text.endsWith('\n') ? text : `${text}\n`
}

/** Saves one note as a Markdown file where the user picks. Resolves with the path, or null when cancelled. */
export async function exportOne(win: BrowserWindow | null, body: string): Promise<string | null> {
  const title = notes.titleOf(body)
  const opts: Electron.SaveDialogOptions = {
    title: 'Save note as Markdown',
    defaultPath: join(app.getPath('documents'), `${fileNameFor(title)}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null
  const path = extname(res.filePath) ? res.filePath : `${res.filePath}.md`
  await fs.writeFile(path, exportText(body), 'utf-8')
  await copyAttachments(body, dirname(path))
  return path
}

/** The images a note shows from its attachments folder go along with it (not over files already there). */
async function copyAttachments(body: string, destDir: string): Promise<void> {
  const refs = new Set([...body.matchAll(/!\[[^\]]*\]\((attachments\/[^)\s]+)\)/g)].map((m) => decodeURIComponent(m[1])))
  for (const ref of refs) {
    const name = basename(ref)
    const src = join(notes.notesDir(), ATTACHMENTS, name)
    const dest = join(destDir, ATTACHMENTS, name)
    if (!existsSync(src) || existsSync(dest)) continue
    await fs.mkdir(dirname(dest), { recursive: true })
    await fs.copyFile(src, dest).catch(() => {})
  }
}

/**
 * Saves notes into a folder the user picks, one "Title.md" each - named
 * after their titles, so [[links]] between them keep working in Obsidian.
 * Files already there are never overwritten ("Title 2.md").
 */
export async function exportMany(win: BrowserWindow | null, ids: string[]): Promise<{ dir: string; count: number } | null> {
  const opts: Electron.OpenDialogOptions = { title: 'Export notes to a folder', buttonLabel: 'Export here', properties: ['openDirectory', 'createDirectory'] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths.length) return null
  const dir = res.filePaths[0]
  const want = new Set(ids)
  const all = (await notes.list()).filter((n) => want.has(n.id))
  let count = 0
  for (const n of all) {
    const base = fileNameFor(n.title)
    let name = `${base}.md`
    for (let i = 2; await exists(join(dir, name)); i++) name = `${base} ${i}.md`
    await fs.writeFile(join(dir, name), exportText(n.body), { encoding: 'utf-8', flag: 'wx' })
    await copyAttachments(n.body, dir)
    count++
  }
  return { dir, count }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
