import type { ReviewComment } from '@shared/types'
import { REPLY_ASK } from '@shared/reviewReplies'

/** By file, then line: the order a review lists its comments in. */
export function inOrder(comments: ReviewComment[]): ReviewComment[] {
  return [...comments].sort((a, b) => a.path.localeCompare(b.path) || (a.newLine ?? a.oldLine ?? 0) - (b.newLine ?? b.oldLine ?? 0))
}

/** Numbers for `count` comments about to go to the agent: after the highest the task has used. */
export function nextRefs(taskComments: ReviewComment[], count: number): number[] {
  const top = Math.max(0, ...taskComments.map((c) => c.ref ?? 0))
  return Array.from({ length: count }, (_, i) => top + i + 1)
}

/**
 * A code review as one message for the agent: each comment with its number,
 * where it is (file and lines) and the code it's about, then the overall
 * note, and how to answer. One line (agents take a message a line at a time).
 */
export function reviewMessage(comments: ReviewComment[], summary: string): string {
  const parts = inOrder(comments).map((c, i) => `[${c.ref ?? i + 1}] ${where(c)}${quote(c)}: ${flat(c.text)}`)
  const note = flat(summary)
  if (!parts.length) return note ? `Code review: ${note}` : ''
  const head = `Code review - ${parts.length} comment${parts.length === 1 ? '' : 's'}${note ? `. Overall: ${note.replace(/[.\s]+$/, '')}` : ''}. Address each one:`
  return `${head} ${parts.join(' ')} ${REPLY_ASK}`
}

/** One comment sent on its own. */
export function commentMessage(c: ReviewComment): string {
  return `Review comment [${c.ref}] on ${where(c)}${quote(c)}: ${flat(c.text)} ${REPLY_ASK}`
}

/** A follow-up in a comment's thread. */
export function followUpMessage(c: ReviewComment, text: string): string {
  return `About review comment [${c.ref}] on ${where(c)}: ${flat(text)} Answer on a line starting with [${c.ref}].`
}

/** "src/a.ts line 12", "src/a.ts lines 12-14", "src/a.ts (removed line 8)". */
export function where(c: ReviewComment): string {
  if (c.newLine != null) return c.toLine != null && c.toLine !== c.newLine ? `${c.path} lines ${c.newLine}-${c.toLine}` : `${c.path} line ${c.newLine}`
  if (c.oldLine != null) return `${c.path} (removed line ${c.oldLine})`
  return c.path
}

function quote(c: ReviewComment): string {
  const code = c.code?.trim()
  return code ? ` (\`${code.slice(0, 100)}\`)` : ''
}

function flat(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').trim()
}
