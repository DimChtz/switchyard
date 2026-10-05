import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readZip, safeEntryPath, writeZip } from './zip'
import { ignoreRules, openPackage, packFolder, unpack } from './pluginPackage'
import { appSatisfies, compareVersions } from '@shared/plugins'

/** A zip with one entry, its name as given (for names the writer would never make). */
function zipWithName(name: string, data = 'x'): Buffer {
  const z = writeZip([{ path: 'PLACEHOLDER', data: Buffer.from(data) }])
  const swapped = z.toString('latin1').split('PLACEHOLDER').join(name.padEnd(11, ' ').slice(0, 11))
  return Buffer.from(swapped, 'latin1')
}

describe('zip', () => {
  it('reads back what it writes', () => {
    const files = [
      { path: 'plugin.json', data: Buffer.from('{"a":1}') },
      { path: 'lib/main.js', data: Buffer.from('x'.repeat(5000)) },
      { path: 'ünïcode.txt', data: Buffer.from('ok') },
      { path: 'empty', data: Buffer.alloc(0) }
    ]
    expect(readZip(writeZip(files)).map((f) => [f.path, f.data.toString()])).toEqual(files.map((f) => [f.path, f.data.toString()]))
  })

  it("won't write outside the folder", () => {
    expect(safeEntryPath('a/b.js')).toBe('a/b.js')
    expect(safeEntryPath('../evil.js')).toBeNull()
    expect(safeEntryPath('a/../../evil')).toBeNull()
    expect(safeEntryPath('/etc/passwd')).toBeNull()
    expect(safeEntryPath('C:/x')).toBeNull()
    expect(safeEntryPath('a\\..\\b')).toBeNull()
    expect(safeEntryPath('a/con.txt')).toBeNull()
    expect(() => readZip(zipWithName('../evil.js'))).toThrow(/outside/)
  })

  it('refuses what isn’t a zip, damage and too much', () => {
    expect(() => readZip(Buffer.from('hello'))).toThrow(/isn't a zip/)
    const z = writeZip([{ path: 'a.txt', data: Buffer.from('hello hello hello') }])
    const bad = Buffer.from(z)
    bad[40] ^= 0xff
    expect(() => readZip(bad)).toThrow(/damaged|can't be unpacked/)
    expect(() => readZip(writeZip([{ path: 'big', data: Buffer.alloc(2000) }]), { maxFiles: 10, maxBytes: 1000 })).toThrow(/more than/)
    expect(() => readZip(writeZip([{ path: 'a', data: Buffer.from('1') }, { path: 'b', data: Buffer.from('2') }]), { maxFiles: 1, maxBytes: 1e6 })).toThrow(/2 files/)
  })
})

describe('plugin packages', () => {
  const plugin = (files: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'sy-plugin-'))
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true })
      writeFileSync(join(dir, name), body)
    }
    return dir
  }
  const manifest = JSON.stringify({ id: 'hello', name: 'Hello', version: '1.2.0', main: 'main.js' })

  it('packs a folder (minus what is left out) and installs it back', () => {
    const dir = plugin({
      'plugin.json': manifest,
      'main.js': 'exports.activate = () => {}',
      'README.md': '# hi',
      'lib/util.js': '1',
      'notes.log': 'x',
      'node_modules/dep/index.js': 'dep',
      '.git/HEAD': 'ref',
      'old-1.0.0.syplugin': 'zip',
      '.sypluginignore': '*.log\n# a comment\n/README.md\n'
    })
    try {
      const pack = packFolder(dir)
      expect(pack.fileName).toBe('hello-1.2.0.syplugin')
      expect(pack.files.sort()).toEqual(['.sypluginignore', 'lib/util.js', 'main.js', 'node_modules/dep/index.js', 'plugin.json'])
      const opened = openPackage(pack.zip)
      expect(opened.manifest.id).toBe('hello')
      const into = join(dir, 'out')
      unpack(opened.files, into)
      expect(readFileSync(join(into, 'lib', 'util.js'), 'utf-8')).toBe('1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('says what is wrong with a folder or a package', () => {
    const dir = plugin({ 'plugin.json': manifest })
    try {
      expect(() => packFolder(dir)).toThrow(/main\.js.*isn't there/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(() => openPackage(writeZip([{ path: 'other.json', data: Buffer.from('{}') }]))).toThrow(/No plugin.json/)
    expect(() => openPackage(writeZip([{ path: 'plugin.json', data: Buffer.from(manifest) }]))).toThrow(/isn't in the package/)
    expect(() => openPackage(writeZip([{ path: 'plugin.json', data: Buffer.from('{') }]))).toThrow(/valid JSON/)
  })

  it('leaves out files the way .gitignore would', () => {
    const out = ignoreRules('dist/\n*.map\n/scratch\nsrc/**/*.test.js')
    expect(out('dist/a.js')).toBe(true)
    expect(out('lib/dist/a.js')).toBe(true)
    expect(out('a.js.map')).toBe(true)
    expect(out('scratch')).toBe(true)
    expect(out('lib/scratch')).toBe(false)
    expect(out('src/x/y.test.js')).toBe(true)
    expect(out('src/y.js')).toBe(false)
    expect(out('.git/HEAD')).toBe(true)
  })

  it('compares versions and checks "engines.switchyard"', () => {
    expect(compareVersions('0.2.0', '0.10.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(appSatisfies('0.2.1', '>=0.2.0')).toBe(true)
    expect(appSatisfies('0.1.9', '>=0.2.0')).toBe(false)
    expect(appSatisfies('0.2.5', '^0.2.0')).toBe(true)
    expect(appSatisfies('0.3.0', '^0.2.0')).toBe(false)
    expect(appSatisfies('1.4.0', '^1.2.0')).toBe(true)
    expect(appSatisfies('2.0.0', '^1.2.0')).toBe(false)
    expect(appSatisfies('0.1.0', undefined)).toBe(true)
  })
})
