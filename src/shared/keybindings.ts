/**
 * Keyboard shortcuts, the way VS Code does them: every command has a
 * default key, and keybindings.json (next to settings.json) adds, changes
 * or removes keys:
 *
 *   [
 *     { "key": "ctrl+alt+m", "command": "new-note" },
 *     { "key": "ctrl+alt+n", "command": "-new-note" }   // "-" removes a default key
 *   ]
 *
 * A key is modifiers - ctrl, shift, alt, cmd - and one key, joined by "+".
 * "when" limits where it works: board, workspace, agents, dashboard,
 * worktrees, notes, settings, terminalFocus, inputFocus, combined with
 * !, && and ||.
 */

export interface KeyCommand {
  id: string
  title: string
  category: string
  /** Default key, if it has one. */
  key?: string
  when?: string
}

/** An entry of keybindings.json. */
export interface KeyBinding {
  key?: string
  command: string
  when?: string
}

export interface ResolvedBinding {
  key: string
  command: string
  when?: string
  source: 'default' | 'user'
}

export interface Chord {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  key: string
}

/** Every command a shortcut can run, with its default key on this platform. */
export function keyCommands(mac: boolean): KeyCommand[] {
  const mod = mac ? 'cmd' : 'ctrl'
  // Ctrl+W and Ctrl+O belong to the shell in a Windows/Linux terminal.
  const notInTerminal = mac ? undefined : '!terminalFocus'
  return [
    { id: 'new-task', title: 'New task', category: 'File', key: 'c', when: 'board' },
    { id: 'new-project', title: 'New project…', category: 'File', key: `${mod}+shift+n` },
    { id: 'outside-work', title: 'Bring in outside work…', category: 'File' },
    { id: 'new-note', title: 'New note', category: 'File', key: `${mod}+alt+n` },
    { id: 'open-project', title: 'Open project…', category: 'File', key: `${mod}+o`, when: notInTerminal },
    { id: 'project-settings', title: 'Project settings', category: 'File', key: `${mod}+;` },
    { id: 'preferences', title: 'Preferences', category: 'File', key: `${mod}+,` },
    { id: 'open-settings-json', title: 'Open settings.json', category: 'File' },
    { id: 'keyboard-shortcuts', title: 'Keyboard shortcuts', category: 'File' },
    { id: 'open-keybindings-json', title: 'Open keybindings.json', category: 'File' },
    { id: 'open-editor', title: 'Open in external editor', category: 'File', key: `${mod}+shift+e` },
    { id: 'reveal-worktree', title: 'Reveal worktree in the file manager', category: 'File' },
    { id: 'close-workspace', title: 'Close workspace', category: 'File', key: `${mod}+w`, when: notInTerminal },
    { id: 'find', title: 'Find… (command palette)', category: 'Edit', key: `${mod}+k` },
    { id: 'quick-open', title: 'Go to file…', category: 'Edit', key: `${mod}+p` },
    { id: 'edit-desc', title: 'Edit task description', category: 'Edit' },
    { id: 'copy-branch', title: 'Copy branch name', category: 'Edit' },
    // Alt+←/→ move the cursor by word in a Windows/Linux shell.
    { id: 'go-back', title: 'Go back', category: 'View', key: mac ? 'cmd+[' : 'alt+left', when: notInTerminal },
    { id: 'go-forward', title: 'Go forward', category: 'View', key: mac ? 'cmd+]' : 'alt+right', when: notInTerminal },
    { id: 'nav-dashboard', title: 'Go to Projects', category: 'View', key: `${mod}+1` },
    { id: 'nav-agents', title: 'Go to Agents', category: 'View', key: `${mod}+2` },
    { id: 'nav-worktrees', title: 'Go to Worktrees', category: 'View', key: `${mod}+3` },
    // (In the sidebar's order. Map has none: rebind it in Keyboard shortcuts.)
    { id: 'nav-prs', title: 'Go to Pull requests', category: 'View', key: `${mod}+4` },
    { id: 'nav-notes', title: 'Go to Notes', category: 'View', key: `${mod}+5` },
    { id: 'nav-usage', title: 'Go to Usage', category: 'View', key: `${mod}+6` },
    { id: 'nav-team', title: 'Go to Team', category: 'View', key: `${mod}+7` },
    { id: 'nav-inbox', title: 'Go to Inbox', category: 'View', key: `${mod}+8` },
    { id: 'nav-summary', title: 'Go to Summary', category: 'View', key: `${mod}+9` },
    { id: 'nav-map', title: 'Go to Map', category: 'View' },
    { id: 'notifications', title: 'Notifications', category: 'View', key: `${mod}+shift+j` },
    { id: 'toggle-zen', title: 'Zen mode', category: 'View', key: `${mod}+alt+z` },
    // (Ctrl+B is the shell's own in a Windows/Linux terminal, and bold in an editor.)
    { id: 'toggle-sidebar', title: 'Toggle the sidebar', category: 'View', key: `${mod}+b`, when: mac ? '!inputFocus || terminalFocus' : '!inputFocus' },
    { id: 'next-blocked', title: 'Next blocked agent', category: 'View', key: `${mod}+j` },
    { id: 'start-task', title: 'Start the selected task', category: 'Board', key: 's', when: 'board' },
    { id: 'board-search', title: 'Search the board', category: 'Board', key: '/', when: 'board' },
    { id: 'ws-terminal', title: 'Show the agent’s session', category: 'Workspace', key: 't', when: 'workspace' },
    { id: 'ws-files', title: 'Show the Explorer', category: 'Workspace', key: 'f', when: 'workspace' },
    { id: 'ws-preview', title: 'Open the Preview', category: 'Workspace', key: 'p', when: 'workspace' },
    { id: 'ws-changes', title: 'Show the Changes', category: 'Workspace', key: 'c', when: 'workspace' },
    { id: 'ws-notes', title: 'Show the Notes', category: 'Workspace', key: 'n', when: 'workspace' },
    // (Ctrl+\ is the shell's own in a Windows/Linux terminal.)
    { id: 'ws-split-right', title: 'Split editor right', category: 'Workspace', key: `${mod}+\\`, when: mac ? 'workspace' : 'workspace && !terminalFocus' },
    { id: 'ws-split-down', title: 'Split editor down', category: 'Workspace', key: `${mod}+shift+\\`, when: mac ? 'workspace' : 'workspace && !terminalFocus' },
    { id: 'ws-new-terminal', title: 'New terminal', category: 'Workspace', when: 'workspace' },
    { id: 'ws-message', title: 'Message the agent', category: 'Workspace', key: `${mod}+.`, when: 'workspace' },
    { id: 'search-files', title: 'Search in files', category: 'Workspace', key: `${mod}+shift+f`, when: 'workspace' },
    { id: 'agent-approve', title: 'Approve the waiting agent', category: 'Agents', key: 'y', when: 'agents || workspace' },
    { id: 'agent-deny', title: 'Deny the waiting agent', category: 'Agents', key: 'n', when: 'agents' },
    { id: 'agent-retry', title: 'Retry the failed agent', category: 'Agents', key: 'r', when: 'agents || workspace' },
    { id: 'notes-new', title: 'New note (Notes screen)', category: 'Notes', key: 'n', when: 'notes' },
    { id: 'notes-search', title: 'Search notes', category: 'Notes', key: '/', when: 'notes' },
    { id: 'agent-open', title: 'Open the oldest blocked agent', category: 'Agents', key: 'o', when: 'agents' }
  ]
}

const MOD_NAMES: Record<string, keyof Omit<Chord, 'key'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  win: 'meta',
  super: 'meta'
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  pgup: 'pageup',
  pgdown: 'pagedown'
}

const NAMED = new Set(['enter', 'escape', 'tab', 'space', 'backspace', 'delete', 'insert', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown'])
const PUNCT = new Set([',', ';', '.', '/', '=', '-', '[', ']', '`', '\\', "'"])

function validKey(k: string): boolean {
  return /^[a-z0-9]$/.test(k) || /^f([1-9]|1[0-9]|2[0-4])$/.test(k) || NAMED.has(k) || PUNCT.has(k)
}

/** "Ctrl+Shift+N" → a chord; null if it isn't one key with modifiers. */
export function parseKey(text: string): Chord | null {
  const parts = text.trim().toLowerCase().split('+')
  const chord: Chord = { ctrl: false, shift: false, alt: false, meta: false, key: '' }
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim()
    // "ctrl++" can't be written; "=" is the plus key, as in VS Code.
    if (!p) return null
    if (i < parts.length - 1) {
      const mod = MOD_NAMES[p]
      if (!mod || chord[mod]) return null
      chord[mod] = true
    } else {
      const k = KEY_ALIASES[p] ?? p
      if (!validKey(k)) return null
      chord.key = k
    }
  }
  return chord
}

/** One way to write a chord, to compare keys: "ctrl+shift+alt+cmd+k". */
export function chordId(c: Chord): string {
  return [c.ctrl && 'ctrl', c.shift && 'shift', c.alt && 'alt', c.meta && 'cmd', c.key].filter(Boolean).join('+')
}

export function normalizeKey(text: string): string | null {
  const c = parseKey(text)
  return c ? chordId(c) : null
}

const CODE_KEYS: Record<string, string> = {
  Comma: ',',
  Semicolon: ';',
  Period: '.',
  Slash: '/',
  Equal: '=',
  Minus: '-',
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  Backslash: '\\',
  Quote: "'",
  Space: 'space',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Escape: 'escape',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown'
}

/**
 * The chord a key press makes, by the key's position (as VS Code does), so
 * Alt/Option and Shift don't change which key it is. Null for a lone
 * modifier, or a character typed with AltGr.
 */
export function eventChord(e: { key: string; code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; getModifierState?: (k: string) => boolean }): Chord | null {
  if (e.getModifierState?.('AltGraph')) return null
  let key: string | undefined
  const letter = e.code.match(/^Key([A-Z])$/)
  const digit = e.code.match(/^(?:Digit|Numpad)([0-9])$/)
  const fn = e.code.match(/^F([0-9]{1,2})$/)
  if (letter) key = letter[1].toLowerCase()
  else if (digit) key = digit[1]
  else if (fn) key = `f${fn[1]}`
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code]
  else if (e.key.length === 1) key = e.key.toLowerCase()
  if (!key || !validKey(key)) return null
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, key }
}

/**
 * Whether a "when" clause holds: names from the context, with !, && and ||
 * (&& binds tighter). An empty clause always holds; unknown names are false.
 */
export function evalWhen(when: string | undefined, ctx: Record<string, boolean>): boolean {
  if (!when || !when.trim()) return true
  return when.split('||').some((alt) =>
    alt.split('&&').every((term) => {
      const t = term.trim()
      const negated = /^!/.test(t)
      const name = t.replace(/^!+\s*/, '')
      const value = name === 'true' ? true : name === 'false' ? false : !!ctx[name]
      return negated ? !value : value
    })
  )
}

/**
 * The bindings in effect: the defaults, then keybindings.json in order. A
 * "-command" entry removes that command's earlier bindings - only the one
 * with its key (and "when"), if it gives them.
 */
export function resolveBindings(commands: KeyCommand[], user: KeyBinding[]): ResolvedBinding[] {
  let list: ResolvedBinding[] = commands.filter((c) => c.key).map((c) => ({ key: c.key!, command: c.id, when: c.when, source: 'default' }))
  for (const b of user) {
    if (b.command.startsWith('-')) {
      const id = b.command.slice(1)
      const key = b.key ? normalizeKey(b.key) : null
      list = list.filter((x) => !(x.command === id && (key === null || normalizeKey(x.key) === key) && (b.when === undefined || (x.when ?? '') === b.when)))
    } else if (b.key && normalizeKey(b.key)) {
      list.push({ key: b.key, command: b.command, when: b.when, source: 'user' })
    }
  }
  return list
}

/** The command a chord runs here - the last binding that matches wins, as in VS Code. */
export function matchBinding(bindings: ResolvedBinding[], chord: Chord, ctx: Record<string, boolean>): string | null {
  const id = chordId(chord)
  for (let i = bindings.length - 1; i >= 0; i--) {
    const b = bindings[i]
    if (normalizeKey(b.key) === id && evalWhen(b.when, ctx)) return b.command
  }
  return null
}

/** The key shown for a command (its newest binding), if it has one. */
export function keyOf(bindings: ResolvedBinding[], command: string): string | null {
  for (let i = bindings.length - 1; i >= 0; i--) if (bindings[i].command === command) return bindings[i].key
  return null
}

const SHOWN: Record<string, string> = {
  enter: 'Enter',
  escape: 'Esc',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown'
}

/** How a key is shown: "⇧⌘N" on macOS, "Ctrl+Shift+N" elsewhere. */
export function formatKey(text: string, mac: boolean): string {
  const c = parseKey(text)
  if (!c) return text
  const key = SHOWN[c.key] ?? c.key.toUpperCase()
  if (mac) {
    const macKey = { enter: '↵', backspace: '⌫', escape: '⎋', tab: '⇥', delete: '⌦' }[c.key] ?? key
    return `${c.ctrl ? '⌃' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.meta ? '⌘' : ''}${macKey}`
  }
  return [c.ctrl && 'Ctrl', c.shift && 'Shift', c.alt && 'Alt', c.meta && 'Win', key].filter(Boolean).join('+')
}

/**
 * The key in the menus' notation ("⇧⌘N", ⌘ being Cmd on macOS and Ctrl
 * elsewhere), which the native menu turns into its accelerator. Undefined
 * for what it can't show (the Windows key).
 */
export function menuKey(text: string, mac: boolean): string | undefined {
  const c = parseKey(text)
  if (!c || (!mac && c.meta)) return undefined
  const named: Record<string, string> = { enter: '↵', backspace: '⌫', escape: 'Esc', tab: 'Tab', space: 'Space', delete: 'Delete', insert: 'Insert', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' }
  const key = named[c.key] ?? c.key.toUpperCase()
  // In the usual order: ⌃⌥⇧⌘ (away from macOS, Ctrl is written ⌘).
  const cmd = c.meta || (!mac && c.ctrl)
  return `${mac && c.ctrl ? '⌃' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${cmd ? '⌘' : ''}${key}`
}

const PLUGIN_COMMAND = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/

/** keybindings.json's entries that can be used, and what's wrong with the rest. */
export function readBindings(data: unknown, commands: KeyCommand[]): { bindings: KeyBinding[]; problems: string[] } {
  if (!Array.isArray(data)) return { bindings: [], problems: ['expected a list - [ … ]'] }
  const ids = new Set(commands.map((c) => c.id))
  const bindings: KeyBinding[] = []
  const problems: string[] = []
  data.forEach((raw, i) => {
    const at = `entry ${i + 1}`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return problems.push(`${at}: expected { "key": …, "command": … }`)
    const { key, command, when } = raw as Record<string, unknown>
    if (typeof command !== 'string' || !command) return problems.push(`${at}: no "command"`)
    const id = command.replace(/^-/, '')
    // "<plugin>.<command>": a plugin's (kept even while that plugin is off).
    if (!ids.has(id) && !PLUGIN_COMMAND.test(id)) return problems.push(`${at}: unknown command "${id}"`)
    if (key !== undefined && (typeof key !== 'string' || !parseKey(key))) return problems.push(`${at}: "${String(key)}" isn't a key Switchyard understands`)
    if (key === undefined && !command.startsWith('-')) return problems.push(`${at}: no "key"`)
    if (when !== undefined && typeof when !== 'string') return problems.push(`${at}: "when" should be text`)
    bindings.push({ command, ...(key !== undefined ? { key: key as string } : {}), ...(when !== undefined ? { when: when as string } : {}) })
    return undefined
  })
  return { bindings, problems }
}
