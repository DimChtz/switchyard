import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as db from './db'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sy-db-'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('db', () => {
  it('keeps a collection in order, and only what put last', () => {
    db.open(dir)
    db.put('tasks', [{ id: 'A-2', title: 'two' }, { id: 'A-1', title: 'one' }])
    expect(db.all('tasks')).toEqual([{ id: 'A-2', title: 'two' }, { id: 'A-1', title: 'one' }])
    db.put('tasks', [{ id: 'A-1', title: 'one!' }])
    expect(db.all('tasks')).toEqual([{ id: 'A-1', title: 'one!' }])
  })

  it('survives closing and opening again', () => {
    db.open(dir)
    db.put('projects', [{ id: 'p', name: 'demo' }])
    db.setKv('window', { x: 1 })
    db.close()
    db.open(dir)
    expect(db.all('projects')).toEqual([{ id: 'p', name: 'demo' }])
    expect(db.getKv('window')).toEqual({ x: 1 })
    db.setKv('window', undefined)
    expect(db.getKv('window')).toBeUndefined()
  })

  it('gives copies: changing what it returned changes nothing', () => {
    db.open(dir)
    db.put('tasks', [{ id: 'A-1', title: 'one' }])
    const got = db.all<{ id: string; title: string }>('tasks')
    got[0].title = 'changed'
    got.push({ id: 'A-9', title: 'x' })
    expect(db.all('tasks')).toEqual([{ id: 'A-1', title: 'one' }])
  })

  it('keeps items without ids (activity, viewed marks) by their content', () => {
    db.open(dir)
    db.put('viewedFiles', ['A-1|a.ts', 'A-1|b.ts'])
    db.put('activity', [{ at: 1, kind: 'turn' }, { at: 2, kind: 'review' }])
    db.put('viewedFiles', ['A-1|b.ts'])
    expect(db.all('viewedFiles')).toEqual(['A-1|b.ts'])
    expect(db.all('activity')).toHaveLength(2)
  })

  it('moves the JSON store from before in once, keeping it as .bak', () => {
    writeFileSync(
      join(dir, 'switchyard.json'),
      JSON.stringify({
        projects: [{ id: 'p' }],
        tasks: [{ id: 'A-1' }],
        comments: [],
        notices: [],
        checkpoints: [{ id: 'c1', taskId: 'A-1' }],
        team: [],
        viewedFiles: ['A-1|x'],
        activity: { events: [{ at: 5, kind: 'turn' }], seenAt: 3, announced: '2026-10-01' },
        window: { x: 10 },
        prefs: { theme: 'light' }
      })
    )
    writeFileSync(join(dir, 'usage.json'), JSON.stringify({ entries: [{ sessionId: 's1', days: {} }] }))
    db.open(dir)
    expect(db.all('tasks')).toEqual([{ id: 'A-1' }])
    expect(db.all('checkpoints')).toEqual([{ id: 'c1', taskId: 'A-1' }])
    expect(db.all('activity')).toEqual([{ at: 5, kind: 'turn' }])
    expect(db.getKv('activityMeta')).toEqual({ seenAt: 3, announced: '2026-10-01' })
    expect(db.getKv('window')).toEqual({ x: 10 })
    expect(db.getKv('legacyPrefs')).toEqual({ theme: 'light' })
    expect(db.all('usage')).toEqual([{ sessionId: 's1', days: {} }])
    expect(existsSync(join(dir, 'switchyard.json'))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, 'switchyard.json.bak'), 'utf-8')).tasks).toEqual([{ id: 'A-1' }])
    // Not again: a later JSON file (an older version run meanwhile) is left alone.
    db.close()
    writeFileSync(join(dir, 'switchyard.json'), JSON.stringify({ tasks: [{ id: 'B-1' }] }))
    db.open(dir)
    expect(db.all('tasks')).toEqual([{ id: 'A-1' }])
  })

  it('sets a broken database file aside and starts a fresh one', () => {
    writeFileSync(join(dir, 'switchyard.db'), 'this is not sqlite')
    db.open(dir)
    db.put('tasks', [{ id: 'A-1' }])
    expect(db.all('tasks')).toEqual([{ id: 'A-1' }])
  })
})
