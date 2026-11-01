import { BrowserWindow, clipboard, globalShortcut, ipcMain, nativeImage, screen, app } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'
import type { CaptureClip, CaptureShow, CaptureSubmit } from '@shared/types'
import { getPrefs, getProjects } from './store'
import { getKv, setKv } from './db'
import { onUserPrefsChanged } from './settings'
import { deliver } from '../cli'
import { startupTheme } from './themes'
import { log } from './log'

/**
 * Quick capture: a global shortcut (Settings → General) opens a small box over
 * whatever you're doing - type (or dictate) what's on your mind, and it's a
 * task on the board, without Switchyard coming to the front. What's on the
 * clipboard (a screenshot, an error, a link) is offered to attach.
 */

let win: BrowserWindow | null = null
let registered: { key: string; ok: boolean } = { key: '', ok: false }
// What the box shows now - the page asks for it once it's up (the first open comes before it listens).
let current: CaptureShow | null = null

function make(): BrowserWindow {
  const theme = startupTheme()
  const w = new BrowserWindow({
    width: 620,
    height: 180,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: theme.colors['bg-panel'] ?? theme.colors['bg-app'],
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  w.setAlwaysOnTop(true, 'floating')
  w.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true })
  // Clicking elsewhere puts it away (not while its developer tools are open).
  w.on('blur', () => {
    if (!w.webContents.isDevToolsOpened()) w.hide()
  })
  const url = is.dev && process.env['ELECTRON_RENDERER_URL'] ? `${process.env['ELECTRON_RENDERER_URL']}#capture` : null
  if (url) w.loadURL(url)
  else w.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'capture' })
  w.on('closed', () => {
    if (win === w) win = null
  })
  return w
}

/** What's on the clipboard worth attaching: an image (a screenshot), else some text. */
async function clipboardNow(): Promise<CaptureClip> {
  try {
    for (const item of await clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (!type) continue
      const blob = (await item.getType(type)) as Blob
      const img = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
      if (img.isEmpty()) continue
      // (Big screenshots made smaller: a task needs to show, not archive, them.)
      const small = img.getSize().width > 1600 ? img.resize({ width: 1600 }) : img
      return { image: small.toDataURL(), text: null }
    }
  } catch {
    // nothing readable
  }
  const text = (await clipboard.readText().catch(() => '')).trim()
  return { image: null, text: text ? text.slice(0, 4000) : null }
}

/** Opens the box - with what's on the clipboard, or `clip` (the window's own "Quick capture", tests). */
export async function showCapture(clip?: CaptureClip): Promise<void> {
  win ??= make()
  const w = win
  const got = clip ?? (await clipboardNow())
  const send = (): void => {
    const projects = getProjects().map((p) => ({ id: p.id, name: p.name }))
    const last = getKv<string>('captureProject')
    const payload: CaptureShow = { clip: got, projects, projectId: projects.some((p) => p.id === last) ? last! : (projects[0]?.id ?? null) }
    current = payload
    w.webContents.send(IPC.captureShow, payload)
    // Over the screen the pointer is on, a third of the way down.
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const [width] = w.getSize()
    w.setPosition(Math.round(d.x + (d.width - width) / 2), Math.round(d.y + d.height * 0.28))
    w.show()
    w.focus()
  }
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send)
  else send()
}

/** Puts in the shortcut set in Settings (none: off). Says whether the system let it. */
export function registerCaptureKey(): void {
  const key = (getPrefs().quickCaptureKey ?? '').trim()
  if (registered.key === key && registered.ok) return
  if (registered.key) globalShortcut.unregister(registered.key)
  registered = { key, ok: false }
  if (!key) return
  try {
    registered.ok = globalShortcut.register(key, () => void showCapture())
    if (!registered.ok) log.warn('capture', `The quick capture shortcut ${key} is taken by another app`)
  } catch (err) {
    log.warn('capture', `Not a shortcut: ${key}`, err)
  }
}

export function registerCapture(): void {
  ipcMain.handle(IPC.captureOpen, (_e, clip?: CaptureClip) => showCapture(clip ?? undefined))
  ipcMain.handle(IPC.captureHide, () => win?.hide())
  ipcMain.handle(IPC.captureCurrent, () => current)
  ipcMain.handle(IPC.captureResize, (_e, height: number) => {
    if (win && Number.isFinite(height)) win.setSize(win.getSize()[0], Math.max(120, Math.min(560, Math.round(height))))
  })
  ipcMain.handle(IPC.captureStatus, () => ({ key: registered.key, ok: registered.ok }))
  // The task: to the main window, quietly (it doesn't come to the front).
  ipcMain.handle(IPC.captureSubmit, async (_e, s: CaptureSubmit) => {
    const title = String(s?.title ?? '').trim()
    if (!title) return
    let desc = String(s.desc ?? '').trim()
    if (s.text) desc = `${desc ? `${desc}\n\n` : ''}\`\`\`\n${String(s.text).slice(0, 4000)}\n\`\`\``
    // A screenshot: kept where agents can read it, and named in the task.
    const m = typeof s.image === 'string' ? /^data:image\/(png|jpe?g);base64,(.+)$/.exec(s.image) : null
    if (m) {
      const dir = join(app.getPath('userData'), 'attachments')
      await mkdir(dir, { recursive: true })
      const file = join(dir, `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`)
      await writeFile(file, Buffer.from(m[2], 'base64'))
      desc = `${desc ? `${desc}\n\n` : ''}Images (open and look at them): ${file}`
    }
    if (s.projectId) setKv('captureProject', s.projectId)
    win?.hide()
    deliver({ title: title.slice(0, 200), desc, agent: null, start: !!s.start, projectId: s.projectId ?? null, quiet: true })
  })
  registerCaptureKey()
  onUserPrefsChanged(registerCaptureKey)
  app.on('will-quit', () => globalShortcut.unregisterAll())
}

/** The box goes with the main window (else the app wouldn't quit with it closed). */
export function closeCaptureWith(main: BrowserWindow): void {
  main.on('closed', () => {
    win?.destroy()
    win = null
  })
}

