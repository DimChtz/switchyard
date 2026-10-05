import { exec } from 'child_process'
import { promisify } from 'util'
import { access, constants } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { AgentKind } from '@shared/types'
import { AGENTS } from '@shared/constants'

const execAsync = promisify(exec)

/** The program behind an agent (AGENTS includes those plugins add, so it's looked up each time). */
const agentBin = (kind: AgentKind): string | undefined => AGENTS.find((a) => a.kind === kind)?.bin

// Common install locations for these CLIs that may not yet be on this
// process's inherited PATH - Windows in particular often doesn't propagate a
// PATH change made by an installer to processes (or even "new" terminals
// spawned from an already-running shell/Explorer session) until a full
// logoff or reboot, well after the CLI is genuinely installed and working
// from the user's own fresh terminal.
function fallbackDirs(): string[] {
  const home = homedir()
  return [join(home, '.local', 'bin'), join(home, 'AppData', 'Roaming', 'npm')]
}

async function isOnPath(bin: string): Promise<boolean> {
  const cmd = process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`
  try {
    await execAsync(cmd)
    return true
  } catch {
    return false
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Resolves a CLI to an invocable command: the bare name if it's on PATH (let
 * the shell handle PATHEXT/shims), otherwise an absolute path if found in a
 * known fallback install location, otherwise null if it's genuinely missing. */
export async function resolveBin(kind: AgentKind): Promise<string | null> {
  const bin = agentBin(kind)
  if (!bin) return null
  if (await isOnPath(bin)) return bin
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']
  for (const dir of fallbackDirs()) {
    for (const ext of exts) {
      const candidate = join(dir, bin + ext)
      if (await fileExists(candidate)) return candidate
    }
  }
  return null
}

const versionCache = new Map<AgentKind, string | null>()

// Short "v2.1"-style version for display, read from `<bin> --version`.
// Cached per app run - the CLIs are slow to boot and versions rarely
// change under a running app.
export async function getVersion(kind: AgentKind): Promise<string | null> {
  if (versionCache.has(kind)) return versionCache.get(kind)!
  const bin = await resolveBin(kind)
  let version: string | null = null
  if (bin) {
    try {
      const { stdout } = await execAsync(`"${bin}" --version`, { timeout: 8000, windowsHide: true })
      const m = stdout.match(/(\d+)\.(\d+)/)
      if (m) version = `v${m[1]}.${m[2]}`
    } catch {
      // installed but --version failed; leave unknown
    }
  }
  versionCache.set(kind, version)
  return version
}

export async function detectInstalled(): Promise<Record<AgentKind, boolean>> {
  const entries = await Promise.all(
    AGENTS.map((a) => a.kind).map(async (kind) => [kind, (await resolveBin(kind)) !== null] as const)
  )
  return Object.fromEntries(entries) as Record<AgentKind, boolean>
}
