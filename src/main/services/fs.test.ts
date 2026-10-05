import { afterAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ shell: { trashItem: vi.fn() } }))

import { changedPaths, copyEntry, editorConfig, listAllFiles, listFiles, moveEntry, readDoc, renameEntry, replaceText, searchText, subRepos, writeDoc } from './fs'

const root = mkdtempSync(join(tmpdir(), 'switchyard-fs-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

let n = 0
function dir(): string {
  const d = join(root, `d${++n}`)
  mkdirSync(d)
  return d
}

describe('copyEntry', () => {
  it('names copies the way VS Code does: "name copy.ext", then "name copy 2.ext"', async () => {
    const d = dir()
    writeFileSync(join(d, 'index.ts'), 'x')
    expect(await copyEntry(join(d, 'index.ts'), d)).toBe(join(d, 'index copy.ts'))
    expect(await copyEntry(join(d, 'index.ts'), d)).toBe(join(d, 'index copy 2.ts'))
    expect(await copyEntry(join(d, 'index.ts'), d)).toBe(join(d, 'index copy 3.ts'))
    expect(readFileSync(join(d, 'index copy 2.ts'), 'utf-8')).toBe('x')
  })

  it('keeps the name when it is free, and handles dotfiles and names without an extension', async () => {
    const a = dir()
    const b = dir()
    writeFileSync(join(a, '.env'), 'A=1')
    writeFileSync(join(a, 'Makefile'), '')
    expect(await copyEntry(join(a, '.env'), b)).toBe(join(b, '.env'))
    expect(await copyEntry(join(a, '.env'), a)).toBe(join(a, '.env copy'))
    expect(await copyEntry(join(a, 'Makefile'), a)).toBe(join(a, 'Makefile copy'))
  })

  it('copies folders with what is in them', async () => {
    const d = dir()
    mkdirSync(join(d, 'lib', 'deep'), { recursive: true })
    writeFileSync(join(d, 'lib', 'deep', 'a.txt'), 'a')
    const dest = await copyEntry(join(d, 'lib'), d)
    expect(dest).toBe(join(d, 'lib copy'))
    expect(readFileSync(join(dest, 'deep', 'a.txt'), 'utf-8')).toBe('a')
  })
})

describe('moveEntry and renameEntry', () => {
  it('moves into another folder', async () => {
    const d = dir()
    mkdirSync(join(d, 'to'))
    writeFileSync(join(d, 'a.txt'), 'a')
    expect(await moveEntry(join(d, 'a.txt'), join(d, 'to'))).toBe(join(d, 'to', 'a.txt'))
    expect(existsSync(join(d, 'a.txt'))).toBe(false)
  })

  it('does nothing when it is already there', async () => {
    const d = dir()
    writeFileSync(join(d, 'a.txt'), 'a')
    expect(await moveEntry(join(d, 'a.txt'), d)).toBe(join(d, 'a.txt'))
  })

  it("won't move a folder into itself", async () => {
    const d = dir()
    mkdirSync(join(d, 'src', 'lib'), { recursive: true })
    await expect(moveEntry(join(d, 'src'), join(d, 'src', 'lib'))).rejects.toThrow(/into itself/)
  })

  it("won't overwrite, but allows a change of case", async () => {
    const d = dir()
    writeFileSync(join(d, 'a.txt'), 'a')
    writeFileSync(join(d, 'b.txt'), 'b')
    await expect(renameEntry(join(d, 'a.txt'), join(d, 'b.txt'))).rejects.toThrow(/already exists/)
    mkdirSync(join(d, 'to'))
    writeFileSync(join(d, 'to', 'a.txt'), 'other')
    await expect(moveEntry(join(d, 'a.txt'), join(d, 'to'))).rejects.toThrow(/already exists/)
    await renameEntry(join(d, 'a.txt'), join(d, 'A.txt'))
    expect(readFileSync(join(d, 'A.txt'), 'utf-8')).toBe('a')
  })
})

describe('changedPaths', () => {
  it('reads git status --porcelain -z, skipping deleted files and the old name of a rename', () => {
    const out = [' M src/a.ts', '?? new file.txt', ' D gone.ts', 'R  src/to.ts', 'src/from.ts', 'A  added.ts', ''].join('\0')
    expect(changedPaths(out)).toEqual(['src/a.ts', 'new file.txt', 'src/to.ts', 'added.ts'])
  })
})

describe('listAllFiles', () => {
  it('outside git: every file of the folder, none of the folders', async () => {
    const d = dir()
    mkdirSync(join(d, 'src'))
    writeFileSync(join(d, 'src', 'a.ts'), '')
    writeFileSync(join(d, 'README.md'), '')
    const list = await listAllFiles(d)
    expect(list.files.sort()).toEqual(['README.md', 'src/a.ts'])
    expect(list.truncated).toBe(false)
  })

  it('in git: tracked and untracked files, not ignored or deleted ones, with what changed', async () => {
    const d = dir()
    const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: d }).toString()
    git('init', '-q')
    mkdirSync(join(d, 'src'))
    writeFileSync(join(d, '.gitignore'), 'dist/\n')
    writeFileSync(join(d, 'src', 'a.ts'), 'a')
    writeFileSync(join(d, 'src', 'gone.ts'), 'g')
    writeFileSync(join(d, 'same.ts'), 's')
    git('add', '-A')
    git('commit', '-qm', 'init')
    writeFileSync(join(d, 'src', 'a.ts'), 'changed')
    unlinkSync(join(d, 'src', 'gone.ts'))
    writeFileSync(join(d, 'new file.ts'), 'n')
    mkdirSync(join(d, 'dist'))
    writeFileSync(join(d, 'dist', 'bundle.js'), '')
    const list = await listAllFiles(d)
    expect(list.files.sort()).toEqual(['.gitignore', 'new file.ts', 'same.ts', 'src/a.ts'])
    expect(list.changed.sort()).toEqual(['new file.ts', 'src/a.ts'])
  })
})

describe('searchText and replaceText', () => {
  const o = { query: 'total', regex: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' }
  function repo(): string {
    const d = dir()
    const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: d }).toString()
    git('init', '-q')
    mkdirSync(join(d, 'src'))
    writeFileSync(join(d, '.gitignore'), 'dist/\n')
    writeFileSync(join(d, 'src', 'cart.ts'), 'const total = 1\nconst subtotal = 2\nreturn total + total\n')
    writeFileSync(join(d, 'src', 'cart.test.ts'), 'expect(total).toBe(1)\n')
    writeFileSync(join(d, 'README.md'), 'Total price\n')
    git('add', '-A')
    git('commit', '-qm', 'init')
    writeFileSync(join(d, 'notes.txt'), 'untracked total\n')
    mkdirSync(join(d, 'dist'))
    writeFileSync(join(d, 'dist', 'x.js'), 'total')
    writeFileSync(join(d, 'bin.dat'), Buffer.from([0, 116, 111, 116, 97, 108]))
    return d
  }

  it('finds every matching line - tracked and untracked files, not ignored or binary ones', async () => {
    const d = repo()
    const r = await searchText(d, o)
    expect(r.files.map((f) => f.path)).toEqual(['notes.txt', 'README.md', 'src/cart.test.ts', 'src/cart.ts'])
    const cart = r.files.find((f) => f.path === 'src/cart.ts')!
    expect(cart.count).toBe(4)
    expect(cart.lines.map((l) => [l.line, l.ranges.length])).toEqual([
      [0, 1],
      [1, 1],
      [2, 2]
    ])
    expect(r.total).toBe(7)
  })

  it('honors match case, whole word, regular expressions, include and exclude', async () => {
    const d = repo()
    expect((await searchText(d, { ...o, caseSensitive: true })).total).toBe(6)
    expect((await searchText(d, { ...o, wholeWord: true })).files.find((f) => f.path === 'src/cart.ts')!.count).toBe(3)
    expect((await searchText(d, { ...o, query: 'sub(total)', regex: true })).total).toBe(1)
    expect((await searchText(d, { ...o, include: 'src/**/*.ts', exclude: '*.test.ts' })).files.map((f) => f.path)).toEqual(['src/cart.ts'])
    expect((await searchText(d, { ...o, query: '(', regex: true })).error).toBe('Invalid regular expression')
  })

  it('replaces in the given files and saves them, only inside the checkout', async () => {
    const d = repo()
    const r = await replaceText(d, { ...o, wholeWord: true }, 'sum', ['src/cart.ts', '../outside.txt'])
    expect(r).toEqual({ files: 1, count: 3 })
    expect(readFileSync(join(d, 'src', 'cart.ts'), 'utf-8')).toBe('const sum = 1\nconst subtotal = 2\nreturn sum + sum\n')
    expect(readFileSync(join(d, 'README.md'), 'utf-8')).toBe('Total price\n')
  })
})

describe('a task folder with several repositories', () => {
  // Two repositories, and a task folder with a worktree of each on one branch.
  function taskFolder(): string {
    const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd }).toString()
    const base = dir()
    for (const name of ['web', 'api']) {
      const r = join(base, name)
      mkdirSync(r)
      git(r, 'init', '-q', '-b', 'main')
      writeFileSync(join(r, 'README.md'), `${name} total\n`)
      git(r, 'add', '-A')
      git(r, 'commit', '-qm', 'init')
    }
    const task = join(base, 'task')
    mkdirSync(task)
    for (const name of ['web', 'api']) git(join(base, name), 'worktree', 'add', '-q', '-b', 'feat', join(task, name))
    writeFileSync(join(task, 'api', 'new.ts'), 'const total = 2\n')
    writeFileSync(join(task, 'web', 'README.md'), 'web total changed\n')
    return task
  }

  it('finds the repositories', async () => {
    const task = taskFolder()
    expect(await subRepos(task)).toEqual(['api', 'web'])
    expect(await subRepos(join(task, 'api'))).toEqual([])
  })

  it('lists, marks and searches files per repository, under its folder', async () => {
    const task = taskFolder()
    const all = await listAllFiles(task)
    expect(all.files.sort()).toEqual(['api/README.md', 'api/new.ts', 'web/README.md'])
    expect(all.changed.sort()).toEqual(['api/new.ts', 'web/README.md'])
    const tree = await listFiles(task, 'main')
    expect(tree.filter((f) => f.status !== 'unchanged').map((f) => `${f.path}:${f.status}`).sort()).toEqual(['api/new.ts:added', 'web/README.md:modified'])
    const found = await searchText(task, { query: 'total', regex: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' })
    expect(found.files.map((f) => f.path)).toEqual(['api/new.ts', 'api/README.md', 'web/README.md'])
  })
})

describe('readDoc / writeDoc', () => {
  it('keeps CRLF line ends and a byte-order mark through an edit', async () => {
    const d = dir()
    const f = join(d, 'win.txt')
    writeFileSync(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo\r\n')]))
    const doc = await readDoc(f)
    expect(doc).toMatchObject({ kind: 'text', text: 'one\ntwo\n', eol: '\r\n', bom: true })
    await writeDoc(f, 'one\nTWO\n', { eol: doc.eol, bom: doc.bom, expectMtime: doc.mtime })
    expect(readFileSync(f)).toEqual(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\nTWO\r\n')]))
  })
  it('refuses to save over a file changed since it was read', async () => {
    const d = dir()
    const f = join(d, 'a.ts')
    writeFileSync(f, 'a\n')
    const doc = await readDoc(f)
    await new Promise((r) => setTimeout(r, 20))
    writeFileSync(f, 'agent\n')
    await expect(writeDoc(f, 'mine\n', { eol: '\n', bom: false, expectMtime: doc.mtime })).rejects.toThrow('CHANGED_ON_DISK')
    expect(readFileSync(f, 'utf-8')).toBe('agent\n')
  })
  it('gives binary files no text to edit', async () => {
    const d = dir()
    writeFileSync(join(d, 'x.bin'), Buffer.from([1, 0, 2]))
    expect(await readDoc(join(d, 'x.bin'))).toMatchObject({ kind: 'binary', text: '' })
  })
  it('reads .editorconfig files up to a root one', async () => {
    const d = dir()
    mkdirSync(join(d, 'src'))
    writeFileSync(join(d, '.editorconfig'), 'root = true\n[*]\nindent_style = tab\n')
    writeFileSync(join(d, 'src', '.editorconfig'), '[*.ts]\nindent_style = space\nindent_size = 4\n')
    expect(await editorConfig(join(d, 'src', 'a.ts'))).toMatchObject({ indent_style: 'space', indent_size: 4 })
    expect(await editorConfig(join(d, 'src', 'a.go'))).toMatchObject({ indent_style: 'tab' })
  })
})

describe('listFiles (git)', () => {
  it('lists dotfiles and committed build folders, and marks ignored files', async () => {
    const d = dir()
    execFileSync('git', ['init', '-q', d])
    mkdirSync(join(d, '.github'))
    mkdirSync(join(d, 'build'))
    mkdirSync(join(d, 'node_modules'))
    writeFileSync(join(d, '.github', 'ci.yml'), 'x')
    writeFileSync(join(d, 'build', 'icon.png'), 'x')
    writeFileSync(join(d, '.gitignore'), '.env\nnode_modules/\n')
    writeFileSync(join(d, '.env'), 'A=1')
    writeFileSync(join(d, 'node_modules', 'm.js'), 'x')
    const list = await listFiles(d)
    const paths = list
      .filter((f) => !f.isDir)
      .map((f) => f.path)
      .sort()
    expect(paths).toEqual(['.env', '.github/ci.yml', '.gitignore', 'build/icon.png'])
    expect(list.find((f) => f.path === '.env')?.ignored).toBe(true)
    expect(
      list
        .filter((f) => f.isDir)
        .map((f) => f.path)
        .sort()
    ).toEqual(['.github', 'build'])
  })
})
