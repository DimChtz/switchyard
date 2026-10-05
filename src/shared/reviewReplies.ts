/**
 * The agent's answers to review comments. A review asks it to start a line
 * for each comment with the comment's number ("[3] Renamed it."); its
 * message after the turn is read for those. Numbers it wasn't asked about
 * (a footnote, a list) are left alone.
 */

// A line starting with the number: "[3]", "**[3]**", "- [3]:", "> [3] -".
const MARK = /(^|\n)[ \t]*(?:[-*>][ \t]*)?(?:\*\*)?\[(\d{1,4})\](?:\*\*)?[ \t]*(?:[:.–—-][ \t]*)?/g
const MAX = 2000

/** The reply to each of `refs` found in the message, by number. */
export function parseReplies(message: string, refs: number[]): Map<number, string> {
  const wanted = new Set(refs)
  const marks: { ref: number; start: number; end: number }[] = []
  for (const m of message.matchAll(MARK)) {
    const ref = Number(m[2])
    const start = m.index! + m[1].length
    marks.push({ ref, start, end: m.index! + m[0].length })
  }
  const out = new Map<number, string>()
  marks.forEach((m, i) => {
    if (!wanted.has(m.ref) || out.has(m.ref)) return
    let text = message.slice(m.end, marks[i + 1]?.start ?? message.length)
    // After the last one, what follows a blank line is the rest of its message.
    if (i === marks.length - 1) text = text.split(/\n[ \t]*\n/)[0]
    text = text.trim()
    if (text) out.set(m.ref, text.length > MAX ? text.slice(0, MAX - 1) + '…' : text)
  })
  return out
}

/** How the agent is asked to answer (the end of every message with numbered comments). */
export const REPLY_ASK = 'When you are done, answer each on its own line starting with its number, like "[1] Fixed - …".'
