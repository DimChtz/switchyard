import { describe, expect, it } from 'vitest'
import { criteriaDone, criteriaMessage, parseCriteria } from './criteria'
import type { Criterion } from '@shared/types'

const c = (text: string, status: Criterion['status'] = 'open'): Criterion => ({ id: text, text, status })

describe('acceptance criteria', () => {
  it('takes pasted lists a line each', () => {
    expect(parseCriteria('- The button is disabled while saving\n2. Empty state shows\n[ ] Works on phones\n\n  ')).toEqual(['The button is disabled while saving', 'Empty state shows', 'Works on phones'])
  })

  it('counts, and asks the agent to prove the ones not verified', () => {
    const task = { criteria: [c('Saves', 'passed'), c('Undo works', 'failed'), c('No console errors')] }
    expect(criteriaDone(task)).toEqual({ passed: 1, failed: 1, total: 3 })
    expect(criteriaMessage(task, true, 'unverified')).toBe(
      "Acceptance criteria - when you're done, verify each one and record it with the verify_criterion tool (say how you checked; attach a screenshot of the running app for anything visible): 2. Undo works 3. No console errors"
    )
    expect(criteriaMessage(task, false)).toContain('say for each how you verified it: 1. Saves 2. Undo works 3. No console errors')
    expect(criteriaMessage({ criteria: [] }, true)).toBe('')
  })
})
