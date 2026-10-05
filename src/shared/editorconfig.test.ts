import { describe, expect, it } from 'vitest'
import { editorConfigFor, globToRegExp } from './editorconfig'

const m = (glob: string, path: string): boolean => globToRegExp(glob).test(path)

describe('editorconfig globs', () => {
  it('matches names anywhere without a slash, and from the folder with one', () => {
    expect(m('*.ts', 'src/a/b.ts')).toBe(true)
    expect(m('*.ts', 'b.tsx')).toBe(false)
    expect(m('/src/*.ts', 'src/b.ts')).toBe(true)
    expect(m('src/*.ts', 'src/a/b.ts')).toBe(false)
    expect(m('src/**.ts', 'src/a/b.ts')).toBe(true)
    expect(m('**/test/*.js', 'test/x.js')).toBe(true)
    expect(m('Makefile', 'sub/Makefile')).toBe(true)
  })
  it('supports ?, [classes], {alternatives} and {number ranges}', () => {
    expect(m('?.md', 'a.md')).toBe(true)
    expect(m('?.md', 'ab.md')).toBe(false)
    expect(m('[abc].txt', 'b.txt')).toBe(true)
    expect(m('[!abc].txt', 'b.txt')).toBe(false)
    expect(m('*.{js,ts,{json,yml}}', 'x.yml')).toBe(true)
    expect(m('*.{js,ts}', 'x.css')).toBe(false)
    expect(m('file{1..3}.txt', 'file2.txt')).toBe(true)
    expect(m('file{1..3}.txt', 'file4.txt')).toBe(false)
    expect(m('{package.json,.travis.yml}', 'package.json')).toBe(true)
  })
})

describe('editorConfigFor', () => {
  const root = {
    dir: 'C:/repo',
    content: ['root = true', '', '[*]', 'indent_style = space', 'indent_size = 2', 'end_of_line = lf', 'insert_final_newline = true', 'trim_trailing_whitespace = true', '', '[Makefile]', 'indent_style = tab', '', '[*.md]', 'trim_trailing_whitespace = false ; markdown keeps them'].join('\n')
  }
  it('combines sections, later ones winning', () => {
    expect(editorConfigFor('C:/repo/src/a.ts', [root])).toEqual({ indent_style: 'space', indent_size: 2, tab_width: 2, end_of_line: 'lf', insert_final_newline: true, trim_trailing_whitespace: true })
    expect(editorConfigFor('C:/repo/Makefile', [root]).indent_style).toBe('tab')
    expect(editorConfigFor('C:/repo/README.md', [root]).trim_trailing_whitespace).toBe(false)
  })
  it('lets a nearer file override, and unset remove', () => {
    const sub = { dir: 'C:/repo/legacy', content: '[*.ts]\nindent_size = 4\nend_of_line = unset\n' }
    const p = editorConfigFor('C:/repo/legacy/x.ts', [sub, root])
    expect(p.indent_size).toBe(4)
    expect(p.end_of_line).toBeUndefined()
  })
  it('stops at a root file', () => {
    const above = { dir: 'C:/', content: '[*]\nindent_style = tab\nmax_line_length = 80\n' }
    expect(editorConfigFor('C:/repo/a.ts', [root, above]).max_line_length).toBeUndefined()
  })
  it('indent_size = tab uses tab_width', () => {
    expect(editorConfigFor('/r/a.go', [{ dir: '/r', content: '[*.go]\nindent_size = tab\ntab_width = 8\n' }])).toEqual({ indent_style: 'tab', indent_size: 8, tab_width: 8 })
  })
})
