import { app, shell } from 'electron'
import { constants as fsc, promises as fs } from 'fs'
import { basename, extname, isAbsolute, join } from 'path'

/**
 * Files put into a task's description or a note (a PDF, a log, a CSV, a
 * zip - anything, not only images): copied into a folder Switchyard keeps,
 * so the link keeps working after the original moves, and an agent can be
 * told where to open it.
 *
 *  - A task's: the data folder's attachments (where pasted images go too).
 *  - A note's: the notes folder's attachments, so it travels with the notes.
 */

/** Over this a file isn't copied (a disk image, a video): link to it where it is instead. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024

/** The data folder's attachments: pasted images and files for agents. */
export function dataAttachmentsDir(): string {
  return join(app.getPath('userData'), 'attachments')
}

/** A file to keep: one on disk (copied) or a pasted one's data (a data: URL). */
export interface FileSource {
  path?: string | null
  dataUrl?: string | null
  name?: string | null
}

/** A name that is safe as a file name everywhere (and in a Markdown link). */
export function safeName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|#%()[\]\s]+/g, '-')
      .replace(/-+(\.[^.]*)$/, '$1')
      .replace(/^[-.]+|-+$/g, '') || 'file'
  )
}

/**
 * Copies a file into `dir` under its own name ("report.pdf", then
 * "report-2.pdf" - nothing already there is replaced). Resolves with the
 * name it got.
 */
export async function keepFile(dir: string, from: FileSource): Promise<string> {
  let data: Buffer | null = null
  let name: string
  if (from.path) {
    const st = await fs.stat(from.path)
    if (st.isDirectory()) throw new Error(`${basename(from.path)} is a folder - attach the files in it, or zip it.`)
    if (st.size > MAX_FILE_BYTES) throw new Error(`${basename(from.path)} is over ${MAX_FILE_BYTES / 1024 / 1024} MB - link to it where it is instead.`)
    name = from.name || basename(from.path)
  } else {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(from.dataUrl ?? '')
    if (!m) throw new Error('Nothing to attach.')
    data = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
    if (data.length > MAX_FILE_BYTES) throw new Error(`That file is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
    name = from.name || 'pasted'
  }
  await fs.mkdir(dir, { recursive: true })
  const safe = safeName(name)
  const ext = extname(safe)
  const stem = ext ? safe.slice(0, -ext.length) : safe
  for (let i = 1; ; i++) {
    const file = i === 1 ? safe : `${stem}-${i}${ext}`
    const to = join(dir, file)
    try {
      if (data) await fs.writeFile(to, data, { flag: 'wx' })
      else await fs.copyFile(from.path!, to, fsc.COPYFILE_EXCL)
      return file
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || i > 500) throw err
    }
  }
}

/** A file for a task's description: kept in the data folder's attachments; its full path. */
export async function addTaskFile(from: FileSource): Promise<string> {
  const dir = dataAttachmentsDir()
  return join(dir, await keepFile(dir, from))
}

/**
 * The file a link in Markdown names: a path on disk (%-encoded, or a file:
 * link), or one relative to `base` (the notes folder). Null for a web
 * address, a note link or an anchor.
 */
export function linkedFile(ref: string, base: string): string | null {
  let p = ref.trim().replace(/^<|>$/g, '')
  try {
    p = decodeURIComponent(p)
  } catch {
    // not %-encoded
  }
  if (!p || p.startsWith('#')) return null
  if (/^[a-z][\w+.-]*:/i.test(p) && !/^file:/i.test(p) && !/^[a-z]:[\\/]/i.test(p)) return null
  p = p.replace(/^file:\/\//i, '')
  // (file:///C:/x → C:/x on Windows; file:///Users/x stays /Users/x.)
  if (/^\/[a-z]:[\\/]/i.test(p)) p = p.slice(1)
  return isAbsolute(p) ? p : join(base, p)
}

// What opening would run rather than show: these are shown in their folder instead.
const RUNS = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|lnk|reg|hta|cpl|jar|sh|command|app|appimage|run|desktop)$/i

/**
 * Opens a linked file with the app it belongs to. A program or script is
 * never started from a link - its folder opens with it selected.
 */
export async function openLinked(ref: string, base: string): Promise<void> {
  const file = linkedFile(ref, base)
  if (!file) throw new Error('That link isn’t a file.')
  try {
    await fs.access(file)
  } catch {
    throw new Error(`${basename(file)} isn’t there any more (${file}).`)
  }
  if (RUNS.test(file)) return shell.showItemInFolder(file)
  const err = await shell.openPath(file)
  if (err) throw new Error(err)
}
