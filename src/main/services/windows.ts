import type { BrowserWindow } from 'electron'

/**
 * Switchyard's main window - not the quick capture box (see capture.ts),
 * which is a window too: what's meant by "the window" (focusing it, a
 * dialog's parent, where a notification's click goes).
 */
let main: BrowserWindow | null = null

export function setMainWindow(w: BrowserWindow): void {
  main = w
  w.on('closed', () => {
    if (main === w) main = null
  })
}

export function mainWindow(): BrowserWindow | null {
  return main && !main.isDestroyed() ? main : null
}
