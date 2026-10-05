export const isMac = window.electron.process.platform === 'darwin'

/** "Reveal in Finder" / "Reveal in File Explorer" / "Open Containing Folder", as VS Code words it. */
export const revealLabel = isMac ? 'Reveal in Finder' : window.electron.process.platform === 'win32' ? 'Reveal in File Explorer' : 'Open Containing Folder'

/** "⇧⌘N" as this platform writes it: unchanged on macOS, "Ctrl+Shift+N" elsewhere. */
export function keyLabel(key: string): string {
  if (isMac || !/[⌘⇧⌥⌃]/.test(key)) return key
  const mods: string[] = []
  if (key.includes('⌘') || key.includes('⌃')) mods.push('Ctrl')
  if (key.includes('⇧')) mods.push('Shift')
  if (key.includes('⌥')) mods.push('Alt')
  const rest = key.replace(/[⌘⇧⌥⌃]/g, '').replace('⌫', 'Backspace').replace('↵', 'Enter')
  return [...mods, rest].join('+')
}
