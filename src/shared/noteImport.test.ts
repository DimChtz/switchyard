import { describe, expect, it } from 'vitest'
import { convertNote, fileNameFor, parseFrontMatter, relinkBatch, titleFromFileName } from './noteImport'

describe('importing notes', () => {
  it('titles a note by its heading, else by its file name', () => {
    expect(convertNote({ name: 'plan.md', raw: '# Launch plan\n\nShip it.' }).body).toBe('# Launch plan\n\nShip it.\n')
    const n = convertNote({ name: 'Meeting notes.md', raw: 'Talked about the API.\r\n' })
    expect([n.title, n.body]).toEqual(['Meeting notes', '# Meeting notes\n\nTalked about the API.\n'])
    expect(convertNote({ name: 'todo.txt', raw: '' }).body).toBe('# todo\n')
  })

  it('drops Obsidian front matter but keeps its tags', () => {
    const raw = '---\naliases: [x]\ntags:\n  - work\n  - "q3 plans"\n---\nBody'
    expect(convertNote({ name: 'Ideas.md', raw }).body).toBe('# Ideas\n\nTags: #work #q3-plans\n\nBody\n')
    expect(parseFrontMatter('tags: [a, "#b"]\ncreated: 2024-01-01')).toEqual({ tags: ['a', '#b'], created: '2024-01-01' })
  })

  it("keeps Switchyard's own links when a note comes back", () => {
    const n = convertNote({ name: 'x.md', raw: '---\nproject: web\ntask: WEB-4\npinned: true\n---\n# X\n' })
    expect([n.projectId, n.taskId, n.pinned, n.body]).toEqual(['web', 'WEB-4', true, '# X\n'])
  })

  it('reads Notion exports: page ids off the names, page links as note links', () => {
    expect(titleFromFileName('Roadmap 0123456789abcdef0123456789abcdef.md')).toBe('Roadmap')
    const n = convertNote({ name: 'Home 0123456789abcdef0123456789abcdef.md', raw: '# Home\n\nSee [the roadmap](Home/Roadmap%200123456789abcdef0123456789abcdef.md) and [docs](https://x.y/a.md).' })
    expect(n.body).toBe('# Home\n\nSee [[Roadmap|the roadmap]] and [docs](https://x.y/a.md).\n')
  })

  it('points [[links]] at the titles notes got, and turns embeds into links or mentions', () => {
    const [a] = relinkBatch([
      convertNote({ name: 'a.md', raw: 'See [[b]], [[b#Why|why]] and ![[b]].\n![[diagram.png]]' }),
      convertNote({ name: 'b.md', raw: '# The B note\n' })
    ])
    expect(a.body).toBe('# a\n\nSee [[The B note]], [[The B note#Why|why]] and [[The B note]].\n*(attachment: diagram.png)*\n')
  })

  it('brings images along: Obsidian embeds by name, Markdown images by path', () => {
    const seen: [string, boolean][] = []
    const attach = (ref: string, _n: unknown, byName: boolean): string | null => {
      seen.push([ref, byName])
      return ref.includes('missing') ? null : `attachments/${ref.split('/').pop()}`
    }
    const [n] = relinkBatch(
      [convertNote({ name: 'a.md', raw: '![[my diagram.png]] ![[missing.png]] ![[doc.pdf]]\n![Chart](Home/chart%201.png) ![web](https://x.y/a.png)', dir: '/vault' })],
      attach
    )
    expect(n.body).toBe('# a\n\n![my diagram.png](attachments/my%20diagram.png) *(attachment: missing.png)* *(attachment: doc.pdf)*\n![Chart](attachments/chart%201.png) ![web](https://x.y/a.png)\n')
    expect(seen).toEqual([
      ['Home/chart 1.png', false],
      ['my diagram.png', true],
      ['missing.png', true]
    ])
    expect(n.dir).toBe('/vault')
  })

  it('names exported files after titles, safely', () => {
    expect(fileNameFor('API: v2 / auth?')).toBe('API- v2 - auth-')
    expect(fileNameFor('  ..  ')).toBe('Untitled note')
    expect(fileNameFor('CON')).toBe('CON note')
  })
})
