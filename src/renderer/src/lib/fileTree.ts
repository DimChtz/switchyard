import type { FileEntry, FilesPatch } from '@shared/types'

export interface TreeItem {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'unchanged'
  isDir?: boolean
  /** git ignores it (shown dimmed). */
  ignored?: boolean
  /** A folder git ignores whole: what's in it is listed when it's opened. */
  lazy?: boolean
}

export interface TreeRow extends TreeItem {
  /** What the row says: the name - for compact folders, the chain ("app/models/concerns"). */
  name: string
  depth: number
  isDir: boolean
  dirHasChanges: boolean
  /** A folder showing what's in it (opened, or opened to show what a filter found). */
  open: boolean
  /** Where the filter matched in `name`. */
  match?: [number, number]
}

export interface TreeOptions {
  /** Chains of single folders as one row, as VS Code's compact folders. */
  compact?: boolean
  /** Only what's named like this (and the folders it's in), all opened. */
  filter?: string
}

interface DirNode {
  dirs: Map<string, DirNode>
  files: TreeItem[]
  item?: TreeItem
}

export function buildTree(items: TreeItem[], collapsed: Set<string>, opts: TreeOptions = {}): TreeRow[] {
  const root: DirNode = { dirs: new Map(), files: [] }

  const ensureDir = (parts: string[]): DirNode => {
    let node = root
    for (const part of parts) {
      let next = node.dirs.get(part)
      if (!next) {
        next = { dirs: new Map(), files: [] }
        node.dirs.set(part, next)
      }
      node = next
    }
    return node
  }

  for (const item of items) {
    const parts = item.path.split('/')
    if (item.isDir) {
      ensureDir(parts).item = item
      continue
    }
    ensureDir(parts.slice(0, -1)).files.push(item)
  }

  // The folders with a change somewhere inside (once - a big repo has thousands of folders).
  const changedDirs = new Set<string>()
  for (const i of items) {
    if (i.isDir || i.status === 'unchanged') continue
    for (let s = i.path.lastIndexOf('/'); s > 0; s = i.path.lastIndexOf('/', s - 1)) {
      const dir = i.path.slice(0, s)
      if (changedDirs.has(dir)) break
      changedDirs.add(dir)
    }
  }

  // Filtering: what matches by name, and the folders it's in (shown open).
  const q = opts.filter?.trim().toLowerCase() ?? ''
  const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
  let keep: Set<string> | null = null
  if (q) {
    keep = new Set()
    const add = (p: string): void => {
      keep!.add(p)
      for (let s = p.lastIndexOf('/'); s > 0; s = p.lastIndexOf('/', s - 1)) {
        const dir = p.slice(0, s)
        if (keep!.has(dir)) break
        keep!.add(dir)
      }
    }
    for (const i of items) {
      if (nameOf(i.path).toLowerCase().includes(q)) add(i.path)
      // (A folder known only through its files.)
      if (!i.isDir) for (let s = i.path.lastIndexOf('/'); s > 0; s = i.path.lastIndexOf('/', s - 1)) if (nameOf(i.path.slice(0, s)).toLowerCase().includes(q)) add(i.path.slice(0, s))
    }
  }
  const matchIn = (name: string): [number, number] | undefined => {
    if (!q) return undefined
    const at = name.toLowerCase().lastIndexOf(q)
    return at >= 0 ? [at, at + q.length] : undefined
  }

  const rows: TreeRow[] = []
  const walk = (node: DirNode, prefix: string, depth: number): void => {
    const dirNames = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))
    for (const first of dirNames) {
      let name = first
      let full = prefix ? `${prefix}/${first}` : first
      let dir = node.dirs.get(first)!
      if (keep && !keep.has(full)) continue
      // Compact: a folder holding only one folder is one row with it.
      if (opts.compact && !keep)
        while (dir.files.length === 0 && dir.dirs.size === 1) {
          const [only, next] = [...dir.dirs][0]
          name = `${name}/${only}`
          full = `${full}/${only}`
          dir = next
        }
      // Filtering: a folder a match is in is open; a matching folder only by itself is as it was left.
      const hasKept = keep ? [...dir.dirs.keys()].some((d) => keep!.has(`${full}/${d}`)) || dir.files.some((f) => keep!.has(f.path)) : false
      const open = keep ? hasKept : !collapsed.has(full)
      rows.push({
        path: full,
        name,
        depth,
        isDir: true,
        status: 'unchanged',
        dirHasChanges: changedDirs.has(full),
        open,
        ...(dir.item?.ignored ? { ignored: true } : {}),
        ...(dir.item?.lazy ? { lazy: true } : {}),
        ...(keep ? { match: matchIn(name) } : {})
      })
      if (open) walk(dir, full, depth + 1)
    }
    const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path))
    for (const f of files) {
      if (keep && !keep.has(f.path)) continue
      const name = nameOf(f.path)
      rows.push({ path: f.path, name, depth, isDir: false, status: f.status, ignored: f.ignored, dirHasChanges: false, open: false, ...(keep ? { match: matchIn(name) } : {}) })
    }
  }

  walk(root, '', 0)
  return rows
}

export function allDirPaths(items: TreeItem[]): string[] {
  const dirs = new Set<string>()
  for (const item of items) {
    const parts = item.path.split('/')
    const end = item.isDir ? parts.length : parts.length - 1
    for (let i = 1; i <= end; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  return [...dirs]
}

/**
 * Settings → File editor → Hide in the explorer: names or globs, as VS Code's
 * files.exclude. Without a "/" a pattern is a name anywhere ("tmp", "*.log");
 * with one, a path from the top ("public/assets", "app/**\/*.snap"). What's
 * inside a hidden folder is hidden too.
 */
export function excludeMatcher(patterns: string[]): ((path: string) => boolean) | null {
  const res: RegExp[] = []
  for (const raw of patterns) {
    const p = raw.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    if (!p || p.startsWith('#')) continue
    const anywhere = !p.replace(/^\//, '').includes('/') || p.startsWith('**/')
    const body = p
      .replace(/^\/|^\*\*\//, '')
      .split('/')
      .map((seg) => (seg === '**' ? '(?:.*)' : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')))
      .join('/')
      .replace(/\/\(\?:\.\*\)/g, '(?:/.*)?')
    res.push(new RegExp(`${anywhere ? '(?:^|/)' : '^'}${body}$`, 'i'))
  }
  if (!res.length) return null
  const memo = new Map<string, boolean>()
  const hit = (p: string): boolean => {
    let v = memo.get(p)
    if (v === undefined) {
      const slash = p.lastIndexOf('/')
      v = (slash > 0 && hit(p.slice(0, slash))) || res.some((r) => r.test(p))
      memo.set(p, v)
    }
    return v
  }
  return hit
}

/**
 * The listing with what some paths are now (see fs.patch) - or null when it
 * can't be done path by path (a folder appeared that it doesn't know: list again).
 */
export function applyPatch(entries: FileEntry[], patch: FilesPatch): FileEntry[] | null {
  const known = new Map(entries.map((e, i) => [e.path, i]))
  const hasUnder = (dir: string): boolean => known.has(dir) || entries.some((e) => e.path.startsWith(`${dir}/`))
  for (const e of patch.entries) if (e.isDir && !hasUnder(e.path)) return null
  const gone = patch.gone
  const out = gone.length ? entries.filter((e) => !gone.some((g) => e.path === g || e.path.startsWith(`${g}/`))) : [...entries]
  if (gone.length) {
    known.clear()
    out.forEach((e, i) => known.set(e.path, i))
  }
  for (const e of patch.entries) {
    if (e.isDir) continue
    const at = known.get(e.path)
    if (at === undefined) {
      known.set(e.path, out.length)
      out.push(e)
    } else out[at] = e
  }
  return out
}
