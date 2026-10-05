import { exec, execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join, normalize } from 'path'
import { homedir } from 'os'
import { BrowserWindow, Notification, clipboard, shell } from 'electron'
import { getPrefs } from './store'
import type { EditorOption, NotifyAction, ShellOption } from '@shared/types'
import { IPC } from '@shared/ipc'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

async function onPath(bin: string): Promise<boolean> {
  try {
    await execAsync(process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`, { windowsHide: true })
    return true
  } catch {
    return false
  }
}

let shellCache: ShellOption[] | null = null

/**
 * Terminal profiles found on this machine (VS Code's terminal profiles):
 * PowerShell 7, Windows PowerShell, Command Prompt, Git Bash and each WSL
 * distribution on Windows; zsh, bash and fish elsewhere.
 */
export async function shells(): Promise<ShellOption[]> {
  if (shellCache) return shellCache
  const list: ShellOption[] = []
  if (process.platform === 'win32') {
    if (await onPath('pwsh')) list.push({ id: 'pwsh', label: 'PowerShell 7', path: 'pwsh.exe', args: ['-NoLogo'] })
    list.push({ id: 'powershell', label: 'Windows PowerShell', path: 'powershell.exe', args: ['-NoLogo'] })
    list.push({ id: 'cmd', label: 'Command Prompt', path: process.env.COMSPEC || 'cmd.exe' })
    const local = process.env.LOCALAPPDATA ?? ''
    const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe', join(local, 'Programs', 'Git', 'bin', 'bash.exe'), join(homedir(), 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe')].find(
      (p) => p && existsSync(p)
    )
    if (gitBash) list.push({ id: 'gitbash', label: 'Git Bash', path: gitBash, args: ['--login', '-i'] })
    for (const distro of await wslDistros()) list.push({ id: `wsl:${distro}`, label: `${distro} (WSL)`, path: 'wsl.exe', args: ['-d', distro] })
  } else {
    for (const name of ['zsh', 'bash', 'fish']) {
      const found = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'].map((d) => `${d}/${name}`).find((p) => existsSync(p))
      if (found) list.push({ id: name, label: name, path: found, args: name === 'fish' ? ['-l'] : ['-l'] })
    }
  }
  shellCache = list
  return list
}

/** WSL distributions (wsl.exe -l -q prints UTF-16). */
async function wslDistros(): Promise<string[]> {
  if (!existsSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe'))) return []
  try {
    const { stdout } = await execFileAsync('wsl.exe', ['-l', '-q'], { encoding: 'buffer', windowsHide: true, timeout: 4000 })
    return stdout
      .toString('utf16le')
      .split(/\r?\n/)
      .map((l) => l.replace(/\0/g, '').trim())
      .filter((l) => l && !/docker-desktop/i.test(l))
  } catch {
    return []
  }
}

/** A profile by its id (or path) - what the Default profile setting holds. */
export function profileFor(value: string): ShellOption | null {
  if (!value) return null
  return (shellCache ?? []).find((s) => s.id === value || s.path === value) ?? null
}

const EDITORS: EditorOption[] = [
  { label: 'VS Code', bin: 'code' },
  { label: 'Cursor', bin: 'cursor' },
  { label: 'Zed', bin: 'zed' },
  { label: 'Windsurf', bin: 'windsurf' }
]

let editorCache: EditorOption[] | null = null

export async function editors(): Promise<EditorOption[]> {
  if (!editorCache) {
    const found = await Promise.all(EDITORS.map(async (e) => ((await onPath(e.bin)) ? e : null)))
    editorCache = found.filter((e): e is EditorOption => e !== null)
  }
  return editorCache
}

export async function openInEditor(path: string): Promise<string> {
  const list = await editors()
  const pref = getPrefs(path).editor
  const editor = list.find((e) => e.bin === pref) ?? list[0]
  if (!editor) throw new Error('No editor found - install VS Code, Cursor or Zed, or pick one in Settings')
  // Editor launchers are .cmd shims on Windows, so that goes through cmd
  // (which takes arguments as written - hence the quotes; a Windows path
  // can't contain one). Elsewhere it's started directly: through a shell, a
  // file named $(…) in the repository would run as a command.
  if (process.platform === 'win32' && path.includes('"')) throw new Error('That path has a quote in it')
  const child =
    process.platform === 'win32'
      ? spawn(editor.bin, [`"${path}"`], { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
      : spawn(editor.bin, [path], { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
  return editor.label
}

/** Opens the system terminal in a folder (Windows Terminal when installed). */
export async function openTerminal(path: string): Promise<void> {
  if (!existsSync(path)) throw new Error(`${path} doesn't exist`)
  const detach = { cwd: path, detached: true, stdio: 'ignore' as const }
  let child
  if (process.platform === 'win32') {
    child = (await onPath('wt')) ? spawn('wt.exe', ['-d', path], detach) : spawn(process.env.COMSPEC || 'cmd.exe', ['/c', 'start', 'cmd.exe'], { ...detach, windowsHide: true })
  } else if (process.platform === 'darwin') {
    child = spawn('open', ['-a', 'Terminal', path], detach)
  } else {
    child = spawn('x-terminal-emulator', [], detach)
  }
  child.on('error', () => {})
  child.unref()
}

/** Opens a folder in the file manager, or a file with its default app. */
export async function reveal(path: string): Promise<void> {
  const err = await shell.openPath(normalize(path))
  if (err) throw new Error(err)
}

/** Shows the file manager at the item's folder, with the item selected. */
export function showItem(path: string): void {
  // git gives Windows paths with "/" - Explorer only selects the item with "\".
  const p = normalize(path)
  if (!existsSync(p)) throw new Error(`${p} doesn't exist`)
  shell.showItemInFolder(p)
}

export function copyText(text: string): void {
  clipboard.writeText(text)
}

/**
 * A system notification (when enabled in Settings). Clicking it brings the
 * window forward and tells the page which task it was about.
 */
// Shown notifications, kept until clicked or closed: one nothing holds on to
// can be garbage-collected, and its click then does nothing (Windows).
const shown = new Set<Notification>()

export function notify(title: string, body: string, taskId: string | null, actions: NotifyAction[] = []): void {
  if (!Notification.isSupported()) return
  // Buttons (Windows and macOS; Linux shows none - a click still opens the task).
  const buttons = taskId && process.platform !== 'linux' ? actions : []
  const n = new Notification({ title, body, silent: !getPrefs().sound, actions: buttons.map((a) => ({ type: 'button' as const, text: a.label })) })
  // A button answers without bringing the window forward (Approve from anywhere).
  n.on('action', (details) => {
    forget()
    const a = buttons[details.actionIndex]
    const win = BrowserWindow.getAllWindows()[0]
    if (a && win && taskId) win.webContents.send(IPC.appNotifyAction, taskId, a.id)
  })
  shown.add(n)
  const forget = (): void => void shown.delete(n)
  n.on('close', forget)
  n.on('failed', forget)
  // At most a day's worth, should a system never say they closed.
  setTimeout(forget, 24 * 60 * 60 * 1000)
  n.on('click', () => {
    forget()
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (taskId) win.webContents.send(IPC.appOpenTask, taskId)
  })
  n.show()
}
