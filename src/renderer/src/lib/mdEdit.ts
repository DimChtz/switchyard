/**
 * Markdown edits around a selection, for the formatting bars and keys of
 * the notes and task-description editors. Each takes the text and the
 * selection (a..b) and gives back the new text and selection.
 */
export type MdEdit = (v: string, a: number, b: number) => [string, number, number]

// A line's Markdown block marker, after its indentation.
const BLOCK_MARK = /^(\s*)(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )?/

/** "**" + selection + "**" (the placeholder, selected, when nothing is). */
export function wrapWith(l: string, r: string, placeholder: string): MdEdit {
  return (v, a, b) => {
    const mid = v.slice(a, b) || placeholder
    return [v.slice(0, a) + l + mid + r + v.slice(b), a + l.length, a + l.length + mid.length]
  }
}

/**
 * A line's kind (heading, list, checklist, quote): swaps it for `pre`'s, or
 * takes `pre`'s off again - on every selected line, keeping indentation.
 */
export function prefixLines(pre: string): MdEdit {
  return (v, a, b) => {
    const start = v.lastIndexOf('\n', a - 1) + 1
    const nl = v.indexOf('\n', b)
    const end = nl < 0 ? v.length : nl
    const lines = v.slice(start, end).split('\n')
    const kind = (p: string): string => (p.startsWith('#') ? '#' : /\[[ xX]\]/.test(p) ? '[]' : p.startsWith('>') ? '>' : /^\d/.test(p) ? '1' : p ? '-' : '')
    const marks = lines.map((l) => BLOCK_MARK.exec(l)!)
    const used = lines.map((l, i) => lines.length === 1 || l.trim() !== '' || !!marks[i][2])
    const off = marks.every((m, i) => !used[i] || kind(m[2] ?? '') === kind(pre))
    const out = lines.map((l, i) => (used[i] ? marks[i][1] + (off ? '' : pre) + l.slice(marks[i][0].length) : l))
    const text = out.join('\n')
    const next = v.slice(0, start) + text + v.slice(end)
    if (lines.length > 1) return [next, start, start + text.length]
    const oldEnd = start + marks[0][0].length
    const newEnd = start + marks[0][1].length + (off ? 0 : pre.length)
    const d = newEnd - oldEnd
    const at = (x: number): number => (x >= oldEnd ? x + d : newEnd)
    return [next, at(a), at(b)]
  }
}

/** Two spaces in place of the selection (Tab). */
export const indent: MdEdit = (v, a, b) => [v.slice(0, a) + '  ' + v.slice(b), a + 2, a + 2]

/** The smallest change that turns `old` into `next`: [from, to, insert] - so undo and the cursor behave. */
export function minimalChange(old: string, next: string): [number, number, string] {
  let p = 0
  while (p < old.length && p < next.length && old[p] === next[p]) p++
  let q = 0
  while (q < old.length - p && q < next.length - p && old[old.length - 1 - q] === next[next.length - 1 - q]) q++
  return [p, old.length - q, next.slice(p, next.length - q)]
}

/** The "- [ ]" items of a Markdown text (outside code blocks), in order. */
export function checklistItems(text: string): { text: string; done: boolean }[] {
  const out: { text: string; done: boolean }[] = []
  let fence = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    const m = /^\s*[-*+] \[([ xX])\]\s+(.+?)\s*$/.exec(line)
    if (m) out.push({ text: m[2], done: m[1] !== ' ' })
  }
  return out
}
