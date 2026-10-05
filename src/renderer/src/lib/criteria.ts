import type { Criterion, Task } from '@shared/types'

/** How many of the task's criteria are verified. */
export function criteriaDone(task: Pick<Task, 'criteria'>): { passed: number; failed: number; total: number } {
  const list = task.criteria ?? []
  return { passed: list.filter((c) => c.status === 'passed').length, failed: list.filter((c) => c.status === 'failed').length, total: list.length }
}

export function newCriterion(text: string): Criterion {
  return { id: `ac${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text: text.trim(), status: 'open' }
}

/** Criteria from pasted text: a line each ("- ", "1. ", "[ ] " taken off). */
export function parseCriteria(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s*/, '').trim())
    .filter(Boolean)
}

/**
 * The criteria for the agent: numbered, and how to prove them - with its
 * tools (agents that have them) or by saying so (others).
 */
export function criteriaMessage(task: Pick<Task, 'criteria'>, tools: boolean, only?: 'unverified'): string {
  const list = (task.criteria ?? []).map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => only !== 'unverified' || c.status !== 'passed')
  if (!list.length) return ''
  const items = list.map(({ c, n }) => `${n}. ${c.text}`).join(' ')
  return tools
    ? `Acceptance criteria - when you're done, verify each one and record it with the verify_criterion tool (say how you checked; attach a screenshot of the running app for anything visible): ${items}`
    : `Acceptance criteria - when you're done, check each one and say for each how you verified it: ${items}`
}
