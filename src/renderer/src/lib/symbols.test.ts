import { describe, expect, it } from 'vitest'
import { typescriptLanguage } from '@codemirror/lang-javascript'
import { pythonLanguage } from '@codemirror/lang-python'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { cssLanguage } from '@codemirror/lang-css'
import { filterSymbols, symbolsOf } from './symbols'

const of = (lang: { parser: { parse: (s: string) => import('@lezer/common').Tree } }, src: string): string[] =>
  symbolsOf(lang.parser.parse(src), src).map((s) => `${'  '.repeat(s.depth)}${s.kind} ${s.name}`)

describe('symbolsOf', () => {
  it('lists TypeScript declarations, methods under their class', () => {
    const src = `export function add(a: number) { const inner = () => 1; return a }
export class Foo { bar(): void {} baz = 1; static make() {} }
interface Shape { x: number }
type Id = string
enum Color { Red }
export const handler = async () => {}
let x = 1, y = 2
`
    expect(of(typescriptLanguage, src)).toEqual([
      'function add',
      'class Foo',
      '  method bar',
      '  property baz',
      '  method make',
      'interface Shape',
      'type Id',
      'enum Color',
      'function handler',
      'variable x',
      'variable y'
    ])
  })
  it('lists Python functions and classes', () => {
    expect(of(pythonLanguage, 'def f(x):\n  def local():\n    pass\n  pass\nclass A:\n  def m(self):\n    pass\n')).toEqual(['function f', 'class A', '  method m'])
  })
  it('lists Markdown headings by level', () => {
    expect(of(markdownLanguage, '# Title\n\ntext\n\n## Sub ##\n\n### Deeper\n')).toEqual(['heading Title', '  heading Sub', '    heading Deeper'])
  })
  it('lists CSS rules by selector', () => {
    expect(of(cssLanguage, '.a > b,\n  .c { color: red }\n#id { }\n')).toEqual(['rule .a > b, .c', 'rule #id'])
  })
})

describe('filterSymbols', () => {
  const list = ['useThing', 'thing', 'other'].map((name, i) => ({ name, kind: 'function' as const, from: i, to: i, depth: 0 }))
  it('keeps names containing the text, the ones starting with it first', () => {
    expect(filterSymbols(list, 'thing').map((s) => s.name)).toEqual(['thing', 'useThing'])
    expect(filterSymbols(list, '').map((s) => s.name)).toEqual(['useThing', 'thing', 'other'])
  })
})
