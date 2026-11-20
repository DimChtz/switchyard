import type { MdEdit } from './mdEdit'

/**
 * Files put into Markdown (a task's description, a note) that aren't
 * pictures - a PDF, a log, a CSV, a zip: kept as a copy (see the main
 * process's attachments) and linked as `[name](path)`. A click on the link
 * opens it; an agent is told where it is.
 */

/** A file to keep: on disk (its path), or pasted without one (its data). */
export interface FileSource {
  name: string
  path: string | null
  dataUrl: string | null
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const isImage = (f: File): boolean => f.type.startsWith('image/') || IMAGE_FILE.test(f.name)

/** A paste's, a drop's or a picker's files: the pictures (shown in place) and the rest (linked). */
export function splitFiles(files: FileList | File[]): { images: File[]; others: File[] } {
  const all = [...files]
  return { images: all.filter(isImage), others: all.filter((f) => !isImage(f)) }
}

/** Files read for keeping: a file on disk by its path (copied there, never read here); a pasted one by its data. */
export function readFiles(files: File[]): Promise<FileSource[]> {
  return Promise.all(
    files.map(async (f) => {
      const path = window.api.fs.pathForFile(f) || null
      if (path) return { name: f.name || path.split(/[\\/]/).pop() || 'file', path, dataUrl: null }
      const dataUrl = await new Promise<string>((ok, no) => {
        const r = new FileReader()
        r.onload = () => ok(String(r.result))
        r.onerror = () => no(r.error)
        r.readAsDataURL(f)
      })
      return { name: f.name || 'pasted', path: null, dataUrl }
    })
  )
}

/** A link's text: the file's name, without what would end the link early. */
const linkText = (name: string): string => name.replace(/[[\]\n]/g, '') || 'file'

/** The Markdown for attached files (`refs`: where each is kept), on a line of their own - the cursor after them. */
export function filesEdit(sources: FileSource[], refs: string[]): MdEdit {
  const md = refs.map((ref, i) => `[${linkText(sources[i].name)}](${encodeURI(ref)})`).join('\n')
  return (v, a, b) => {
    const before = a > 0 && v[a - 1] !== '\n' ? '\n' : ''
    const after = v[b] === '\n' ? '' : '\n'
    const ins = `${before}${md}${after}`
    const at = a + before.length + md.length + 1
    return [v.slice(0, a) + ins + v.slice(b), at, at]
  }
}

/** Whether a link in Markdown is a web address (opened in the browser) rather than a file. */
export const isWebLink = (url: string): boolean => /^(https?:|mailto:)/i.test(url)
