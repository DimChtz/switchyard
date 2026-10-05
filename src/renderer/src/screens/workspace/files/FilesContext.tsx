import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../../store/AppStore'
import { allDirPaths } from '../../../lib/fileTree'
import { prepareForSave } from '../../../lib/editorPrefs'
import { rememberFile } from '../../../lib/quickOpen'
import { replaceMatches, searchRegex, type TextSearchOptions } from '@shared/textSearch'
import { SEP } from '../../../lib/paths'
import { errText } from '../../../lib/errors'
import { prefsFor } from '../../../lib/projectPrefs'
import { closeWhere, groupsOf, renameTabs } from '../../../lib/wsLayout'
import { setLayout, useLayout, wsOpen, wsShowView } from '../../../lib/wsStore'
import type { EditorConfigProps, FileDoc, FileEntry, Prefs, Task } from '@shared/types'

type DocMeta = Omit<FileDoc, 'text'>
export type DiskState = 'changed' | 'deleted' | 'refused'

// Unsaved edits, per task: leaving the workspace (another task, another
// screen) doesn't lose them - they're there when you're back.
const unsavedEdits = new Map<string, Record<string, string>>()

/** Whether any task has edits not saved yet (closing the window asks first). */
export function hasUnsavedEdits(): boolean {
  return [...unsavedEdits.values()].some((e) => Object.keys(e).length > 0)
}

// Closing (or reloading) the window with unsaved edits: Switchyard asks first (see the main window's will-prevent-unload).
window.addEventListener('beforeunload', (e) => {
  if (!hasUnsavedEdits()) return
  e.preventDefault()
  e.returnValue = ''
})

// The explorer's open folders, per task (kept while the workspace is closed).
const collapsedDirs = new Map<string, Set<string>>()

export interface FilesApi {
  task: Task
  /** The task's folder (its worktree, or the folder holding several). */
  root: string
  /** Native paths for the system. */
  abs: (rel: string) => string
  relOf: (abs: string) => string
  inRoot: (abs: string) => boolean
  /** Everything in the folder (null while it's read). */
  entries: FileEntry[] | null
  refresh: () => void
  /** Bumped on every refresh (search runs again). */
  refreshKey: number
  collapsed: Set<string>
  setCollapsed: (fn: (prev: Set<string>) => Set<string>) => void
  /** Open in an editor tab (the focused group). */
  openFile: (path: string, inGroup?: string) => void
  /** Show it in the explorer: its folders opened, the row selected. */
  reveal: (path: string) => void
  revealReq: { path: string; n: number } | null
  /** The explorer's search, shown and focused. */
  openSearch: () => void
  searchFocus: number
  // Documents
  text: (path: string) => string | undefined
  meta: (path: string) => DocMeta | undefined
  loading: (path: string) => boolean
  ensureLoaded: (path: string) => void
  setEdit: (path: string, text: string) => void
  isDirty: (path: string) => boolean
  disk: Record<string, DiskState>
  resolveDisk: (path: string, take: 'disk' | 'mine') => void
  save: (path: string, quiet?: boolean, force?: boolean) => void
  scheduleAutoSave: (path: string) => void
  /** A file's editor settings: Settings, with its .editorconfig on top. */
  prefsOf: (path: string) => Prefs
  editorConfig: (path: string) => EditorConfigProps | undefined
  /** Gone (deleted): its tabs and edits go. */
  forget: (paths: string[]) => void
  /** Moved or renamed: its tabs and edits follow. */
  remap: (from: string, to: string) => void
  // Search
  unsaved: Record<string, string>
  replaceInEditor: (path: string, o: TextSearchOptions, replacement: string) => number
  onReplaced: (paths: string[]) => void
  /** A line to select once its file shows (a search result). */
  jump: { path: string; line: number; col: number; len: number } | null
  jumpTo: (path: string, line: number, col: number, len: number) => void
  jumped: () => void
}

const Ctx = createContext<FilesApi | null>(null)

/** The files, when the task has a folder (null when it hasn't). */
export function useFilesMaybe(): FilesApi | null {
  return useContext(Ctx)
}

export function useFiles(): FilesApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('useFiles outside FilesProvider')
  return c
}

/** The workspace's files: one task folder, its listing, and its open documents. */
export function FilesProvider({ task, root: rootPath, baseBranch, bases, children }: { task: Task; root: string; baseBranch: string; bases?: Record<string, string>; children: React.ReactNode }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const prefs = prefsFor(state, task.projectId)
  const [entries, setEntries] = useState<FileEntry[] | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [collapsed, setCollapsedState] = useState<Set<string>>(() => collapsedDirs.get(task.id) ?? new Set())
  const collapsedInit = useRef(collapsedDirs.has(task.id))
  const [fileCache, setFileCache] = useState<Record<string, string>>({})
  const [edits, setEdits] = useState<Record<string, string>>(() => unsavedEdits.get(task.id) ?? {})
  // How each open file is stored (line ends, BOM, modified time; binary/large), and what changed under it.
  const metaRef = useRef<Record<string, DocMeta>>({})
  const [disk, setDisk] = useState<Record<string, DiskState>>({})
  const [editorConfigs, setEditorConfigs] = useState<Record<string, EditorConfigProps>>({})
  const [loadingSet, setLoadingSet] = useState<Set<string>>(new Set())
  const [revealReq, setRevealReq] = useState<{ path: string; n: number } | null>(null)
  const [searchFocus, setSearchFocus] = useState(0)
  const [jump, setJump] = useState<{ path: string; line: number; col: number; len: number } | null>(null)

  const setCollapsed = useCallback(
    (fn: (prev: Set<string>) => Set<string>) =>
      setCollapsedState((prev) => {
        const next = fn(prev)
        collapsedDirs.set(task.id, next)
        return next
      }),
    [task.id]
  )

  useEffect(() => {
    const dirty = Object.fromEntries(Object.entries(edits).filter(([p, t]) => fileCache[p] === undefined || t !== fileCache[p]))
    unsavedEdits.set(task.id, dirty)
  }, [task.id, edits, fileCache])

  const refresh = useCallback((): void => {
    setRefreshKey((k) => k + 1)
    window.api.fs.list(rootPath, baseBranch, bases).then((list) => {
      setEntries(list)
      // The first time: every folder closed.
      if (!collapsedInit.current) {
        collapsedInit.current = true
        setCollapsed(() => new Set(allDirPaths(list.map((f) => ({ path: f.path, status: f.status, isDir: f.isDir })))))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, baseBranch, JSON.stringify(bases ?? null), setCollapsed])

  // A different checkout or base lists again (other changes refresh through the file watcher).
  useEffect(refresh, [refresh])

  // Native paths for the system: file manager, terminals, copies.
  // (git may give the worktree's path with "/" on Windows; the system answers with "\".)
  const root = rootPath.split(/[\\/]/).join(SEP)
  const abs = useCallback((rel: string): string => (rel ? `${root}${SEP}${rel.split('/').join(SEP)}` : root), [root])
  const relOf = useCallback((p: string): string => p.slice(root.length + 1).split(/[\\/]/).join('/'), [root])
  const inRoot = useCallback((p: string): boolean => p.split(/[\\/]/).join(SEP).toLowerCase().startsWith((root + SEP).toLowerCase()), [root])

  /** Reads a file as the editor opens it (text, line ends, BOM, modified time) into the cache. */
  const loadDoc = useCallback(
    async (path: string): Promise<FileDoc> => {
      const doc = await window.api.fs.readDoc(`${rootPath}/${path}`)
      const { text, ...rest } = doc
      metaRef.current[path] = rest
      setFileCache((c) => ({ ...c, [path]: text }))
      return doc
    },
    [rootPath]
  )

  const loadingRef = useRef(new Set<string>())
  const cacheRef = useRef(fileCache)
  cacheRef.current = fileCache
  const ensureLoaded = useCallback(
    (path: string): void => {
      if (cacheRef.current[path] !== undefined || loadingRef.current.has(path)) return
      loadingRef.current.add(path)
      setLoadingSet(new Set(loadingRef.current))
      loadDoc(path)
        .catch((err: unknown) => {
          dispatch({ type: 'TOAST', text: `Could not open ${path}: ${errText(err)}` })
          setFileCache((c) => ({ ...c, [path]: '' }))
        })
        .finally(() => {
          loadingRef.current.delete(path)
          setLoadingSet(new Set(loadingRef.current))
        })
      // .editorconfig for it (Settings → File editor: Follow .editorconfig).
      if (prefs.editorConfig)
        window.api.fs
          .editorConfig(`${rootPath}/${path}`)
          .then((ec) => setEditorConfigs((m) => ({ ...m, [path]: ec })))
          .catch(() => {})
    },
    [loadDoc, dispatch, prefs.editorConfig, rootPath]
  )

  // Live: the agent's edits (and git's) show up - in the explorer, and in
  // open files that have no unsaved edits. A file you're editing that
  // changed on disk says so instead of being replaced.
  const liveRef = useRef<{ paths: Set<string>; timer: ReturnType<typeof setTimeout> | null }>({ paths: new Set(), timer: null })
  const latest = useRef({ fileCache, edits, refresh })
  latest.current = { fileCache, edits, refresh }
  useEffect(
    () =>
      window.api.fs.watch(rootPath, ({ paths, git }) => {
        const live = liveRef.current
        for (const p of paths) live.paths.add(p)
        if (git) live.paths.add('')
        live.timer ??= setTimeout(() => {
          live.timer = null
          const changed = [...live.paths]
          live.paths.clear()
          const { fileCache: cache, edits: ed } = latest.current
          latest.current.refresh()
          for (const p of changed) {
            if (cache[p] === undefined) continue
            const m = metaRef.current[p]
            window.api.fs
              .readDoc(`${rootPath}/${p}`)
              .then((doc) => {
                if (m && doc.mtime === m.mtime) return
                const dirty = ed[p] !== undefined && ed[p] !== cache[p]
                if (dirty) return setDisk((d) => ({ ...d, [p]: 'changed' }))
                const { text, ...rest } = doc
                metaRef.current[p] = rest
                setFileCache((c) => ({ ...c, [p]: text }))
                setEdits((e) => {
                  if (e[p] === undefined) return e
                  const next = { ...e }
                  delete next[p]
                  return next
                })
              })
              .catch(() => setDisk((d) => ({ ...d, [p]: 'deleted' })))
          }
        }, 250)
      }),
    [rootPath]
  )

  const isDirty = useCallback((path: string): boolean => edits[path] !== undefined && edits[path] !== fileCache[path], [edits, fileCache])

  const editorConfig = useCallback((path: string) => (prefs.editorConfig ? editorConfigs[path] : undefined), [prefs.editorConfig, editorConfigs])
  const prefsOf = useCallback(
    (path: string): Prefs => {
      const ec = editorConfig(path)
      if (!ec) return prefs
      return {
        ...prefs,
        editorTabSize: ec.indent_size ?? ec.tab_width ?? prefs.editorTabSize,
        editorUseTabs: ec.indent_style ? ec.indent_style === 'tab' : prefs.editorUseTabs,
        editorTrimOnSave: ec.trim_trailing_whitespace ?? prefs.editorTrimOnSave,
        editorFinalNewline: ec.insert_final_newline ?? prefs.editorFinalNewline
      }
    },
    [prefs, editorConfig]
  )

  // Settings → File editor: trim / final newline on save, auto save.
  const save = (path: string, quiet = false, force = false): void => {
    const current = edits[path] ?? fileCache[path]
    const m = metaRef.current[path]
    if (current === undefined || (m && m.kind !== 'text')) return
    const text = prepareForSave(current, prefsOf(path))
    // Line ends and BOM as the file had them - or as its .editorconfig says.
    const ec = editorConfig(path)
    const eol = ec?.end_of_line === 'crlf' ? '\r\n' : ec?.end_of_line === 'lf' ? '\n' : (m?.eol ?? '\n')
    const bom = ec?.charset === 'utf-8-bom' ? true : ec?.charset === 'utf-8' ? false : (m?.bom ?? false)
    window.api.fs
      .writeDoc(`${rootPath}/${path}`, text, { eol, bom, expectMtime: force ? null : (m?.mtime ?? null) })
      .then((mtime) => {
        if (m) metaRef.current[path] = { ...m, mtime, eol, bom }
        setFileCache((c) => ({ ...c, [path]: text }))
        setDisk((d) => {
          const next = { ...d }
          delete next[path]
          return next
        })
        setEdits((e) => {
          if (e[path] !== current) return e
          const next = { ...e }
          delete next[path]
          return next
        })
        if (!quiet) dispatch({ type: 'TOAST', text: 'Saved.' })
        refresh()
      })
      .catch((err: unknown) => {
        // Someone (the agent) changed it since it was opened: not written over without asking.
        if (errText(err).includes('CHANGED_ON_DISK')) return setDisk((d) => ({ ...d, [path]: 'refused' }))
        dispatch({ type: 'TOAST', text: `Could not save ${path}: ${errText(err)}` })
      })
  }
  const saveRef = useRef(save)
  saveRef.current = save

  // Auto save after a delay: one timer per file, so switching files doesn't
  // drop a pending save. The timer calls the latest save (latest edits).
  const autoSaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const scheduleAutoSave = useCallback(
    (path: string): void => {
      if (prefs.editorAutoSave !== 'delay') return
      clearTimeout(autoSaveTimers.current.get(path))
      autoSaveTimers.current.set(
        path,
        setTimeout(() => {
          autoSaveTimers.current.delete(path)
          saveRef.current(path, true)
        }, 1000)
      )
    },
    [prefs.editorAutoSave]
  )

  /** Changed on disk while edited: take the disk's version (dropping the edits), or keep yours (save overwrites). */
  const resolveDisk = (path: string, take: 'disk' | 'mine'): void => {
    setDisk((d) => {
      const next = { ...d }
      delete next[path]
      return next
    })
    if (take === 'mine') return save(path, false, true)
    setEdits((e) => {
      const next = { ...e }
      delete next[path]
      return next
    })
    loadDoc(path).catch(() => forget([path]))
  }

  const forget = useCallback(
    (paths: string[]): void => {
      if (!paths.length) return
      const gone = (p: string): boolean => paths.includes(p)
      setFileCache((c) => Object.fromEntries(Object.entries(c).filter(([p]) => !gone(p))))
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([p]) => !gone(p))))
      setLayout(task.id, (L) => closeWhere(L, (id) => id.startsWith('file:') && gone(id.slice(5))))
    },
    [task.id]
  )

  const remap = useCallback(
    (from: string, to: string): void => {
      const map = (p: string): string => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)
      const rekey = <T,>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [map(k), v]))
      setFileCache(rekey)
      setEdits(rekey)
      metaRef.current = rekey(metaRef.current)
      setLayout(task.id, (L) => renameTabs(L, (id) => (id.startsWith('file:') ? `file:${map(id.slice(5))}` : id)))
    },
    [task.id]
  )

  const openFile = useCallback(
    (path: string, inGroup?: string): void => {
      // Go to file lists it on top next time.
      rememberFile(rootPath, path)
      wsOpen(task.id, `file:${path}`, inGroup)
    },
    [rootPath, task.id]
  )

  const reveal = useCallback((path: string): void => {
    wsShowView('explorer')
    setRevealReq((r) => ({ path, n: (r?.n ?? 0) + 1 }))
  }, [])

  const openSearch = useCallback((): void => {
    wsShowView('search')
    setSearchFocus((n) => n + 1)
  }, [])

  // Unsaved editor text, which search looks in instead of the disk.
  const unsaved = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [p, text] of Object.entries(edits)) if (text !== fileCache[p]) out[p] = text
    return out
  }, [edits, fileCache])

  /** Replace in an open file's unsaved text (search's Replace); how many. */
  const replaceInEditor = (path: string, o: TextSearchOptions, replacement: string): number => {
    const { rx } = searchRegex(o)
    const text = edits[path]
    if (!rx || text === undefined) return 0
    const r = replaceMatches(text, rx, replacement, o.regex)
    if (r.count) setEdits((e) => ({ ...e, [path]: r.text }))
    return r.count
  }
  /** Files search replaced on disk: read them again. */
  const onReplaced = (paths: string[]): void => {
    setFileCache((c) => Object.fromEntries(Object.entries(c).filter(([p]) => !paths.includes(p))))
    refresh()
  }

  // Files whose tabs all closed: their saved text needn't stay in memory (unsaved edits do).
  const layoutFiles = groupsOf(useLayout(task.id).root)
    .flatMap((g) => g.tabs)
    .filter((t) => t.startsWith('file:'))
    .join('|')
  useEffect(() => {
    const open = new Set(layoutFiles.split('|').map((t) => t.slice(5)))
    setFileCache((c) => {
      const stale = Object.keys(c).filter((p) => !open.has(p) && edits[p] === undefined)
      if (!stale.length) return c
      for (const p of stale) delete metaRef.current[p]
      return Object.fromEntries(Object.entries(c).filter(([p]) => !stale.includes(p)))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutFiles])

  const api: FilesApi = {
    task,
    root: rootPath,
    abs,
    relOf,
    inRoot,
    entries,
    refresh,
    refreshKey,
    collapsed,
    setCollapsed,
    openFile,
    reveal,
    revealReq,
    openSearch,
    searchFocus,
    text: (path) => edits[path] ?? fileCache[path],
    meta: (path) => metaRef.current[path],
    loading: (path) => loadingSet.has(path) && fileCache[path] === undefined,
    ensureLoaded,
    setEdit: (path, text) => setEdits((e) => ({ ...e, [path]: text })),
    isDirty,
    disk,
    resolveDisk,
    save,
    scheduleAutoSave,
    prefsOf,
    editorConfig,
    forget,
    remap,
    unsaved,
    replaceInEditor,
    onReplaced,
    jump,
    jumpTo: (path, line, col, len) => {
      openFile(path)
      setJump({ path, line, col, len })
    },
    jumped: () => setJump(null)
  }
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}
