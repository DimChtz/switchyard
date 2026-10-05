import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { log } from './log'

/**
 * On macOS and Linux an app started from the Dock, Finder or a launcher
 * doesn't get the PATH your terminal has (Homebrew, npm's global folder,
 * nvm…), so `claude`, `codex`, `gh` and `node` wouldn't be found. This asks
 * your login shell for its PATH once at start, and adds the usual install
 * folders that exist. Windows passes PATH on already.
 */
export async function loadShellPath(): Promise<void> {
  if (process.platform === 'win32') return
  const fromShell = await shellPath().catch((err) => {
    log.warn('env', 'Could not read the login shell PATH', err)
    return ''
  })
  const home = homedir()
  const usual = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', join(home, '.local', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin'), join(home, '.volta', 'bin'), join(home, '.cargo', 'bin')]
  const parts = [...(process.env.PATH ?? '').split(delimiter), ...fromShell.split(delimiter), ...usual.filter((d) => existsSync(d))]
  process.env.PATH = [...new Set(parts.filter(Boolean))].join(delimiter)
}

const MARK = '__SWITCHYARD_PATH__'

function shellPath(): Promise<string> {
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return new Promise((resolve, reject) => {
    // -i -l: the same startup files a terminal runs (where nvm, Homebrew and friends set PATH).
    execFile(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], { timeout: 4000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } }, (err, stdout) => {
      const m = stdout?.match(new RegExp(`${MARK}(.*)${MARK}`))
      if (m) return resolve(m[1])
      reject(err ?? new Error('no PATH in the shell output'))
    })
  })
}
