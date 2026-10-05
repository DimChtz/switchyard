import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { execFile } from 'child_process'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/types'
import { log } from './log'

/**
 * Updates for the installed app (electron-updater): checked at start and
 * every few hours, downloaded in the background, installed when Switchyard
 * quits (or right away, from the status bar). Needs a release channel -
 * `publish` in electron-builder.yml - which the build writes into
 * app-update.yml; without one, checking says so.
 *
 * A Mac build that isn't signed with a Developer ID can't install updates
 * itself (macOS refuses): it says a new version is out, with its download page.
 */

const EVERY = 6 * 60 * 60 * 1000
let state: UpdateState | null = null
/** Development's stand-in update (SWITCHYARD_FAKE_UPDATE): nothing to install. */
let fakeMode = false

function updateFile(): string {
  return join(process.resourcesPath, 'app-update.yml')
}

function configured(): boolean {
  return existsSync(updateFile())
}

/** The release's page on GitHub (the owner and repository the build was published to). */
function releaseUrl(version: string): string {
  try {
    const yml = readFileSync(updateFile(), 'utf-8')
    const owner = yml.match(/^owner:\s*(\S+)/m)?.[1]
    const repo = yml.match(/^repo:\s*(\S+)/m)?.[1]
    if (owner && repo) return `https://github.com/${owner}/${repo}/releases/tag/v${version}`
  } catch {
    // (no channel)
  }
  return 'https://github.com/DimChtz/switchyard/releases/latest'
}

/** Whether this build can install an update itself: everywhere but a Mac build without a Developer ID signature. */
let installable: Promise<boolean> | null = null
function canInstall(): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(true)
  installable ??= new Promise((done) => {
    const bundle = resolve(process.execPath, '../../..')
    execFile('codesign', ['-dv', '--verbose=2', bundle], (err, _out, info) => done(!err && /Authority=Developer ID Application/.test(String(info))))
  })
  return installable
}

function setState(next: UpdateState): void {
  if (state && state.kind === next.kind && state.version === next.version) return
  state = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('updates:state', state)
}

export function startUpdates(): void {
  // Development: SWITCHYARD_FAKE_UPDATE=ready:0.2.0 (or available:0.2.0) shows how it looks.
  const fake = !app.isPackaged ? process.env['SWITCHYARD_FAKE_UPDATE']?.match(/^(ready|available):(.+)$/) : null
  if (fake) {
    fakeMode = true
    setTimeout(() => setState({ kind: fake[1] as UpdateState['kind'], version: fake[2], url: releaseUrl(fake[2]) }), 3000)
    return
  }
  if (!app.isPackaged || !configured()) return
  autoUpdater.logger = { info: (m: unknown) => log.info('updates', String(m)), warn: (m: unknown) => log.warn('updates', String(m)), error: (m: unknown) => log.error('updates', String(m)), debug: () => {} }
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => setState({ kind: 'ready', version: info.version, url: releaseUrl(info.version) }))
  autoUpdater.on('update-available', (info) => {
    canInstall().then((ok) => {
      if (!ok) setState({ kind: 'available', version: info.version, url: releaseUrl(info.version) })
    })
  })
  canInstall().then((ok) => {
    // Can't install it: don't download it either.
    autoUpdater.autoDownload = ok
    const check = (): void => void autoUpdater.checkForUpdates().catch((err) => log.warn('updates', 'Update check failed', err))
    setTimeout(check, 60_000)
    setInterval(check, EVERY)
  })
}

/** What there is: an update downloaded and ready, or one to download by hand; null when up to date (or not known yet). */
export function status(): UpdateState | null {
  return state
}

/** Help → Check for updates. */
export async function checkNow(): Promise<{ message: string }> {
  if (!app.isPackaged) return { message: 'Updates come to the installed app - this is a development build.' }
  if (!configured()) return { message: 'This build has no update channel (publish in electron-builder.yml).' }
  if (state?.kind === 'ready') return { message: `Switchyard ${state.version} is downloaded - restart to install it.` }
  const r = await autoUpdater.checkForUpdates()
  const latest = r?.updateInfo.version
  if (!latest || latest === app.getVersion()) return { message: `Switchyard ${app.getVersion()} is the latest version.` }
  if (!(await canInstall())) return { message: `Switchyard ${latest} is out - download it from its release page (status bar).` }
  return { message: `Downloading Switchyard ${latest} - it installs when you quit.` }
}

/** Quit now and install the downloaded update. */
export function installNow(): void {
  if (fakeMode) return log.info('updates', 'Restart and install (a stand-in update - nothing happens)')
  if (state?.kind === 'ready') autoUpdater.quitAndInstall()
}
