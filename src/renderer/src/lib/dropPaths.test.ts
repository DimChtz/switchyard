import { describe, expect, it } from 'vitest'
import { pathStyleFor, pathsForTerminal } from './dropPaths'

describe('dropping files on a terminal', () => {
  it("writes them relative to the terminal's folder when inside it", () => {
    expect(pathsForTerminal(['C:\\wt\\SYT-5\\src\\app.ts'], 'C:\\wt\\SYT-5', 'win')).toBe('src\\app.ts ')
    expect(pathsForTerminal(['c:/WT/syt-5/src'], 'C:\\wt\\SYT-5', 'win')).toBe('src ')
    expect(pathsForTerminal(['/home/me/p/a.ts', '/home/me/p/b c.ts'], '/home/me/p', 'posix')).toBe("a.ts 'b c.ts' ")
  })

  it('quotes and converts paths outside it for each shell', () => {
    expect(pathsForTerminal(['D:\\My Files\\x.txt'], 'C:\\wt', 'win')).toBe('"D:\\My Files\\x.txt" ')
    expect(pathsForTerminal(['D:\\My Files\\x.txt'], 'C:\\wt', 'msys')).toBe("'/d/My Files/x.txt' ")
    expect(pathsForTerminal(['D:\\data\\x.txt'], 'C:\\wt', 'wsl')).toBe('/mnt/d/data/x.txt ')
    expect(pathsForTerminal(["/tmp/it's"], '/home', 'posix')).toBe("'/tmp/it'\\''s' ")
  })

  it("tells the shell's style from its program", () => {
    expect(pathStyleFor('C:\\Program Files\\Git\\bin\\bash.exe', 'win32')).toBe('msys')
    expect(pathStyleFor('wsl:Ubuntu', 'win32')).toBe('wsl')
    expect(pathStyleFor('C:\\Windows\\System32\\wsl.exe', 'win32')).toBe('wsl')
    expect(pathStyleFor('pwsh', 'win32')).toBe('win')
    expect(pathStyleFor(undefined, 'win32')).toBe('win')
    expect(pathStyleFor('pwsh', 'darwin')).toBe('posix')
  })
})
