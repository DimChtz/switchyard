import { formatKey, keyCommands, keyOf, menuKey, resolveBindings, type KeyBinding, type KeyCommand, type ResolvedBinding } from '@shared/keybindings'
import { isMac } from './keys'

/** Every command a shortcut can run, with its default key here. */
export const KEY_COMMANDS = keyCommands(isMac)

// keybindings.json as last loaded (the store keeps a copy, so screens re-render).
let user: KeyBinding[] = []
// Commands plugins add (with their default keys).
let fromPlugins: KeyCommand[] = []
let resolved: ResolvedBinding[] = resolveBindings(KEY_COMMANDS, user)

const resolve = (): void => {
  resolved = resolveBindings([...KEY_COMMANDS, ...fromPlugins], user)
}

export function setUserBindings(list: KeyBinding[]): void {
  user = list
  resolve()
}

export function setPluginKeyCommands(list: KeyCommand[]): void {
  fromPlugins = list
  resolve()
}

/** The app's commands and the plugins' (Settings → Keyboard shortcuts lists them all). */
export function allKeyCommands(): KeyCommand[] {
  return [...KEY_COMMANDS, ...fromPlugins]
}

/** The bindings in effect: defaults, then keybindings.json. */
export function bindings(): ResolvedBinding[] {
  return resolved
}

/** A command's key as shown ("Ctrl+Shift+N", "⇧⌘N", "C"), or "" when it has none. */
export function shortcut(command: string): string {
  const key = keyOf(resolved, command)
  return key ? formatKey(key, isMac) : ''
}

/** " (Ctrl+;)" after a command's name in a sentence, or nothing when it has no key. */
export function inParens(command: string): string {
  const k = shortcut(command)
  return k ? ` (${k})` : ''
}

/** A command's key in the menus' notation (see menuKey), for the title bar and the macOS menu bar. */
export function menuShortcut(command: string): string | undefined {
  const key = keyOf(resolved, command)
  return key ? menuKey(key, isMac) : undefined
}
