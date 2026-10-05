import React, { useEffect, useState } from 'react'
import { keyLabel } from '../../lib/keys'
import { Menu, type MenuItem } from './Menu'
import type { MenuRole } from '@shared/types'

interface At {
  x: number
  y: number
  editable: boolean
  selected: boolean
}

/**
 * The right-click menu of text - any input, text area or editor without a
 * menu of its own gets Undo/Redo/Cut/Copy/Paste/Select All, and selected
 * text elsewhere gets Copy. (Electron shows no menu at all by default.)
 * Mounted once (App); a menu of its own (preventDefault) wins.
 */
export function TextContextMenu(): React.JSX.Element | null {
  const [at, setAt] = useState<At | null>(null)

  useEffect(() => {
    const onMenu = (e: MouseEvent): void => {
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      const field = target?.closest<HTMLElement>('input, textarea, [contenteditable=""], [contenteditable="true"]') ?? null
      const input = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field : null
      if (input && input instanceof HTMLInputElement && !/^(text|search|url|email|password|number|tel)$/.test(input.type)) return
      const editable = !!field && !(input?.readOnly || input?.disabled)
      const selected = input ? (input.selectionStart ?? 0) !== (input.selectionEnd ?? 0) : !!window.getSelection()?.toString()
      if (!field && !selected) return
      e.preventDefault()
      setAt({ x: e.clientX, y: e.clientY, editable, selected })
    }
    window.addEventListener('contextmenu', onMenu)
    return () => window.removeEventListener('contextmenu', onMenu)
  }, [])

  if (!at) return null
  const role = (r: MenuRole) => (): void => window.api.menu.role(r)
  const items: MenuItem[] = at.editable
    ? [
        { label: 'Undo', shortcut: keyLabel('⌘Z'), onClick: role('undo') },
        { label: 'Redo', shortcut: keyLabel('⇧⌘Z'), onClick: role('redo') },
        { label: 'Cut', shortcut: keyLabel('⌘X'), separatorBefore: true, disabled: !at.selected, onClick: role('cut') },
        { label: 'Copy', shortcut: keyLabel('⌘C'), disabled: !at.selected, onClick: role('copy') },
        { label: 'Paste', shortcut: keyLabel('⌘V'), onClick: role('paste') },
        { label: 'Select All', shortcut: keyLabel('⌘A'), separatorBefore: true, onClick: role('selectAll') }
      ]
    : [
        { label: 'Copy', shortcut: keyLabel('⌘C'), onClick: role('copy') },
        { label: 'Select All', shortcut: keyLabel('⌘A'), onClick: role('selectAll') }
      ]
  return <Menu anchor={at} items={items} onClose={() => setAt(null)} />
}
