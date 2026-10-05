import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dirs = vi.hoisted(() => ({ notes: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => dirs.notes },
  BrowserWindow: { getAllWindows: () => [] },
  // "Trash" deletes, here.
  shell: { trashItem: async (p: string) => unlinkSync(p) }
}))
vi.mock('./store', () => ({ getPrefs: () => ({ notesDir: dirs.notes }) }))
vi.mock('./repos', () => ({ expandPath: (p: string) => p }))

import { list, remove, save, titleOf } from './notes'

const root = mkdtempSync(join(tmpdir(), 'switchyard-notes-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

let n = 0
beforeEach(() => {
  dirs.notes = join(root, `n${++n}`)
})

const files = (): string[] => readdirSync(dirs.notes).sort()
const draft = (body: string, id?: string, nameFromTitle = false) => ({ id, body, projectId: null, taskId: null, pinned: false, nameFromTitle })

describe('titleOf', () => {
  it('takes the first heading, else the first line', () => {
    expect(titleOf('# Plan\nmore')).toBe('Plan')
    expect(titleOf('intro\n## Later')).toBe('Later')
    expect(titleOf('just text\nmore')).toBe('just text')
    expect(titleOf('# \n')).toBe('Untitled')
    expect(titleOf('#')).toBe('Untitled')
    expect(titleOf('# **Bold** `code`')).toBe('Bold code')
  })
})

describe('save', () => {
  it('names a new note after its title, never over another note', async () => {
    expect((await save(draft('# Test'))).id).toBe('test')
    expect((await save(draft('# Test'))).id).toBe('test-2')
    expect(files()).toEqual(['test-2.md', 'test.md'])
  })

  it('writes front matter only when there is something to keep', async () => {
    const a = await save(draft('plain'))
    expect(readFileSync(a.file, 'utf-8')).toBe('plain')
    const b = await save({ ...draft('# Pinned'), pinned: true, projectId: 'demo' })
    expect(readFileSync(b.file, 'utf-8')).toBe('---\nproject: demo\npinned: true\n---\n# Pinned')
    const [back] = (await list()).filter((x) => x.id === b.id)
    expect(back).toMatchObject({ pinned: true, projectId: 'demo', title: 'Pinned' })
  })

  // The bug behind a note disappearing: a new note got the name another
  // note had just been renamed away from, and a late save under that name
  // went into the new note's file.
  it('never hands out a name a note was renamed away from', async () => {
    const first = await save(draft('# '))
    expect(first.id).toBe('note')
    const titled = await save(draft('# Shopping list', 'note', true))
    expect(titled.id).toBe('shopping-list')
    expect(files()).toEqual(['shopping-list.md'])

    const second = await save(draft('# '))
    expect(second.id).toBe('note-2')

    // A save still on its way under the old name lands in the renamed file.
    const late = await save(draft('# Shopping list\n- milk', 'note'))
    expect(late.id).toBe('shopping-list')
    expect(readFileSync(join(dirs.notes, 'note-2.md'), 'utf-8')).toBe('# ')
    expect(readFileSync(join(dirs.notes, 'shopping-list.md'), 'utf-8')).toBe('# Shopping list\n- milk')
  })
})

describe('remove', () => {
  it('removes the file a note was renamed to, and is fine when it is already gone', async () => {
    await save(draft('# '))
    await save(draft('# Renamed', 'note', true))
    await remove('note')
    expect(existsSync(join(dirs.notes, 'renamed.md'))).toBe(false)
    await expect(remove('nothing-here')).resolves.toBeUndefined()
  })
})
