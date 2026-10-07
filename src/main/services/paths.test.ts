import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isInside, samePath } from './paths'

const root = mkdtempSync(join(tmpdir(), 'sy-paths-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('comparing paths', () => {
  // A folder reached through a link - as macOS's /var is /private/var (a junction on Windows: no admin needed).
  const real = join(root, 'real')
  const link = join(root, 'link')
  mkdirSync(join(real, 'wt'), { recursive: true })
  symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir')

  it('takes a folder and its link for the same one - existing or not', () => {
    expect(samePath(join(link, 'wt'), join(real, 'wt'))).toBe(true)
    expect(samePath(join(link, 'gone', 'x'), join(real, 'gone', 'x'))).toBe(true)
    expect(samePath(join(real, 'wt') + '/', join(real, 'wt'))).toBe(true)
    expect(samePath(join(real, 'wt'), join(real, 'other'))).toBe(false)
  })

  it('knows what is inside a folder', () => {
    expect(isInside(join(link, 'wt', 'a.ts'), real)).toBe(true)
    expect(isInside(join(root, 'realish'), real)).toBe(false)
  })
})
