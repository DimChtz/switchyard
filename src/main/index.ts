import { app, dialog, screen, session, shell, BrowserWindow, type WebContents } from 'electron'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { init as initPlugins, openedWith } from './services/plugins'
import { buildMenu } from './menu'
import { clearLegacyPrefs, closeStore, getPrefs, getProjects, getWindowBounds, legacyPrefs, removeDemoData, setPrefs, setWindowBounds, type WindowBounds } from './services/store'
import { catchCrashes, log } from './services/log'
import { loadShellPath } from './services/shellEnv'
import { initUserSettings, watchProjectSettings, watchUserSettings } from './services/settings'
import { startupTheme, watchThemes } from './services/themes'
import { killAll as killAllPty, runningAgents } from './services/pty'
import { SMOKE, runSmoke, smokeDataFolder } from './smoke'

if (is.dev && process.env['SWITCHYARD_DEBUG_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['SWITCHYARD_DEBUG_PORT'])
}
// Dev only: a separate data folder (store, window state, instance lock), so a
// second copy can run next to the everyday one without sharing its data.
if (is.dev && process.env['SWITCHYARD_USER_DATA']) {
  app.setPath('userData', process.env['SWITCHYARD_USER_DATA'])
}
// --smoke-test (CI): a throwaway data folder, then a check of the whole app - see smoke.ts.
smokeDataFolder()

// One copy at a time: two would share the store file and both run the
// worktree cleanup. Starting it again brings the open window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
    // A plugin package double-clicked while Switchyard runs (Windows, Linux).
    for (const p of packagesIn(argv)) openedWith(p)
  })
  // The same on macOS (it can come before the app is ready).
  app.on('open-file', (e, path) => {
    if (!path.toLowerCase().endsWith('.syplugin')) return
    e.preventDefault()
    if (app.isReady()) openedWith(path)
    else app.whenReady().then(() => setTimeout(() => openedWith(path), 0))
  })
  start()
}

/** The plugin packages among the arguments the app was started with. */
function packagesIn(argv: string[]): string[] {
  return argv.slice(1).filter((a) => !a.startsWith('-') && a.toLowerCase().endsWith('.syplugin'))
}

/** The saved window bounds, if they still fit on a connected screen. */
function savedBounds(): WindowBounds | null {
  const b = getWindowBounds()
  if (!b) return null
  const visible = screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 10 && b.y < a.y + a.height - 100)
  return visible ? b : null
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const bounds = savedBounds()
  // The page applies the theme; until then the window's background and title bar match it.
  const theme = startupTheme()

  const mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 900,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    // Fits a 1080p laptop at 150% scaling (1280×720 to draw in).
    minWidth: 1100,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    // Windows/Linux only: draws the native minimize/maximize/close buttons
    // inside our frameless window instead of a second OS title bar - same
    // approach VS Code uses. macOS gets native traffic lights for free from
    // titleBarStyle: 'hiddenInset' and doesn't support/need this option.
    ...(isMac ? {} : { titleBarOverlay: { color: theme.colors['bg-chrome'], symbolColor: theme.colors.t2, height: 36 } }),
    backgroundColor: theme.colors['bg-app'],
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  // Quitting stops every agent - check first (a setting in General).
  let confirmedClose = false
  mainWindow.on('close', (e) => {
    const running = runningAgents()
    if (confirmedClose || !running || !getPrefs().confirmQuit) return
    e.preventDefault()
    dialog
      .showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `${running} agent${running > 1 ? 's are' : ' is'} still running`,
        detail: 'Quitting stops them. Their worktrees and branches are kept, and you can resume them later.',
        checkboxLabel: "Don't ask again"
      })
      .then(({ response, checkboxChecked }) => {
        if (response !== 0) return
        if (checkboxChecked) setPrefs({ confirmQuit: false })
        confirmedClose = true
        mainWindow.close()
      })
  })

  mainWindow.on('ready-to-show', () => {
    if (bounds?.maximized) mainWindow.maximize()
    mainWindow.show()
  })

  // Remember size and position (the normal bounds when maximized).
  let saveTimer: NodeJS.Timeout | null = null
  const saveBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isFullScreen()) return
      setWindowBounds({ ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() })
    }, 400)
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)
  mainWindow.on('maximize', saveBounds)
  mainWindow.on('unmaximize', saveBounds)

  // The page holds back closing while files have unsaved edits: ask.
  mainWindow.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Some files have unsaved edits',
      detail: "They're open in a task's Files tab. Closing loses them."
    })
    if (choice === 0) e.preventDefault()
  })

  // The app's own page never navigates (a file dropped outside a drop zone
  // would otherwise replace it); links open in the browser.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow.webContents.getURL()) e.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

/** Only web pages leave the app, in the browser - not file: or other schemes a page could ask for. */
function openOutside(url: string): void {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch((err) => log.warn('main', `Could not open ${url}`, err))
}

/**
 * Every page and webview: new windows become browser tabs (web pages only),
 * and the dev-server preview's <webview> gets no preload, no Node and a
 * session of its own - whatever it loads can't reach Switchyard.
 */
function guardContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  contents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.nodeIntegrationInSubFrames = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    prefs.webSecurity = true
    params.partition = PREVIEW_PARTITION
    if (!/^(https?:|about:blank)/i.test(params.src || 'about:blank')) e.preventDefault()
  })
}

const PREVIEW_PARTITION = 'persist:preview'

/** Pages ask for camera, location…: the preview gets only what a dev site reasonably needs; Switchyard's page needs none of it. */
function limitPermissions(): void {
  const previewOk = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock'])
  session.fromPartition(PREVIEW_PARTITION).setPermissionRequestHandler((_wc, permission, done) => done(previewOk.has(permission)))
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'clipboard-sanitized-write' || permission === 'fullscreen'))
}

function start(): void {
  catchCrashes()
  app.on('web-contents-created', (_e, contents) => guardContents(contents))
  app.on('will-quit', () => closeStore())
  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.switchyard.app')
    log.info('main', `Switchyard ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform})`)
    // Before anything looks for agent CLIs, git or gh: the PATH a terminal has.
    await loadShellPath()
    limitPermissions()

    // F12 opens developer tools too, in packaged builds as well (like VS
    // Code's Help > Toggle Developer Tools) - the toolkit's shortcut watcher
    // blocks them outside dev, so it isn't used.
    app.on('browser-window-created', (_, window) => {
      window.webContents.on('before-input-event', (_e, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') window.webContents.toggleDevTools()
      })
    })

    removeDemoData()
    // Preferences live in settings.json (moved there from the store once).
    initUserSettings(legacyPrefs(), clearLegacyPrefs)
    watchUserSettings()
    watchThemes()
    watchProjectSettings(getProjects())
    buildMenu()
    registerIpcHandlers()
    // Before the window: its agents list includes the plugins' ones.
    initPlugins()
    const win = createWindow()
    if (SMOKE) return runSmoke(win)
    // Started by double-clicking a plugin package (Windows, Linux): Settings asks to install it.
    for (const p of packagesIn(process.argv)) openedWith(p)

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    killAllPty()
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
