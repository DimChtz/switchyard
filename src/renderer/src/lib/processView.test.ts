import { describe, expect, it } from 'vitest'
import { formatMem, sessionKind, shortCmd } from './processView'
import type { Task } from '@shared/types'

describe('sessionKind', () => {
  const tasks = [{ id: 'SYT-3' }, { id: 'SYT-30' }] as Task[]
  it('tells what a terminal is, and whose', () => {
    expect(sessionKind('agent-SYT-3', tasks)).toMatchObject({ kind: 'agent', label: 'agent', task: { id: 'SYT-3' } })
    expect(sessionKind('preview-SYT-30', tasks)).toMatchObject({ kind: 'dev server', label: 'dev server', task: { id: 'SYT-30' } })
    expect(sessionKind('preview-SYT-3~api', tasks)).toMatchObject({ kind: 'dev server', label: 'dev server (api)', task: { id: 'SYT-3' } })
    expect(sessionKind('SYT-30-shell-2', tasks)).toMatchObject({ kind: 'shell', label: 'shell 2', task: { id: 'SYT-30' } })
    expect(sessionKind('tests-SYT-9', tasks)).toMatchObject({ kind: 'tests', task: null })
    expect(sessionKind('something', tasks)).toMatchObject({ kind: 'terminal', task: null })
  })
})

describe('shortCmd', () => {
  it('names the program and shortens long paths', () => {
    expect(shortCmd('"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\me\\AppData\\Local\\Temp\\work\\proctest\\child.js --port 5')).toBe('node …/proctest/child.js --port 5')
    expect(shortCmd('/usr/local/bin/node server.js')).toBe('node server.js')
    expect(shortCmd('npm run dev')).toBe('npm run dev')
    expect(shortCmd('node ./src/a.js')).toBe('node ./src/a.js')
  })
})

describe('formatMem', () => {
  it('shows MB, or GB past a gigabyte', () => {
    expect(formatMem(48 * 1024 ** 2)).toBe('48 MB')
    expect(formatMem(100)).toBe('1 MB')
    expect(formatMem(0)).toBe('0 MB')
    expect(formatMem(1.5 * 1024 ** 3)).toBe('1.5 GB')
  })
})
