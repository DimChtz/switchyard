import { app, dialog, BrowserWindow, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { MenuEntry, MenuModel, MenuRole } from '@shared/types'
import { IPC } from '@shared/ipc'

const isMac = process.platform === 'darwin'

function showAbout(win?: BrowserWindow): void {
  const opts = {
    type: 'info' as const,
    title: 'About Switchyard',
    message: `Switchyard ${app.getVersion()}`,
    detail: `Electron ${process.versions.electron}\nChromium ${process.versions.chrome}\nNode ${process.versions.node}`
  }
  if (win) dialog.showMessageBox(win, opts)
  else dialog.showMessageBox(opts)
}

/** Carries out a built-in menu action for the page that asked. */
export function runRole(wc: WebContents, role: MenuRole): void {
  const win = BrowserWindow.fromWebContents(wc) ?? undefined
  switch (role) {
    case 'undo':
      return wc.undo()
    case 'redo':
      return wc.redo()
    case 'cut':
      return wc.cut()
    case 'copy':
      return wc.copy()
    case 'paste':
      return wc.paste()
    case 'selectAll':
      return wc.selectAll()
    case 'zoomIn':
      return wc.setZoomLevel(wc.getZoomLevel() + 0.5)
    case 'zoomOut':
      return wc.setZoomLevel(wc.getZoomLevel() - 0.5)
    case 'resetZoom':
      return wc.setZoomLevel(0)
    case 'togglefullscreen':
      return win?.setFullScreen(!win.isFullScreen())
    case 'reload':
      return wc.reload()
    case 'toggleDevTools':
      return wc.toggleDevTools()
    case 'about':
      return showAbout(win)
    case 'quit':
      return app.quit()
  }
}

/** "⇧⌘N" → "Shift+CmdOrCtrl+N"; single keys (board shortcuts) get none. */
function accelerator(key?: string): string | undefined {
  if (!key || !/[⌘⌥⌃]/.test(key)) return undefined
  const mods: string[] = []
  if (key.includes('⌃')) mods.push('Ctrl')
  if (key.includes('⌥')) mods.push('Alt')
  if (key.includes('⇧')) mods.push('Shift')
  if (key.includes('⌘')) mods.push('CmdOrCtrl')
  const rest = key.replace(/[⌘⇧⌥⌃]/g, '')
  const named: Record<string, string> = { '⌫': 'Backspace', '↵': 'Enter', '=': '=', '-': '-' }
  return [...mods, named[rest] ?? rest.toUpperCase()].join('+')
}

// Roles whose shortcut the menu itself should own (the page doesn't handle them).
const OWN_ACCELERATOR = new Set<MenuRole>(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'zoomIn', 'zoomOut', 'resetZoom', 'toggleDevTools', 'togglefullscreen'])

function toNative(entry: MenuEntry): MenuItemConstructorOptions {
  if (entry.type === 'separator') return { type: 'separator' }
  const { id, label, key, enabled = true, role } = entry
  return {
    id,
    label,
    enabled,
    accelerator: accelerator(key),
    // Shortcuts for app commands are handled by the page (with its checks
    // for open dialogs), so on Windows/Linux the menu only shows them. The
    // macOS menu gets keys first and the page never sees them, so nothing
    // runs twice there either.
    registerAccelerator: !!role && OWN_ACCELERATOR.has(role),
    click: (_item, win) => {
      const w = win as BrowserWindow | undefined
      if (!w) return
      if (role) runRole(w.webContents, role)
      else w.webContents.send(IPC.menuCommand, id)
    }
  }
}

/**
 * The application menu, built from the model the page sends (so the title
 * bar menus and the macOS menu bar always match). macOS shows it in the
 * system menu bar; on Windows/Linux it's hidden and only provides shortcuts
 * such as developer tools and zoom - the title bar draws the menus there.
 */
export function setMenu(model: MenuModel[]): void {
  const template: MenuItemConstructorOptions[] = model.map((m) => ({ label: m.label, submenu: m.items.map(toNative) }))
  if (isMac) {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
    template.push({ role: 'windowMenu' })
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Until the page sends its menus: editing and developer tools still work. */
export function buildMenu(): void {
  setMenu([
    {
      label: 'Edit',
      items: (['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'] as MenuRole[]).map((role) => ({
        id: role,
        label: role,
        role,
        key: { undo: '⌘Z', redo: '⇧⌘Z', cut: '⌘X', copy: '⌘C', paste: '⌘V', selectAll: '⌘A' }[role as string]
      }))
    },
    { label: 'View', items: [{ id: 'devtools', label: 'Toggle Developer Tools', role: 'toggleDevTools', key: isMac ? '⌥⌘I' : '⇧⌘I' }] }
  ])
}
