/**
 * Turning Markdown from elsewhere - loose files, an Obsidian vault, a Notion
 * or Bear export - into Switchyard notes, and notes back into files.
 * Pure: the file reading and writing is in main's notesTransfer.
 */

/** A file to import: its name (no folder) and text. */
export interface ImportSource {
  name: string
  raw: string
  /** The folder it was in (images it shows are found from there). */
  dir?: string
}

/** A converted note, before it's saved. */
export interface ImportedNote {
  /** The name the other app knew it by (Obsidian links point at file names). */
  source: string
  title: string
  body: string
  projectId: string | null
  taskId: string | null
  pinned: boolean
  /** The folder the file was in. */
  dir?: string
}

/**
 * Brings an image a note shows into the notes folder: resolves with its
 * new path (relative to the notes folder), or null when it isn't there.
 * `ref` is a file name (Obsidian's ![[name]]) or a path relative to the note.
 */
export type Attach = (ref: string, note: ImportedNote, byName: boolean) => string | null

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i

const FRONT = /^---\n([\s\S]*?)\n---[ \t]*(\n|$)/
// Notion names its pages "Title 0123456789abcdef0123456789abcdef.md".
const NOTION_ID = /\s+[0-9a-f]{32}$/i

/** The title a file name stands for: no extension, no Notion page id. */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.(md|markdown|txt)$/i, '')
  return base.replace(NOTION_ID, '').trim() || 'Untitled'
}

/** A front matter block's keys: plain values, and lists (inline "[a, b]" or "- a" lines). */
export function parseFrontMatter(block: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  let listKey: string | null = null
  for (const line of block.split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line)
    if (item && listKey) {
      const prev = out[listKey]
      out[listKey] = [...(Array.isArray(prev) ? prev : []), unquote(item[1])]
      continue
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const [, key, value] = kv
    listKey = value.trim() ? null : key
    if (!value.trim()) out[key] = []
    else if (/^\[.*\]$/.test(value.trim())) out[key] = value.trim().slice(1, -1).split(',').map(unquote).filter(Boolean)
    else out[key] = unquote(value)
  }
  return out
}

function unquote(s: string): string {
  return s.trim().replace(/^(['"])(.*)\1$/, '$2')
}

function list(v: string | string[] | undefined): string[] {
  if (!v) return []
  return (Array.isArray(v) ? v : v.split(/[,\s]+/)).map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
}

/**
 * One file as a note. The title is its first "# " heading, or else the file
 * name (as Obsidian and Notion show it). Front matter goes - but its tags
 * are kept as a "Tags:" line, and Switchyard's own (project, task, pinned)
 * are kept as the note's links. Links to other Markdown files become
 * [[note links]].
 */
export function convertNote(src: ImportSource): ImportedNote {
  let text = src.raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  let meta: Record<string, string | string[]> = {}
  const fm = FRONT.exec(text)
  if (fm) {
    meta = parseFrontMatter(fm[1])
    text = text.slice(fm[0].length)
  }
  const one = (k: string): string | null => {
    const v = meta[k]
    return typeof v === 'string' && v ? v : null
  }
  const fileTitle = titleFromFileName(src.name)
  text = text.replace(/^\n+/, '').replace(/\s+$/, '')
  const heading = /^# +(.*?)[ \t]*(\n|$)/.exec(text)
  const title = heading ? heading[1].trim() : fileTitle
  let rest = heading ? text.slice(heading[0].length).replace(/^\n+/, '') : text
  const tags = [...new Set([...list(meta.tags), ...list(meta.tag)])]
  if (tags.length) rest = `Tags: ${tags.map((t) => `#${t.replace(/\s+/g, '-')}`).join(' ')}${rest ? `\n\n${rest}` : ''}`
  rest = markdownLinksToNotes(rest)
  return {
    source: fileTitle,
    title,
    body: rest ? `# ${title}\n\n${rest}\n` : `# ${title}\n`,
    projectId: one('project'),
    taskId: one('task'),
    pinned: one('pinned') === 'true',
    ...(src.dir ? { dir: src.dir } : {})
  }
}

/** [text](Other%20Page%20<id>.md) - a link to another file of the export - as [[Other Page|text]]. */
function markdownLinksToNotes(text: string): string {
  return text.replace(/(!?)\[([^\]]*)\]\(<?((?![a-z][\w+.-]*:)[^)>]+?\.md)(#[^)>]*)?>?\)/gi, (whole, bang: string, label: string, target: string) => {
    if (bang) return whole
    let file = target
    try {
      file = decodeURIComponent(target)
    } catch {
      // not %-encoded
    }
    const name = titleFromFileName(file.split(/[\\/]/).pop() ?? file)
    return label && label !== name ? `[[${name}|${label}]]` : `[[${name}]]`
  })
}

/**
 * After a batch is converted: [[links]] that name a file whose note got a
 * different title (its heading) now name that title. Embedded notes
 * (![[Note]]) become links. Images (![[diagram.png]], ![alt](img/a.png))
 * are brought along by `attach` and shown; other embedded files, or images
 * that can't be found, become a mention.
 */
export function relinkBatch(notes: ImportedNote[], attach?: Attach): ImportedNote[] {
  const byName = new Map<string, string>()
  for (const n of notes) {
    byName.set(n.source.toLowerCase(), n.title)
    byName.set(n.title.toLowerCase(), n.title)
  }
  return notes.map((n) => {
    const body = n.body
      // Markdown images with a path relative to the note (Notion puts them in a folder beside it).
      .replace(/!\[([^\]]*)\]\(<?((?![a-z][\w+.-]*:)[^)>]+?)>?\)/gi, (whole, alt: string, ref: string) => {
        if (!IMAGE.test(ref)) return whole
        let file = ref
        try {
          file = decodeURIComponent(ref)
        } catch {
          // not %-encoded
        }
        const path = attach?.(file, n, false)
        return path ? `![${alt}](${encodePath(path)})` : whole
      })
      .replace(/(!?)\[\[([^\]|#]*)(#[^\]|]*)?(\|[^\]]*)?\]\]/g, (_w, bang: string, target: string, anchor = '', alias = '') => {
        const t = target.trim()
        if (bang && /\.(?!md$)[a-z0-9]{2,5}$/i.test(t)) {
          const path = IMAGE.test(t) ? attach?.(t, n, true) : null
          return path ? `![${alias.slice(1) || t.split('/').pop()}](${encodePath(path)})` : `*(attachment: ${t})*`
        }
        const to = byName.get(t.replace(/\.md$/i, '').toLowerCase()) ?? t
        return `[[${to}${anchor}${alias}]]`
      })
    return { ...n, body }
  })
}

/** A path in a Markdown link: spaces and parentheses escaped. */
function encodePath(p: string): string {
  return p.replace(/[ ()]/g, (c) => encodeURIComponent(c))
}

/** A note's title as a file name that works on Windows, macOS and Linux. */
export function fileNameFor(title: string): string {
  const name = title
    // eslint-disable-next-line no-control-regex -- control characters can't be in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 100)
    .trim()
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) || !name ? `${name || 'Untitled'} note` : name
}
