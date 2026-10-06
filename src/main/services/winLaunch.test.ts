import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { findOnPath, shimTarget } from './winLaunch'

const dir = mkdtempSync(join(tmpdir(), 'sy-win-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// What npm's cmd-shim writes for a package's bin.
const NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@acme\\agent\\cli.js" %*
`

// Shims are read only on Windows: their paths ("%dp0%\node.exe") are Windows paths.
const onWindows = process.platform === 'win32'

describe('Windows launch', () => {
  it.runIf(onWindows)("finds the script an npm shim runs (with the node.exe beside it when there's one)", () => {
    mkdirSync(join(dir, 'node_modules', '@acme', 'agent'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', '@acme', 'agent', 'cli.js'), '')
    writeFileSync(join(dir, 'node.exe'), '')
    const t = shimTarget(join(dir, 'agent.cmd'), NPM_SHIM)
    expect(t).toEqual({ program: join(dir, 'node.exe'), script: join(dir, 'node_modules', '@acme', 'agent', 'cli.js') })
  })

  it.runIf(onWindows)('runs an .exe a shim points to directly', () => {
    mkdirSync(join(dir, 'bin'), { recursive: true })
    writeFileSync(join(dir, 'bin', 'tool.exe'), '')
    expect(shimTarget(join(dir, 'tool.cmd'), '@"%~dp0\\bin\\tool.exe" %*')).toEqual({ program: join(dir, 'bin', 'tool.exe'), script: null })
  })

  it('leaves other batch files to cmd.exe', () => {
    expect(shimTarget(join(dir, 'x.cmd'), '@echo off\r\necho hi %*\r\n')).toBeNull()
  })

  it('finds a command on PATH with PATHEXT', () => {
    mkdirSync(join(dir, 'p1'), { recursive: true })
    writeFileSync(join(dir, 'p1', 'agent.cmd'), '')
    const old = process.env.PATHEXT
    process.env.PATHEXT = '.EXE;.CMD'
    try {
      expect(findOnPath('agent', join(dir, 'p1'))?.toLowerCase()).toBe(join(dir, 'p1', 'agent.cmd').toLowerCase())
      expect(findOnPath('nothing', join(dir, 'p1'))).toBeNull()
    } finally {
      process.env.PATHEXT = old
    }
  })
})
