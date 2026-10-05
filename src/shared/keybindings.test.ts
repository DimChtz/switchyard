import { describe, expect, it } from 'vitest'
import { chordId, evalWhen, eventChord, formatKey, keyCommands, keyOf, matchBinding, menuKey, normalizeKey, parseKey, readBindings, resolveBindings } from './keybindings'

const win = keyCommands(false)
const mac = keyCommands(true)

function press(code: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}, key = ''): ReturnType<typeof eventChord> {
  return eventChord({ code, key, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, metaKey: !!mods.meta })
}

describe('parseKey', () => {
  it('reads modifiers in any order and case', () => {
    expect(normalizeKey('Shift+Ctrl+N')).toBe('ctrl+shift+n')
    expect(normalizeKey('cmd+alt+n')).toBe('alt+cmd+n')
    expect(normalizeKey('option+command+,')).toBe('alt+cmd+,')
  })

  it('knows named keys and their aliases', () => {
    expect(normalizeKey('ctrl+esc')).toBe('ctrl+escape')
    expect(normalizeKey('shift+F12')).toBe('shift+f12')
    expect(normalizeKey('alt+ArrowUp')).toBe('alt+up')
  })

  it('refuses what is not one key with modifiers', () => {
    expect(parseKey('')).toBeNull()
    expect(parseKey('ctrl+')).toBeNull()
    expect(parseKey('ctrl+k ctrl+s')).toBeNull() // chord sequences aren't supported
    expect(parseKey('ctrl+ctrl+k')).toBeNull()
    expect(parseKey('hyper+k')).toBeNull()
    expect(parseKey('ctrl+f25')).toBeNull()
  })
})

describe('eventChord', () => {
  it('names a key by its position, so Alt and Shift keep it the same key', () => {
    // Option+N on macOS types "˜"; it's still N.
    expect(chordId(press('KeyN', { alt: true, meta: true }, '˜')!)).toBe('alt+cmd+n')
    expect(chordId(press('Comma', { ctrl: true, shift: true }, '<')!)).toBe('ctrl+shift+,')
    expect(chordId(press('Digit1', { ctrl: true }, '!')!)).toBe('ctrl+1')
    expect(chordId(press('F2')!)).toBe('f2')
  })

  it('ignores a lone modifier and AltGr', () => {
    expect(press('ShiftLeft', { shift: true }, 'Shift')).toBeNull()
    expect(eventChord({ code: 'KeyQ', key: '@', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, getModifierState: (k) => k === 'AltGraph' })).toBeNull()
  })
})

describe('evalWhen', () => {
  const ctx = { board: true, terminalFocus: false }
  it('handles !, && and ||', () => {
    expect(evalWhen(undefined, ctx)).toBe(true)
    expect(evalWhen('board', ctx)).toBe(true)
    expect(evalWhen('!board', ctx)).toBe(false)
    expect(evalWhen('board && !terminalFocus', ctx)).toBe(true)
    expect(evalWhen('workspace || board', ctx)).toBe(true)
    expect(evalWhen('workspace && board || agents', ctx)).toBe(false)
    expect(evalWhen('nonsense', ctx)).toBe(false)
  })
})

describe('resolveBindings and matchBinding', () => {
  it('uses the platform modifier for the defaults', () => {
    expect(keyOf(resolveBindings(win, []), 'new-note')).toBe('ctrl+alt+n')
    expect(keyOf(resolveBindings(mac, []), 'new-note')).toBe('cmd+alt+n')
  })

  it('adds a key from keybindings.json and removes a default with "-"', () => {
    const list = resolveBindings(win, [
      { key: 'ctrl+alt+m', command: 'new-note' },
      { key: 'ctrl+alt+n', command: '-new-note' }
    ])
    expect(list.filter((b) => b.command === 'new-note').map((b) => b.key)).toEqual(['ctrl+alt+m'])
    expect(matchBinding(list, parseKey('ctrl+alt+m')!, {})).toBe('new-note')
    expect(matchBinding(list, parseKey('ctrl+alt+n')!, {})).toBeNull()
  })

  it('"-command" without a key removes all its keys', () => {
    const list = resolveBindings(win, [{ command: '-find' }])
    expect(keyOf(list, 'find')).toBeNull()
  })

  it('lets the last matching binding win, as VS Code does', () => {
    const list = resolveBindings(win, [{ key: 'ctrl+k', command: 'new-note' }])
    expect(matchBinding(list, parseKey('ctrl+k')!, {})).toBe('new-note')
  })

  it('respects "when": the same key does different things per screen', () => {
    const list = resolveBindings(win, [])
    expect(matchBinding(list, parseKey('c')!, { board: true })).toBe('new-task')
    expect(matchBinding(list, parseKey('c')!, { workspace: true })).toBe('ws-changes')
    expect(matchBinding(list, parseKey('c')!, { agents: true })).toBeNull()
  })

  it('leaves Ctrl+W to a Windows/Linux terminal but not on macOS', () => {
    expect(matchBinding(resolveBindings(win, []), parseKey('ctrl+w')!, { terminalFocus: true })).toBeNull()
    expect(matchBinding(resolveBindings(win, []), parseKey('ctrl+w')!, {})).toBe('close-workspace')
    expect(matchBinding(resolveBindings(mac, []), parseKey('cmd+w')!, { terminalFocus: true })).toBe('close-workspace')
  })
})

describe('showing keys', () => {
  it('formats per platform', () => {
    expect(formatKey('ctrl+shift+n', false)).toBe('Ctrl+Shift+N')
    expect(formatKey('cmd+shift+n', true)).toBe('⇧⌘N')
    expect(formatKey('ctrl+alt+up', false)).toBe('Ctrl+Alt+↑')
    expect(formatKey('c', false)).toBe('C')
  })

  it('writes menu keys the native menu understands', () => {
    expect(menuKey('ctrl+shift+n', false)).toBe('⇧⌘N') // ⌘ is CmdOrCtrl
    expect(menuKey('ctrl+shift+n', true)).toBe('⌃⇧N')
    expect(menuKey('cmd+,', true)).toBe('⌘,')
    expect(menuKey('win+e', false)).toBeUndefined()
  })
})

describe('readBindings', () => {
  it('keeps good entries and names the bad ones', () => {
    const { bindings, problems } = readBindings(
      [
        { key: 'ctrl+alt+m', command: 'new-note' },
        { key: 'ctrl+alt+m', command: 'no-such-thing' },
        { key: 'ctrl+wat+m', command: 'new-note' },
        { command: 'new-note' },
        { command: '-find' },
        'nope'
      ],
      win
    )
    expect(bindings).toEqual([{ key: 'ctrl+alt+m', command: 'new-note' }, { command: '-find' }])
    expect(problems).toHaveLength(4)
    expect(problems[0]).toContain('unknown command "no-such-thing"')
  })

  it('wants a list', () => {
    expect(readBindings({}, win).problems).toEqual(['expected a list - [ … ]'])
  })
})
