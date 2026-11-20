import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, shell: { openPath: async () => '', showItemInFolder: () => {} } }))

import { keepFile, linkedFile, safeName } from './attachments'

describe('files attached to a description or a note', () => {
  it('keeps a copy under its own name - never over one already there', async () => {
    const d = mkdtempSync(join(tmpdir(), 'sy-att-'))
    try {
      const src = join(d, 'Q3 report (final).pdf')
      writeFileSync(src, 'pdf')
      const keep = join(d, 'kept')
      expect(await keepFile(keep, { path: src })).toBe('Q3-report-final.pdf')
      expect(await keepFile(keep, { path: src })).toBe('Q3-report-final-2.pdf')
      expect(readFileSync(join(keep, 'Q3-report-final-2.pdf'), 'utf8')).toBe('pdf')
      // Pasted, with no file behind it: from its data.
      expect(await keepFile(keep, { dataUrl: `data:text/plain;base64,${Buffer.from('log line').toString('base64')}`, name: 'run.log' })).toBe('run.log')
      expect(readFileSync(join(keep, 'run.log'), 'utf8')).toBe('log line')
      await expect(keepFile(keep, { path: d })).rejects.toThrow(/folder/)
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('makes names safe for any file system and a Markdown link', () => {
    expect(safeName('a/b\\c:d*e?.txt')).toBe('a-b-c-d-e.txt')
    expect(safeName('notes [draft] #2.md')).toBe('notes-draft-2.md')
    expect(safeName('...')).toBe('file')
  })

  it('finds the file a link names - not a web address or an anchor', () => {
    const base = join(tmpdir(), 'notes')
    expect(linkedFile('attachments/spec%202.pdf', base)).toBe(join(base, 'attachments', 'spec 2.pdf'))
    expect(linkedFile('https://x.io/a.pdf', base)).toBeNull()
    expect(linkedFile('#top', base)).toBeNull()
    expect(linkedFile('mailto:a@b.c', base)).toBeNull()
    if (process.platform === 'win32') {
      expect(linkedFile('C:/Users/me/a.pdf', base)).toBe('C:/Users/me/a.pdf')
      expect(linkedFile('file:///C:/Users/me/a.pdf', base)).toBe('C:/Users/me/a.pdf')
    } else expect(linkedFile('file:///Users/me/a.pdf', base)).toBe('/Users/me/a.pdf')
  })
})
