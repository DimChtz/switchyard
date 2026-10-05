/**
 * The question an agent's turn ended on - its last line ends with "?" - or
 * null when it just finished. (Claude Code's Stop hook gives the turn's
 * last message: a question there means it wants an answer, not a review.)
 */
export function closingQuestion(said: string | null | undefined): string | null {
  const lines = (said ?? '')
    .split('\n')
    .map((l) => l.replace(/[*_`#>]+/g, '').trim())
    .filter(Boolean)
  const last = lines[lines.length - 1]
  if (!last || !/\?\s*$/.test(last)) return null
  // The sentence that is the question (the paragraph can say more before it).
  const sentence = (last.split(/(?<=[.!])\s+/).pop() ?? last).replace(/\s+/g, ' ')
  return sentence.length > 240 ? sentence.slice(0, 239) + '…' : sentence
}
