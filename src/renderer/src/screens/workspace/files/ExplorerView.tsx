import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../../store/AppStore'
import { useHover } from '../../../lib/useHover'
import { fileIcon } from '../../../lib/fileLang'
import { buildTree, allDirPaths, excludeMatcher, type TreeRow, type TreeItem } from '../../../lib/fileTree'
import { prefsFor } from '../../../lib/projectPrefs'
import { FILE_DRAG_TYPE } from '../../../lib/dropPaths'
import { Button, IconButton, Menu, TextInput, confirm, type MenuItem } from '../../../components/ui'
import { shortcut } from '../../../lib/shortcuts'
import { errText } from '../../../lib/errors'
import { isMac, keyLabel, revealLabel } from '../../../lib/keys'
import { addShell, setDrag, startTabDrag, wsOpen } from '../../../lib/wsStore'
import { useFiles } from './FilesContext'
import { PanelHeader, PanelIcon, type PanelChrome } from '../layout/PanelHeader'

const parentOf = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

/** A row's height, and the tree's padding above the first. */
const ROW_H = 24
const PAD = 6

// Cut or copied files and folders (absolute paths), kept across worktrees for Paste.
let fileClipboard: { mode: 'copy' | 'cut'; items: { path: string; name: string }[] } | null = null

/** What a drag from the explorer carries (absolute paths, as JSON) - a terminal types them in, a folder takes them. */
const DRAG_TYPE = FILE_DRAG_TYPE

/** The Explorer side bar view: the task's folder as a tree (VS Code's explorer). */
export function ExplorerView({ chrome, activePath }: { chrome: PanelChrome; activePath: string | null }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const files = useFiles()
  const { task, entries, listError, collapsed, setCollapsed, abs, relOf, inRoot: inWorktree, refresh, openFile } = files
  // Settings → File editor → Explorer (the project's own, if it sets them).
  const pf = prefsFor(state, task.projectId)
  const excluded = (pf.explorerExclude ?? []).join('\n')
  const hide = useMemo(() => excludeMatcher(excluded.split('\n')), [excluded])
  // The filter box (Ctrl/⌘+F in the tree): null while it's closed.
  const [filter, setFilter] = useState<string | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const [spinning, setSpinning] = useState(false)
  const [creating, setCreating] = useState<{ parentDir: string; isDir: boolean } | null>(null)
  const [createName, setCreateName] = useState('')
  const [renaming, setRenaming] = useState<{ path: string; isDir: boolean } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; row: TreeRow | null; multi?: TreeRow[] } | null>(null)
  // The selection: `selected` is the row keyboard actions start from,
  // `picked` every selected row (Ctrl/Shift+click, Shift+↑↓). And whether
  // the tree has focus.
  const [selected, setLead] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const anchorRef = useRef<string | null>(null)
  const [treeFocused, setTreeFocused] = useState(false)
  // Drag and drop: the folder a drop would go into ('' the root), the rows being dragged.
  const [dropDir, setDropDir] = useState<string | null>(null)
  const dragRef = useRef<string[] | null>(null)
  const expandTimer = useRef<{ dir: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  const allItems: TreeItem[] = useMemo(
    () =>
      (entries ?? [])
        .filter((f) => (pf.explorerShowIgnored || !f.ignored) && !hide?.(f.path))
        .map((f) => ({ path: f.path, status: f.status, isDir: f.isDir, ignored: f.ignored, lazy: f.lazy })),
    [entries, pf.explorerShowIgnored, hide]
  )
  const rows = useMemo(() => buildTree(allItems, collapsed, { compact: pf.explorerCompact, filter: filter ?? undefined }), [allItems, collapsed, pf.explorerCompact, filter])

  // Only the rows on screen are drawn (a folder can hold thousands of files).
  const [view, setView] = useState({ top: 0, height: 800 })
  useEffect(() => {
    const el = treeRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setView({ top: el.scrollTop, height: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // The tree's lines: its rows, and the name field of a file or folder being made.
  const lines = useMemo(() => {
    const out: ({ kind: 'row'; r: TreeRow } | { kind: 'create'; depth: number })[] = []
    if (creating?.parentDir === '') out.push({ kind: 'create', depth: 0 })
    for (const r of rows) {
      out.push({ kind: 'row', r })
      if (creating && creating.parentDir === r.path) out.push({ kind: 'create', depth: r.depth + 1 })
    }
    return out
  }, [rows, creating])
  const first = Math.max(0, Math.floor((view.top - PAD) / ROW_H) - 12)
  const last = Math.min(lines.length, Math.ceil((view.top + view.height) / ROW_H) + 12)

  const openFilter = (): void => {
    setFilter((f) => f ?? '')
    setTimeout(() => filterRef.current?.select(), 0)
  }
  const closeFilter = (): void => {
    setFilter(null)
    treeRef.current?.focus()
  }

  const toggleDir = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const expandTo = (dir: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      for (let p = dir; p; p = parentOf(p)) next.delete(p)
      return next
    })

  /** Selects just this row (null: nothing). */
  const setSelected = (path: string | null): void => {
    setLead(path)
    setPicked(path ? new Set([path]) : new Set())
    anchorRef.current = path
  }
  /** Shift: every row from the last one picked to this one. */
  const extendTo = (path: string): void => {
    const a = rows.findIndex((r) => r.path === (anchorRef.current ?? selected ?? path))
    const b = rows.findIndex((r) => r.path === path)
    if (a < 0 || b < 0) return setSelected(path)
    setPicked(new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.path)))
    setLead(path)
  }
  /** Ctrl/Cmd: adds the row to the selection, or takes it out. */
  const togglePick = (path: string): void => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    setLead(path)
    anchorRef.current = path
  }
  /** The selected rows an action applies to - what's inside a selected folder goes with the folder. */
  const pickedRows = (): TreeRow[] => {
    const list = rows.filter((r) => picked.has(r.path))
    return list.filter((r) => !list.some((o) => o.isDir && o !== r && r.path.startsWith(`${o.path}/`)))
  }

  /** Shows the file in the tree: its folders opened, the row selected and scrolled to. */
  const revealInTree = (path: string): void => {
    expandTo(parentOf(path))
    setSelected(path)
    treeRef.current?.focus()
  }
  // "Reveal in Explorer View" from an editor tab.
  useEffect(() => {
    if (files.revealReq) revealInTree(files.revealReq.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.revealReq?.n])
  // (The selected row kept in view - it may not be drawn yet, so by where it is in the list.)
  useEffect(() => {
    const el = treeRef.current
    const i = selected ? lines.findIndex((l) => l.kind === 'row' && l.r.path === selected) : -1
    if (!el || i < 0) return
    const top = PAD + i * ROW_H
    if (top < el.scrollTop) el.scrollTop = top - PAD
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight + PAD
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rows])

  // Settings → Follow the open file: the file in the editor, shown in the tree.
  useEffect(() => {
    if (!pf.explorerFollow || !activePath || filter !== null || !entries?.some((e) => e.path === activePath)) return
    expandTo(parentOf(activePath))
    setSelected(activePath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, pf.explorerFollow])

  const startCreate = (parentDir: string, isDir: boolean): void => {
    if (parentDir) setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(parentDir)
      return next
    })
    setCreating({ parentDir, isDir })
    setCreateName('')
  }
  const submitCreate = (): void => {
    if (!creating) return
    const name = createName.trim()
    if (!name) return setCreating(null)
    const relPath = creating.parentDir ? `${creating.parentDir}/${name}` : name
    window.api.fs
      .create(abs(relPath), creating.isDir)
      .then(() => {
        setCreating(null)
        setCreateName('')
        refresh()
        if (!creating.isDir) openFile(relPath)
        setSelected(relPath)
      })
      .catch((err: unknown) => dispatch({ type: 'TOAST', text: `Could not create: ${errText(err)}` }))
  }

  const startRename = (row: TreeRow): void => {
    setRenaming({ path: row.path, isDir: row.isDir })
    setRenameValue(row.name)
  }
  const submitRename = (): void => {
    if (!renaming) return
    const name = renameValue.trim()
    if (!name || name === renaming.path.split('/').pop()) return setRenaming(null)
    const dir = parentOf(renaming.path)
    const newRelPath = dir ? `${dir}/${name}` : name
    window.api.fs
      .rename(abs(renaming.path), abs(newRelPath))
      .then(() => {
        files.remap(renaming.path, newRelPath)
        setRenaming(null)
        refresh()
        setSelected(newRelPath)
      })
      .catch((err: unknown) => dispatch({ type: 'TOAST', text: `Could not rename: ${errText(err)}` }))
  }

  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  const openInTerminal = (dir: string): void => void addShell(task.id, { cwd: abs(dir), taskRoot: abs('') })
  const showChanges = (path: string): void => wsOpen(task.id, `diff:${path}`)

  const deleteRows = async (list: TreeRow[]): Promise<void> => {
    if (!list.length) return
    const one = list.length === 1 ? list[0] : null
    const ok = await confirm({
      title: one ? `Delete “${one.name}”?` : `Delete ${list.length} items?`,
      body: !one
        ? 'They go to the system trash - restorable from there.'
        : one.isDir
          ? 'The folder and everything in it go to the system trash - restorable from there.'
          : 'It goes to the system trash - restorable from there.',
      detail: one ? abs(one.path) : list.slice(0, 6).map((r) => r.path).join('\n') + (list.length > 6 ? `\n…and ${list.length - 6} more` : ''),
      confirmLabel: 'Move to Trash',
      danger: true
    })
    if (!ok) return
    const all = (entries ?? []).filter((e) => !e.isDir).map((e) => e.path)
    for (const row of list) {
      try {
        await window.api.fs.delete(abs(row.path))
        files.forget(all.filter((p) => p === row.path || (row.isDir && p.startsWith(`${row.path}/`))))
      } catch (err) {
        dispatch({ type: 'TOAST', text: `Could not delete ${row.name}: ${errText(err)}` })
      }
    }
    setSelected(null)
    refresh()
  }

  // Cut / Copy / Paste of files and folders - also from one worktree into another.
  const clip = (mode: 'copy' | 'cut', list: TreeRow[]): void => {
    if (!list.length) return
    fileClipboard = { mode, items: list.map((r) => ({ path: abs(r.path), name: r.name })) }
    const what = list.length === 1 ? list[0].name : `${list.length} items`
    dispatch({ type: 'TOAST', text: `${mode === 'cut' ? 'Cut' : 'Copied'} ${what} - paste into a folder with ${keyLabel('⌘V')}.` })
  }
  const clipName = (): string => (!fileClipboard ? '' : fileClipboard.items.length === 1 ? `“${fileClipboard.items[0].name}”` : `${fileClipboard.items.length} items`)

  /** Copies or moves files and folders (absolute paths, from anywhere) into a folder of this worktree. */
  const transfer = async (mode: 'copy' | 'move', paths: string[], intoDir: string): Promise<void> => {
    let last: string | null = null
    for (const src of paths) {
      const from = inWorktree(src) ? relOf(src) : null
      // Moving it to the folder it's in changes nothing.
      if (mode === 'move' && from !== null && parentOf(from) === intoDir) continue
      try {
        const dest = mode === 'copy' ? await window.api.fs.copy(src, abs(intoDir)) : await window.api.fs.move(src, abs(intoDir))
        if (mode === 'move' && from !== null) files.remap(from, relOf(dest))
        last = dest
      } catch (err) {
        dispatch({ type: 'TOAST', text: `Could not ${mode} ${src.split(/[\\/]/).pop()}: ${errText(err)}` })
      }
    }
    refresh()
    if (last && inWorktree(last)) revealInTree(relOf(last))
  }
  const paste = async (intoDir: string): Promise<void> => {
    const c = fileClipboard
    if (!c) return
    if (c.mode === 'cut') fileClipboard = null
    await transfer(c.mode === 'cut' ? 'move' : 'copy', c.items.map((i) => i.path), intoDir)
  }

  // Drag and drop: rows move into a folder (Ctrl - Option on macOS - copies);
  // files dropped from the system's file manager are copied in. A file
  // dragged onto an editor group opens there (or beside it, at an edge).
  const rowAt = (target: EventTarget | null): TreeRow | null => {
    const path = (target as HTMLElement | null)?.closest?.('[data-path]')?.getAttribute('data-path')
    return path ? (rows.find((r) => r.path === path) ?? null) : null
  }
  const copyKey = (e: React.DragEvent): boolean => (isMac ? e.altKey : e.ctrlKey)
  /** The folder a drop here goes into ('' the root) - null where it can't go (a folder into itself). */
  const dropTargetOf = (e: React.DragEvent): string | null => {
    const row = rowAt(e.target)
    const dir = row ? (row.isDir ? row.path : parentOf(row.path)) : ''
    if (dragRef.current?.some((p) => dir === p || dir.startsWith(`${p}/`))) return null
    return dir
  }
  const onDragStart = (e: React.DragEvent): void => {
    const row = rowAt(e.target)
    if (!row) return
    const list = picked.has(row.path) ? pickedRows() : [row]
    if (!picked.has(row.path)) setSelected(row.path)
    dragRef.current = list.map((r) => r.path)
    const paths = list.map((r) => abs(r.path))
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths))
    e.dataTransfer.setData('text/plain', paths.join('\n'))
    if (list.length === 1 && !row.isDir) startTabDrag(e, `file:${row.path}`, null)
    else e.dataTransfer.effectAllowed = 'copyMove'
  }
  const endDrag = (): void => {
    dragRef.current = null
    setDropDir(null)
    setDrag(null)
    if (expandTimer.current) clearTimeout(expandTimer.current.timer)
    expandTimer.current = null
  }
  const onDragOver = (e: React.DragEvent): void => {
    const internal = e.dataTransfer.types.includes(DRAG_TYPE)
    if (!internal && !e.dataTransfer.types.includes('Files')) return
    const dir = dropTargetOf(e)
    if (dir === null) {
      e.dataTransfer.dropEffect = 'none'
      setDropDir(null)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = internal && !copyKey(e) ? 'move' : 'copy'
    setDropDir(dir)
    // Holding over a closed folder opens it.
    const row = rowAt(e.target)
    if (row?.isDir && !row.open) {
      if (expandTimer.current?.dir !== row.path) {
        if (expandTimer.current) clearTimeout(expandTimer.current.timer)
        const dirPath = row.path
        expandTimer.current = { dir: dirPath, timer: setTimeout(() => ((expandTimer.current = null), expandTo(dirPath)), 600) }
      }
    } else if (expandTimer.current) {
      clearTimeout(expandTimer.current.timer)
      expandTimer.current = null
    }
  }
  const onDragLeave = (e: React.DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropDir(null)
  }
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const dir = dropTargetOf(e)
    const ours = e.dataTransfer.getData(DRAG_TYPE)
    const copy = copyKey(e)
    const dropped = [...e.dataTransfer.files].map((f) => window.api.fs.pathForFile(f)).filter(Boolean)
    endDrag()
    if (dir === null) return
    if (ours) transfer(copy ? 'copy' : 'move', JSON.parse(ours) as string[], dir)
    else if (dropped.length) transfer('copy', dropped, dir)
  }
  const duplicate = async (row: TreeRow): Promise<void> => {
    try {
      const dest = await window.api.fs.copy(abs(row.path), abs(parentOf(row.path)))
      refresh()
      revealInTree(relOf(dest))
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not duplicate ${row.name}: ${errText(err)}` })
    }
  }

  // Header actions: new file/folder go into the selected folder (or the selected file's).
  const selectedDir = (): string => {
    const r = rows.find((x) => x.path === selected)
    return r ? (r.isDir ? r.path : parentOf(r.path)) : ''
  }
  const collapseAll = (): void => setCollapsed(() => new Set(allDirPaths(allItems)))
  const spinRefresh = (): void => {
    if (spinning) return
    setSpinning(true)
    setTimeout(() => setSpinning(false), 720)
    refresh()
  }

  // The right-click menu: a file, a folder, or the empty space (VS Code's set).
  const menuItemsFor = (row: TreeRow | null, multi?: TreeRow[]): MenuItem[] => {
    if (multi && multi.length > 1) {
      return [
        { label: 'Cut', shortcut: keyLabel('⌘X'), onClick: () => clip('cut', multi) },
        { label: 'Copy', shortcut: keyLabel('⌘C'), onClick: () => clip('copy', multi) },
        { label: 'Copy Paths', separatorBefore: true, onClick: () => window.api.sys.copy(multi.map((r) => abs(r.path)).join('\n')) },
        { label: 'Copy Relative Paths', onClick: () => window.api.sys.copy(multi.map((r) => r.path).join('\n')) },
        { label: `Delete ${multi.length} Items`, shortcut: isMac ? '⌘⌫' : 'Delete', separatorBefore: true, danger: true, onClick: () => deleteRows(multi) }
      ]
    }
    const dir = row ? (row.isDir ? row.path : parentOf(row.path)) : ''
    const pasteItem: MenuItem = { label: fileClipboard ? `Paste ${clipName()}` : 'Paste', shortcut: keyLabel('⌘V'), disabled: !fileClipboard, onClick: () => paste(dir) }
    if (!row) {
      return [
        { label: 'New File…', onClick: () => startCreate('', false) },
        { label: 'New Folder…', onClick: () => startCreate('', true) },
        { ...pasteItem, separatorBefore: true },
        { label: revealLabel, separatorBefore: true, onClick: () => window.api.sys.showItem(abs('')).catch(toastErr) },
        { label: 'Open in Integrated Terminal', onClick: () => openInTerminal('') },
        { label: 'Open in External Terminal', onClick: () => window.api.sys.openTerminal(abs('')).catch(toastErr) },
        { label: 'Search in Files…', shortcut: shortcut('search-files'), separatorBefore: true, onClick: files.openSearch },
        { label: 'Collapse All', onClick: collapseAll },
        { label: 'Refresh', onClick: spinRefresh }
      ]
    }
    const opens: MenuItem[] = row.isDir
      ? [
          { label: 'New File…', onClick: () => startCreate(row.path, false) },
          { label: 'New Folder…', onClick: () => startCreate(row.path, true) }
        ]
      : [
          { label: 'Open', onClick: () => openFile(row.path) },
          ...(row.status !== 'unchanged' ? [{ label: 'Open Changes', onClick: () => showChanges(row.path) }] : []),
          ...(row.status !== 'added' ? [{ label: 'File History', onClick: () => wsOpen(task.id, `history:${row.path}`) }] : []),
          { label: 'Open in Editor', onClick: () => window.api.sys.openInEditor(abs(row.path)).catch(toastErr) },
          { label: 'Open with Default App', onClick: () => window.api.sys.reveal(abs(row.path)).catch(toastErr) }
        ]
    return [
      ...opens,
      { label: revealLabel, separatorBefore: true, onClick: () => window.api.sys.showItem(abs(row.path)).catch(toastErr) },
      { label: 'Open in Integrated Terminal', onClick: () => openInTerminal(dir) },
      { label: 'Cut', shortcut: keyLabel('⌘X'), separatorBefore: true, onClick: () => clip('cut', [row]) },
      { label: 'Copy', shortcut: keyLabel('⌘C'), onClick: () => clip('copy', [row]) },
      ...(row.isDir ? [pasteItem] : []),
      { label: 'Duplicate', onClick: () => duplicate(row) },
      { label: 'Copy Path', shortcut: keyLabel('⇧⌥C'), separatorBefore: true, onClick: () => window.api.sys.copy(abs(row.path)) },
      { label: 'Copy Relative Path', onClick: () => window.api.sys.copy(row.path) },
      { label: 'Rename…', shortcut: 'F2', separatorBefore: true, onClick: () => startRename(row) },
      { label: 'Delete', shortcut: isMac ? '⌘⌫' : 'Delete', danger: true, onClick: () => deleteRows([row]) }
    ]
  }

  // The keys, while the tree has focus: ↑↓ move (with Shift, select), →←
  // open/close folders, ↵ open, F2 rename, Delete, Select All, and
  // Cut/Copy/Paste/Copy Path.
  const onTreeKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return // typing in the inline name field
    const mod = e.metaKey || e.ctrlKey
    const i = rows.findIndex((r) => r.path === selected)
    const row = i >= 0 ? rows[i] : null
    // What Delete, Cut, Copy act on: the selection, else the row keys are on.
    const targets = (): TreeRow[] => {
      const list = pickedRows()
      return list.length ? list : row ? [row] : []
    }
    const move = (to: string | undefined): void => {
      if (!to) return
      if (e.shiftKey) extendTo(to)
      else setSelected(to)
    }
    let handled = true
    if (e.key === 'ArrowDown') move(rows[Math.min(rows.length - 1, i + 1)]?.path)
    else if (e.key === 'ArrowUp') move(rows[Math.max(0, i - 1)]?.path)
    else if (e.key === 'ArrowRight' && row?.isDir) {
      if (!row.open) toggleDir(row.path)
      else if (rows[i + 1]?.depth > row.depth) setSelected(rows[i + 1].path)
    } else if (e.key === 'ArrowLeft' && row) {
      if (row.isDir && row.open && filter === null) toggleDir(row.path)
      else {
        // (Its folder's row - with compact folders, the chain it's in.)
        for (let k = i - 1; k >= 0; k--)
          if (rows[k].depth < row.depth) {
            setSelected(rows[k].path)
            break
          }
      }
    } else if (mod && !e.shiftKey && e.code === 'KeyF') openFilter()
    else if (e.key === 'Escape' && filter !== null) closeFilter()
    else if (e.key === 'Enter' && row) {
      if (row.isDir) toggleDir(row.path)
      else openFile(row.path)
    } else if (e.key === 'F2' && row) startRename(row)
    else if (row && (e.key === 'Delete' || (isMac && e.metaKey && e.key === 'Backspace'))) deleteRows(targets())
    else if (row && e.shiftKey && e.altKey && e.code === 'KeyC') window.api.sys.copy(targets().map((r) => abs(r.path)).join('\n'))
    else if (mod && !e.shiftKey && e.code === 'KeyA') setPicked(new Set(rows.map((r) => r.path)))
    else if (row && mod && !e.shiftKey && e.code === 'KeyC') clip('copy', targets())
    else if (row && mod && !e.shiftKey && e.code === 'KeyX') clip('cut', targets())
    else if (mod && !e.shiftKey && e.code === 'KeyV') paste(row ? (row.isDir ? row.path : parentOf(row.path)) : '')
    else if (e.key.length === 1 && !mod && !e.altKey && e.key !== ' ') {
      // Type to jump to the next row starting with that letter (and keep the
      // key from the workspace's single-letter shortcuts), as VS Code's explorer.
      const ch = e.key.toLowerCase()
      for (let k = 1; k <= rows.length; k++) {
        const r = rows[(i + k + rows.length) % rows.length]
        if (r.name.toLowerCase().startsWith(ch)) {
          setSelected(r.path)
          break
        }
      }
    } else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation() // not the workspace's single-key shortcuts
    }
  }

  return (
    <>
      <PanelHeader title="Explorer" chrome={chrome}>
        <PanelIcon title="New file…" onClick={() => startCreate(selectedDir(), false)}>
          <path d="M8 1.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5L8 1.5z" />
          <path d="M8 1.5V5h3.5" />
          <path d="M7 7.2v3.6M5.2 9h3.6" />
        </PanelIcon>
        <PanelIcon title="New folder…" onClick={() => startCreate(selectedDir(), true)}>
          <path d="M1.5 3.2c0-.6.5-1.1 1.1-1.1h3l1.3 1.4h4.5c.6 0 1.1.5 1.1 1.1v5.8c0 .6-.5 1.1-1.1 1.1H2.6c-.6 0-1.1-.5-1.1-1.1z" />
          <path d="M7 5.8v3.4M5.3 7.5h3.4" />
        </PanelIcon>
        <PanelIcon title="Refresh explorer" onClick={spinRefresh} svgStyle={{ transform: spinning ? 'rotate(360deg)' : 'rotate(0deg)', transition: spinning ? 'transform .7s ease' : 'none' }}>
          <path d="M11.6 6.2A4.7 4.7 0 0 0 3 4.3" />
          <path d="M2.8 1.8v2.7h2.7" />
          <path d="M2.4 7.8a4.7 4.7 0 0 0 8.6 1.9" />
          <path d="M11.2 12.2V9.5H8.5" />
        </PanelIcon>
        <PanelIcon title={`Filter files by name (${keyLabel('⌘F')} in the tree)`} onClick={() => (filter === null ? openFilter() : closeFilter())}>
          <path d="M1.8 2.5h10.4L8.2 7.3v3.9L5.8 12.3V7.3z" />
        </PanelIcon>
        <PanelIcon title="Collapse all folders" onClick={collapseAll}>
          <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
          <path d="M4.5 7h5" />
        </PanelIcon>
      </PanelHeader>
      {filter !== null ? (
        <div style={{ flex: 'none', padding: '6px 8px 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <TextInput
            ref={filterRef}
            size="sm"
            autoFocus
            value={filter}
            placeholder="Filter by name"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                e.preventDefault()
                closeFilter()
              } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                // Into the results: the first file found.
                e.preventDefault()
                const hit = rows.find((r) => !r.isDir && r.match) ?? rows.find((r) => r.match) ?? rows[0]
                if (hit) setSelected(hit.path)
                if (e.key === 'Enter' && hit && !hit.isDir) openFile(hit.path)
                treeRef.current?.focus()
              }
            }}
            style={{ flex: 1, fontSize: 12.5 }}
          />
          <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap' }}>{filter.trim() ? `${rows.filter((r) => r.match).length}` : ''}</span>
        </div>
      ) : null}
      <div
        ref={treeRef}
        data-explorer-tree=""
        tabIndex={0}
        onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        onKeyDown={onTreeKey}
        onFocus={() => setTreeFocused(true)}
        onBlur={() => setTreeFocused(false)}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={endDrag}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: '6px 6px 10px',
          outline: 'none',
          // A drop onto the empty space goes to the folder's root.
          background: dropDir === '' ? 'color-mix(in srgb, var(--c-blue) 6%, transparent)' : undefined
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setSelected(null)
          setMenu({ x: e.clientX, y: e.clientY, row: null })
        }}
      >
        {entries === null && listError ? (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, font: '12.5px/1.5 var(--font-ui)', color: 'var(--t3)', overflowWrap: 'anywhere' }}>
            <span>{listError}</span>
            <Button size="sm" onClick={refresh}>
              Retry
            </Button>
          </div>
        ) : entries === null ? (
          <div style={{ padding: 12, color: 'var(--t4)', fontSize: 12.5 }}>Loading…</div>
        ) : (
          <>
            {rows.length === 0 && !creating ? (
              <div style={{ padding: 12, color: 'var(--t4)', fontSize: 12.5 }}>{filter?.trim() ? `Nothing named like “${filter.trim()}”.` : 'No files.'}</div>
            ) : null}
            <div style={{ height: first * ROW_H }} />
            {lines.slice(first, last).map((l) =>
              l.kind === 'create' && creating ? (
                <InlineEditRow key="+create" depth={l.depth} isDir={creating.isDir} value={createName} onChange={setCreateName} onSubmit={submitCreate} onCancel={() => setCreating(null)} />
              ) : l.kind !== 'row' ? null : renaming && renaming.path === l.r.path ? (
                <InlineEditRow key={l.r.path} depth={l.r.depth} isDir={l.r.isDir} value={renameValue} onChange={setRenameValue} onSubmit={submitRename} onCancel={() => setRenaming(null)} />
              ) : (
                <TreeRowView
                    key={l.r.path}
                    row={l.r}
                    tooltip={abs(l.r.path)}
                    active={l.r.path === activePath}
                    selected={picked.has(l.r.path)}
                    lead={l.r.path === selected}
                    dropTarget={!!dropDir && (l.r.path === dropDir || l.r.path.startsWith(`${dropDir}/`))}
                    treeFocused={treeFocused}
                    collapsed={!l.r.open}
                    onClick={(e) => {
                      const r = l.r
                      if (e.shiftKey) return extendTo(r.path)
                      if (e.metaKey || e.ctrlKey) return togglePick(r.path)
                      setSelected(r.path)
                      if (r.isDir) toggleDir(r.path)
                      else openFile(r.path)
                    }}
                    onCreateFile={l.r.isDir ? () => startCreate(l.r.path, false) : undefined}
                    onCreateFolder={l.r.isDir ? () => startCreate(l.r.path, true) : undefined}
                    onContextMenu={(e) => {
                      const r = l.r
                      e.preventDefault()
                      e.stopPropagation()
                      // On one of several selected rows, the menu is for all of them.
                      const multi = picked.has(r.path) && picked.size > 1 ? pickedRows() : undefined
                      if (!multi) setSelected(r.path)
                      treeRef.current?.focus()
                      setMenu({ x: e.clientX, y: e.clientY, row: r, multi })
                    }}
                  />
              )
            )}
            <div style={{ height: (lines.length - last) * ROW_H }} />
          </>
        )}
      </div>
      {menu ? <Menu anchor={menu} items={menuItemsFor(menu.row, menu.multi)} onClose={() => setMenu(null)} /> : null}
    </>
  )
}

function TreeRowView({
  row,
  active,
  selected,
  lead,
  dropTarget,
  treeFocused,
  collapsed,
  onClick,
  onCreateFile,
  onCreateFolder,
  onContextMenu,
  tooltip
}: {
  row: TreeRow
  /** Shown on hover: where it is on disk. */
  tooltip: string
  active: boolean
  selected: boolean
  /** The row the keyboard is on. */
  lead: boolean
  /** Inside the folder a drag would drop into. */
  dropTarget: boolean
  treeFocused: boolean
  collapsed: boolean
  onClick: (e: React.MouseEvent) => void
  onCreateFile?: () => void
  onCreateFolder?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const [ic, icC] = row.isDir ? ['', ''] : fileIcon(row.name)
  const fileFg = row.status === 'added' ? 'var(--c-green)' : row.status === 'modified' ? 'var(--c-code)' : row.status === 'deleted' ? 'var(--c-red)' : row.ignored ? 'var(--t4)' : 'var(--t2)'
  const statusChar = row.status === 'added' ? 'A' : row.status === 'modified' ? 'M' : row.status === 'deleted' ? 'D' : ''
  const dirColor = row.dirHasChanges ? 'var(--c-pin)' : 'var(--t-dim)'
  // What the filter found, marked in the name.
  const name = row.match ? (
    <>
      {row.name.slice(0, row.match[0])}
      <b style={{ color: 'var(--c-blue)', fontWeight: 600 }}>{row.name.slice(row.match[0], row.match[1])}</b>
      {row.name.slice(row.match[1])}
    </>
  ) : (
    row.name
  )

  return (
    <div
      data-path={row.path}
      title={tooltip}
      draggable
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...hoverProps}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 24,
        padding: '0 8px 0 4px',
        borderRadius: 4,
        background: dropTarget
          ? 'color-mix(in srgb, var(--c-blue) 14%, transparent)'
          : active
            ? 'color-mix(in srgb, var(--c-blue) 10%, transparent)'
            : selected
              ? treeFocused
                ? 'color-mix(in srgb, var(--c-blue) 8%, transparent)'
                : 'color-mix(in srgb, var(--ov) 5%, transparent)'
              : hover
                ? 'var(--bg-menu)'
                : 'transparent',
        boxShadow: lead && treeFocused ? 'inset 0 0 0 1px color-mix(in srgb, var(--c-blue) 55%, transparent)' : 'none',
        font: '12.5px var(--font-ui)',
        cursor: 'pointer',
        userSelect: 'none'
      }}
    >
      {Array.from({ length: row.depth }).map((_, i) => (
        <span key={i} style={{ width: 14, flex: 'none', alignSelf: 'stretch', display: 'flex', justifyContent: 'center' }}>
          <span style={{ width: 1, background: 'var(--bd-1)' }} />
        </span>
      ))}
      <span style={{ width: 16, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)' }}>
        {row.isDir ? (
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform .12s ease' }}>
            <path d="M3.5 1.8 6.7 5 3.5 8.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      <span style={{ width: 20, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 5, opacity: row.isDir && row.ignored ? 0.5 : 1 }}>
        {row.isDir ? (
          collapsed ? (
            <svg width="15" height="12" viewBox="0 0 15 12">
              <path d="M1 2.2C1 1.54 1.54 1 2.2 1h3.3l1.4 1.5h5.9c.66 0 1.2.54 1.2 1.2v6.1c0 .66-.54 1.2-1.2 1.2H2.2C1.54 11 1 10.46 1 9.8z" style={{ fill: dirColor, stroke: dirColor }} fillOpacity="0.28" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="15" height="12" viewBox="0 0 15 12">
              <path d="M1 2.2C1 1.54 1.54 1 2.2 1h3.3l1.4 1.5h5.1c.66 0 1.2.54 1.2 1.2V5H4.1L2.2 11H2.2C1.54 11 1 10.46 1 9.8z" style={{ fill: dirColor, stroke: dirColor }} fillOpacity="0.18" strokeWidth="1" />
              <path d="M3.6 5h10.2l-1.9 6H1.7z" style={{ fill: dirColor, stroke: dirColor }} fillOpacity="0.34" strokeWidth="1" strokeLinejoin="round" />
            </svg>
          )
        ) : (
          <span style={{ font: '700 8px/1 var(--font-mono)', color: icC, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{ic}</span>
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: row.isDir ? (row.ignored ? 'var(--t4)' : 'var(--t2)') : active ? 'var(--t1)' : fileFg }}>{name}</span>
      {row.isDir && hover ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 2, marginRight: 2 }}>
          <IconButton
            size={18}
            title="New file"
            onClick={(e) => {
              e.stopPropagation()
              onCreateFile?.()
            }}
          >
            <svg width="10" height="10" viewBox="0 0 12 12">
              <path d="M3.5 1.5h3.2L9 3.8v6.7h-5.5z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
              <path d="M6.5 8v-3M5 6.5h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          </IconButton>
          <IconButton
            size={18}
            title="New folder"
            onClick={(e) => {
              e.stopPropagation()
              onCreateFolder?.()
            }}
          >
            <svg width="10" height="10" viewBox="0 0 12 12">
              <path d="M1.3 3.2c0-.5.4-.9.9-.9h2.4l1 1.1h3.2c.5 0 .9.4.9.9v4.3c0 .5-.4.9-.9.9H2.2c-.5 0-.9-.4-.9-.9z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
              <path d="M6 5.3v3M4.5 6.8h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          </IconButton>
        </span>
      ) : null}
      {row.isDir ? (
        row.dirHasChanges ? <span style={{ color: 'var(--c-amber)', font: '500 11px var(--font-mono)' }}>●</span> : null
      ) : statusChar ? (
        <span style={{ color: statusChar === 'A' ? 'var(--c-green)' : statusChar === 'D' ? 'var(--c-red)' : 'var(--c-amber)', font: '500 11px var(--font-mono)', marginLeft: 6 }}>{statusChar}</span>
      ) : null}
    </div>
  )
}

function InlineEditRow({
  depth,
  isDir,
  value,
  onChange,
  onSubmit,
  onCancel
}: {
  depth: number
  isDir: boolean
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: ROW_H, padding: '0 6px 0 4px' }}>
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} style={{ width: 14, flex: 'none', alignSelf: 'stretch', display: 'flex', justifyContent: 'center' }}>
          <span style={{ width: 1, background: 'var(--bd-1)' }} />
        </span>
      ))}
      <span style={{ width: 16, flex: 'none' }} />
      <span style={{ width: 20, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 5, color: 'var(--t-dim)' }}>
        {isDir ? (
          <svg width="15" height="12" viewBox="0 0 15 12">
            <path d="M1 2.2C1 1.54 1.54 1 2.2 1h3.3l1.4 1.5h5.9c.66 0 1.2.54 1.2 1.2v6.1c0 .66-.54 1.2-1.2 1.2H2.2C1.54 11 1 10.46 1 9.8z" style={{ fill: 'var(--t-dim)', stroke: 'var(--t-dim)' }} fillOpacity="0.28" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="11" height="13" viewBox="0 0 11 13" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M6.5 1H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4.5L6.5 1z" />
            <path d="M6.5 1v3.5H10" />
          </svg>
        )}
      </span>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => (value.trim() ? onSubmit() : onCancel())}
        spellCheck={false}
        placeholder={isDir ? 'New folder name' : 'New file name'}
        style={{ flex: 1, minWidth: 0, height: 22, boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid var(--c-blue)', borderRadius: 3, color: 'var(--t1)', font: '12.5px var(--font-ui)', padding: '0 6px', outline: 'none' }}
      />
    </div>
  )
}
