import { app, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { log } from './log'

/**
 * Updates for the installed app (electron-updater): checked at start and
 * every few hours, downloaded in the background, installed when Switchyard
 * quits. Needs a release channel - `publish` in electron-builder.yml - which
 * the build writes into app-update.yml; without one, checking says so.
 */

const EVERY = 6 * 60 * 60 * 1000
let ready: string | null = null

function configured(): boolean {
  return existsSync(join(process.resourcesPath, 'app-update.yml'))
}

function tell(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

export function startUpdates(): void {
  if (!app.isPackaged || !configured()) return
  autoUpdater.logger = { info: (m: unknown) => log.info('updates', String(m)), warn: (m: unknown) => log.warn('updates', String(m)), error: (m: unknown) => log.error('updates', String(m)), debug: () => {} }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    ready = info.version
    tell('updates:ready', info.version)
  })
  const check = (): void => void autoUpdater.checkForUpdates().catch((err) => log.warn('updates', 'Update check failed', err))
  setTimeout(check, 60_000)
  setInterval(check, EVERY)
}

/** Help → Check for updates. */
export async function checkNow(): Promise<{ message: string }> {
  if (!app.isPackaged) return { message: 'Updates come to the installed app - this is a development build.' }
  if (!configured()) return { message: 'This build has no update channel (publish in electron-builder.yml).' }
  if (ready) return { message: `Switchyard ${ready} is downloaded - it installs when you quit.` }
  const r = await autoUpdater.checkForUpdates()
  const latest = r?.updateInfo.version
  if (!latest || latest === app.getVersion()) return { message: `Switchyard ${app.getVersion()} is the latest version.` }
  return { message: `Downloading Switchyard ${latest} - it installs when you quit.` }
}

/** Quit now and install the downloaded update. */
export function installNow(): void {
  if (ready) autoUpdater.quitAndInstall()
}
