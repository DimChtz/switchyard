import { describe, expect, it } from 'vitest'
import { BUILTIN_VIEWS, NO_FILTER, filterCount, isFiltering, lanesOf, matchesFilter, parseBoardPrefs, sameFilters, serializeBoardPrefs, statusOf, viewOf } from './boardFilter'
import type { Task } from '@shared/types'

const task = (o: Partial<Task>): Task => ({ id: 'W-1', key: 'W-1', projectId: 'web', title: 'Fix the login page', desc: 'OAuth redirect', branch: 'feature/login', agentKind: 'claude', st: null, ...o }) as Task
const none = { cost: 0, openReview: false }

describe('board filter', () => {
  it('searches key, title, description and branch - every word', () => {
    const t = task({})
    expect(matchesFilter(t, { ...NO_FILTER, query: 'login oauth' }, none)).toBe(true)
    expect(matchesFilter(t, { ...NO_FILTER, query: 'w-1' }, none)).toBe(true)
    expect(matchesFilter(t, { ...NO_FILTER, query: 'login signup' }, none)).toBe(false)
  })

  it('agents and statuses are alternatives; kinds combine', () => {
    const f = { ...NO_FILTER, agents: ['codex', 'none'], status: ['needs' as const] }
    expect(matchesFilter(task({ agentKind: null, st: 'waiting' }), f, none)).toBe(true)
    expect(matchesFilter(task({ agentKind: 'claude', st: 'waiting' }), f, none)).toBe(false)
    expect(matchesFilter(task({ agentKind: 'codex', st: 'working' }), f, none)).toBe(false)
  })

  it('spend and open review', () => {
    expect(matchesFilter(task({}), { ...NO_FILTER, spend: 5 }, { cost: 4.99, openReview: false })).toBe(false)
    expect(matchesFilter(task({}), { ...NO_FILTER, spend: 5 }, { cost: 5, openReview: false })).toBe(true)
    expect(matchesFilter(task({}), { ...NO_FILTER, review: true }, { cost: 0, openReview: true })).toBe(true)
  })

  it('status of a card, and what counts as filtering', () => {
    expect([statusOf({ st: 'failed' }), statusOf({ st: 'working', queued: null }), statusOf({ st: null, queued: { at: 1 } as Task['queued'] }), statusOf({ st: 'done' })]).toEqual(['needs', 'working', 'queued', 'idle'])
    expect([isFiltering(NO_FILTER), isFiltering({ ...NO_FILTER, query: ' x ' }), filterCount({ ...NO_FILTER, query: 'x', review: true, agents: ['claude', 'codex'] })]).toEqual([false, true, 2])
  })

  it('views: the filters match one whatever the order they were picked in', () => {
    expect(viewOf({ ...NO_FILTER, status: ['needs'], query: 'x' }, BUILTIN_VIEWS)?.name).toBe('Needs me')
    expect(sameFilters({ ...NO_FILTER, status: ['queued', 'working'] }, { ...NO_FILTER, status: ['working', 'queued'] })).toBe(true)
    expect(viewOf(NO_FILTER, BUILTIN_VIEWS)).toBeNull()
    expect(viewOf({ ...NO_FILTER, review: true, spend: 1 }, BUILTIN_VIEWS)).toBeNull()
  })

  it('lanes by agent (No agent last) and by repository (the board’s own first)', () => {
    const tasks = [
      task({ id: 'a', agentKind: null }),
      task({ id: 'b', agentKind: 'codex' }),
      task({ id: 'c', agentKind: null, queued: { agentKind: 'claude', branch: '', message: '', at: 1 } }),
      task({ id: 'd', repos: ['api'] }),
      task({ id: 'e', projectId: 'api', repos: ['web'] })
    ]
    const name = (id: string): string => ({ web: 'Web', api: 'API' })[id] ?? id
    const byAgent = lanesOf(tasks, 'agent', { projectId: 'web', projectName: name })
    expect(byAgent.map((l) => [l.label, l.tasks.map((t) => t.id).join('')])).toEqual([
      ['Claude Code', 'cde'],
      ['Codex', 'b'],
      ['No agent', 'a']
    ])
    const byRepo = lanesOf(tasks, 'repo', { projectId: 'web', projectName: name })
    expect(byRepo.map((l) => [l.key, l.label, l.tasks.length])).toEqual([
      ['web', 'Web', 3],
      ['web+api', 'Web + API', 2]
    ])
    expect(lanesOf(tasks, 'none', { projectId: 'web', projectName: name })).toHaveLength(1)
  })

  it('keeps filters, lanes and views - not the searches, nor anything odd', () => {
    const kept = serializeBoardPrefs({
      filters: { web: { ...NO_FILTER, query: 'login', agents: ['codex'] }, api: { ...NO_FILTER, query: 'only a search' } },
      group: { web: 'agent' },
      collapsed: { web: ['none'] },
      views: [{ id: 'v1', name: 'Mine', filter: { ...NO_FILTER, spend: 2 } }]
    })
    const back = parseBoardPrefs(kept)
    expect(back.filters).toEqual({ web: { ...NO_FILTER, agents: ['codex'] } })
    expect([back.group, back.collapsed, back.views[0].filter.spend]).toEqual([{ web: 'agent' }, { web: ['none'] }, 2])
    const odd = parseBoardPrefs('{"filters":{"x":{"status":["bogus","needs"],"spend":-3}},"group":{"x":"weird"},"views":[{"name":1}]}')
    expect([odd.filters.x.status, odd.filters.x.spend, odd.group, odd.views]).toEqual([['needs'], 0, {}, []])
    expect(parseBoardPrefs('not json').views).toEqual([])
  })
})
