import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dirs = vi.hoisted(() => ({ notes: '', picked: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => dirs.notes },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { trashItem: async () => {} },
  // The "user" picks dirs.picked in every dialog.
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [dirs.picked] }),
    showSaveDialog: async () => ({ canceled: false, filePath: join(dirs.picked, 'saved') })
  }
}))
vi.mock('./store', () => ({ getPrefs: () => ({ notesDir: dirs.notes }) }))
vi.mock('./repos', () => ({ expandPath: (p: string) => p }))

import { list } from './notes'
import { exportMany, exportOne, importPaths } from './notesTransfer'

const root = mkdtempSync(join(tmpdir(), 'switchyard-transfer-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

let n = 0
beforeEach(() => {
  dirs.notes = join(root, `notes${++n}`)
  dirs.picked = join(root, `picked${n}`)
  mkdirSync(dirs.picked, { recursive: true })
})

describe('importing and exporting notes', () => {
  it('imports a vault - not its app folders - and links notes as asked', async () => {
    const vault = join(root, `vault${n}`)
    mkdirSync(join(vault, '.obsidian'), { recursive: true })
    mkdirSync(join(vault, 'sub'))
    writeFileSync(join(vault, '.obsidian', 'workspace.md'), 'not a note')
    writeFileSync(join(vault, 'a.md'), 'See [[b]]')
    writeFileSync(join(vault, 'sub', 'b.md'), '# Bee\n')
    writeFileSync(join(vault, 'picture.png'), 'x')
    const res = await importPaths([vault], { projectId: 'web', taskId: 'WEB-1' })
    expect([res.found, res.ids.length, res.skipped, res.failed]).toEqual([2, 2, 0, []])
    const notes = await list()
    expect(notes.map((x) => [x.title, x.taskId]).sort()).toEqual([
      ['Bee', 'WEB-1'],
      ['a', 'WEB-1']
    ])
    expect(notes.find((x) => x.title === 'a')!.body).toBe('# a\n\nSee [[Bee]]\n')
    expect((await importPaths([vault])).skipped).toBe(2)
  })

  it('exports into a folder by title, never over a file that is there', async () => {
    const vault = join(root, `src${n}`)
    mkdirSync(vault)
    writeFileSync(join(vault, 'one.md'), '# Plan: v2\n\nText')
    writeFileSync(join(vault, 'two.md'), '# Plan: v2\n\nOther')
    const { ids } = await importPaths([vault])
    writeFileSync(join(dirs.picked, 'Plan- v2.md'), 'mine')
    expect(await exportMany(null, ids)).toEqual({ dir: dirs.picked, count: 2 })
    expect(readdirSync(dirs.picked).sort()).toEqual(['Plan- v2 2.md', 'Plan- v2 3.md', 'Plan- v2.md'])
    expect(readFileSync(join(dirs.picked, 'Plan- v2.md'), 'utf-8')).toBe('mine')
  })

  it('copies the images notes show into attachments (once), and exports them along', async () => {
    const vault = join(root, `img${n}`)
    mkdirSync(join(vault, 'assets'), { recursive: true })
    writeFileSync(join(vault, 'assets', 'pic.png'), 'PNG1')
    writeFileSync(join(vault, 'a.md'), '![[pic.png]]')
    writeFileSync(join(vault, 'b.md'), '# B\n\n![p](assets/pic.png)')
    const res = await importPaths([vault])
    expect([res.ids.length, res.images]).toEqual([2, 1])
    expect(readdirSync(join(dirs.notes, 'attachments'))).toEqual(['pic.png'])
    const bodies = (await list()).map((x) => x.body).sort()
    expect(bodies).toEqual(['# B\n\n![p](attachments/pic.png)\n', '# a\n\n![pic.png](attachments/pic.png)\n'])
    // A different image with the same name gets its own
    writeFileSync(join(vault, 'assets', 'pic.png'), 'PNG2')
    writeFileSync(join(vault, 'c.md'), '![[pic.png]]')
    await importPaths([join(vault, 'c.md'), join(vault, 'assets')])
    expect(readdirSync(join(dirs.notes, 'attachments')).sort()).toEqual(['pic-2.png', 'pic.png'])
    const all = await list()
    expect(await exportMany(null, all.map((x) => x.id))).toMatchObject({ count: 3 })
    expect(readdirSync(join(dirs.picked, 'attachments')).sort()).toEqual(['pic-2.png', 'pic.png'])
  })

  it('saves one note as a .md file', async () => {
    const path = await exportOne(null, '# Hi\n\nThere')
    expect(path).toBe(join(dirs.picked, 'saved.md'))
    expect(readFileSync(path!, 'utf-8')).toBe('# Hi\n\nThere\n')
  })
})
