import { existsSync, readFileSync, statSync } from 'fs'
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'path'

/**
 * Starting an agent CLI on Windows. npm installs them as .cmd shims, which
 * only cmd.exe can run - and cmd.exe ends a command line at the first
 * newline (a multi-line first message lost everything after its first
 * line, flags included), expands %VARIABLES% and caps the line at 8191
 * characters. So the shim is read for what it really runs - `node
 * <script>` or an .exe - and that's started directly, arguments intact.
 */

export interface Launch {
  file: string
  args: string[]
  /** Goes through cmd.exe (an unknown .cmd/.bat): newlines in arguments can't survive. */
  viaCmd: boolean
}

const exts = (): string[] => (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase()).filter(Boolean)

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** The file a command name runs, as cmd.exe would find it on PATH (null: not found). */
export function findOnPath(cmd: string, pathVar = process.env.PATH ?? ''): string | null {
  const withExt = extname(cmd) ? [cmd] : exts().map((e) => cmd + e)
  if (isAbsolute(cmd) || cmd.includes('\\') || cmd.includes('/')) return withExt.find(isFile) ?? (isFile(cmd) ? cmd : null)
  for (const dir of pathVar.split(delimiter).filter(Boolean)) {
    for (const name of withExt) {
      const p = join(dir, name)
      if (isFile(p)) return p
    }
  }
  return null
}

/**
 * What an npm/cmd-shim .cmd file runs: `"%dp0%\node_modules\…\cli.js" %*`
 * (with node), or an .exe. Null when it isn't such a shim.
 */
export function shimTarget(shimPath: string, content: string): { program: string; script: string | null } | null {
  const m = content.match(/"%~?dp0%?\\?([^"]+?)"\s+%\*/)
  if (!m) return null
  const target = resolve(dirname(shimPath), m[1])
  if (/\.exe$/i.test(target)) return existsSync(target) ? { program: target, script: null } : null
  if (!/\.(c|m)?js$/i.test(target) || !existsSync(target)) return null
  const bundledNode = join(dirname(shimPath), 'node.exe')
  const node = existsSync(bundledNode) ? bundledNode : findOnPath('node')
  return node ? { program: node, script: target } : null
}

/** How to start `cmd args` on Windows without cmd.exe in between when possible. */
export function windowsLaunch(cmd: string, args: string[]): Launch {
  const found = findOnPath(cmd)
  if (found && /\.(exe|com)$/i.test(found)) return { file: found, args, viaCmd: false }
  if (found && /\.(cmd|bat)$/i.test(found)) {
    try {
      const t = shimTarget(found, readFileSync(found, 'utf-8'))
      if (t) return { file: t.program, args: t.script ? [t.script, ...args] : args, viaCmd: false }
    } catch {
      // unreadable - cmd.exe runs it
    }
  }
  // cmd.exe it is: one line only.
  return { file: process.env.COMSPEC || 'cmd.exe', args: ['/c', cmd, ...args.map((a) => a.replace(/\s*\r?\n\s*/g, ' '))], viaCmd: true }
}
