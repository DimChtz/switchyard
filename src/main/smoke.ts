import { app, type BrowserWindow } from 'electron'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { exists, getBuffer, kill, spawn } from './services/pty'

/**
 * `Switchyard --smoke-test`: the packaged app, checked end to end in CI. It
 * starts with an empty data folder of its own (never yours), waits for the
 * page to render, runs a real terminal (the native pty module) and quits:
 * exit 0 when all of it worked, 1 with the reason when it didn't.
 */
export const SMOKE = process.argv.includes('--smoke-test')

/** Before anything opens the data folder: a fresh one in the temp folder. */
export function smokeDataFolder(): void {
  if (SMOKE) app.setPath('userData', mkdtempSync(join(tmpdir(), 'switchyard-smoke-')))
}

const TIMEOUT_MS = 90_000

export function runSmoke(win: BrowserWindow): void {
  const fail = (why: string): void => {
    console.error(`SMOKE FAIL: ${why}`)
    app.exit(1)
  }
  const timer = setTimeout(() => fail(`not done within ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS)
  win.webContents.on('render-process-gone', (_e, d) => fail(`the page crashed (${d.reason})`))
  win.webContents.on('preload-error', (_e, _path, err) => fail(`the preload failed: ${err.message}`))
  const step = (s: string): void => console.log(`SMOKE ${s}`)

  win.webContents.once('did-finish-load', async () => {
    try {
      step('page loaded')
      // The app rendered (React mounted something), and its bridge is there.
      const rendered = await poll(() => win.webContents.executeJavaScript("!!(document.getElementById('root')?.childElementCount && window.api)"), 30_000)
      if (!rendered) return fail("the page didn't render")
      step('page rendered')
      // A real terminal: the native module loads and a shell answers.
      const id = 'smoke-shell'
      const marker = 'switchyard-smoke-ok'
      spawn(win.webContents, { id, cwd: tmpdir(), execCommand: `echo ${marker}` })
      const echoed = await poll(async () => getBuffer(id).includes(marker), 20_000)
      if (!echoed) return fail(`the terminal didn't answer (got: ${JSON.stringify(getBuffer(id).slice(-200))}, running: ${exists(id)})`)
      kill(id)
      step('terminal ok')
      clearTimeout(timer)
      console.log('SMOKE OK')
      app.exit(0)
    } catch (err) {
      fail(String((err as Error)?.stack ?? err))
    }
  })
}

async function poll(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await check().catch(() => false)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
