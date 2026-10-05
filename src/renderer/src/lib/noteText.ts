import type { Note, Project, Task } from '@shared/types'

/* ---------- the note as the editor shows it: a title, then the text ---------- */

/**
 * A note is one Markdown file; its first line, when it's a "# " heading, is
 * the title the editor shows in its own field, and the rest is the text.
 */
export function splitNote(body: string): { title: string; text: string } {
  const m = body.match(/^\s*# +(.*?)[ \t]*(\r?\n|$)/)
  if (!m) return { title: '', text: body }
  return { title: m[1], text: body.slice(m[0].length).replace(/^(\r?\n)+/, '') }
}

/** The file's text for a title and text (no title: just the text). */
export function joinNote(title: string, text: string): string {
  const t = title.trim()
  if (!t) return text
  return text ? `# ${t}\n\n${text}` : `# ${t}\n`
}

/** The title shown for a note ("" when it has none: "Untitled"). */
export function noteTitle(note: Note): string {
  return splitNote(note.body).title.trim()
}

/**
 * A [[link]]'s parts, Obsidian's forms included: [[Note]], [[Note|shown
 * text]], [[Note#Heading]]. `target` is the note's title.
 */
export function wikiLink(inner: string): { target: string; label: string } {
  const [ref, alias] = inner.split('|', 2)
  const [target, anchor] = ref.split('#', 2)
  const t = target.trim()
  return { target: t, label: alias?.trim() || (anchor ? `${t} › ${anchor.trim()}` : t) }
}

/** Whether the text links to the note titled so ([[title]], [[title|…]], [[title#…]]). */
export function linksTo(body: string, title: string): boolean {
  const t = title.trim().toLowerCase()
  if (!t) return false
  for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) if (wikiLink(m[1]).target.toLowerCase() === t) return true
  return false
}

/** The text without Markdown marks, for list snippets and search hits. */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => wikiLink(inner).label)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*]\s\[[ xX]\]\s?/gm, '')
    // Tables: their cells, not their pipes and dashes.
    .replace(/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/gm, ' ')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/[#*`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type CellAlign = 'left' | 'center' | 'right' | null

/** A table row's cells: "| a | b |" → ["a", "b"] (a "\|" stays in its cell). */
export function tableCells(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

/** "| --- | :-: |": the line under a table's header. */
export function isTableDelimiter(line: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('-')
}

/** A GFM table's lines (header, delimiter, rows) as cells; null when they aren't one. */
export function parseTable(lines: string[]): { head: string[]; align: CellAlign[]; rows: string[][] } | null {
  if (lines.length < 2 || !lines[0].includes('|') || !isTableDelimiter(lines[1])) return null
  const head = tableCells(lines[0])
  const align = tableCells(lines[1]).map((d): CellAlign => (d.startsWith(':') && d.endsWith(':') ? 'center' : d.endsWith(':') ? 'right' : d.startsWith(':') ? 'left' : null))
  const rows = lines.slice(2).map((l) => {
    const cells = tableCells(l)
    return head.map((_, i) => cells[i] ?? '')
  })
  return { head, align, rows }
}

/** What a note is linked to, as its chip says it: a task, a project, or nothing. */
export function linkOf(note: Note, tasks: Task[], projects: Project[]): { label: string; color: string } {
  if (note.taskId) {
    const t = tasks.find((x) => x.id === note.taskId)
    return { label: t ? `${t.key} · ${t.title}` : note.taskId, color: 'var(--c-blue)' }
  }
  if (note.projectId) return { label: projects.find((p) => p.id === note.projectId)?.name ?? note.projectId, color: 'var(--t2)' }
  return { label: 'Personal', color: 'var(--t3)' }
}

/** "now", "5m", "3h", "2d". */
export function ago(ts: number, now = Date.now()): string {
  const d = now - ts
  if (d < 60_000) return 'now'
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m`
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h`
  return `${Math.round(d / 86_400_000)}d`
}
