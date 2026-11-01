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
  /** A file with related ones nested under it: how many, shown or not, and whether one of them changed. */
  nest?: { count: number; open: boolean; changed: boolean }
  /** Nested under this file. */
  nestedIn?: string
}

export interface TreeOptions {
  /** Chains of single folders as one row, as VS Code's compact folders. */
  compact?: boolean
  /** Only what's named like this (and the folders it's in), all opened. */
  filter?: string
  /** File nesting's rules (none: off). */
  nesting?: NestRule[]
  /** The nested groups shown (by their file); the rest are closed. */
  openNests?: Set<string>
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
    const fileRow = (f: TreeItem, d: number, extra: Partial<TreeRow> = {}): TreeRow => {
      const name = nameOf(f.path)
      return { path: f.path, name, depth: d, isDir: false, status: f.status, ignored: f.ignored, dirHasChanges: false, open: false, ...(keep ? { match: matchIn(name) } : {}), ...extra }
    }
    // Nested: related files under their main one (not while filtering - every match shows).
    if (opts.nesting?.length && !keep) {
      const { top, kids } = nestFiles(files, opts.nesting)
      for (const f of top) {
        const under = kids.get(f.path)
        if (!under) {
          rows.push(fileRow(f, depth))
          continue
        }
        const open = !!opts.openNests?.has(f.path)
        rows.push(fileRow(f, depth, { nest: { count: under.length, open, changed: under.some((k) => k.status !== 'unchanged') } }))
        if (open) for (const k of under) rows.push(fileRow(k, depth + 1, { nestedIn: f.path }))
      }
      return
    }
    for (const f of files) {
      if (keep && !keep.has(f.path)) continue
      rows.push(fileRow(f, depth))
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

/**
 * File nesting (Settings → File editor → Explorer), as VS Code's: related
 * files folded under their main one - "package.json: package-lock.json,
 * yarn.lock", "*.ts: ${capture}.test.ts" (${capture}: what the parent's *
 * matched). Rules are lines of "parent: child, child".
 */
export interface NestRule {
  parent: RegExp
  children: string[]
}

/** Used when none are set: lock files, tests, styles and source maps, project files. */
export const DEFAULT_NESTING = [
  'package.json: package-lock.json, yarn.lock, pnpm-lock.yaml, pnpm-workspace.yaml, bun.lockb, bun.lock, .npmrc, .yarnrc*, .nvmrc, .node-version',
  'Gemfile: Gemfile.lock, .ruby-version, .ruby-gemset',
  'go.mod: go.sum, go.work, go.work.sum',
  'Cargo.toml: Cargo.lock, rust-toolchain*',
  'pyproject.toml: poetry.lock, uv.lock, Pipfile, Pipfile.lock, requirements*.txt, setup.cfg, setup.py',
  'composer.json: composer.lock',
  'mix.exs: mix.lock',
  'tsconfig.json: tsconfig.*.json',
  '.env: .env.*',
  'Dockerfile: Dockerfile.*, .dockerignore, docker-compose*.yml, compose*.yml',
  'README.md: CHANGELOG.md, LICENSE*, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, AUTHORS*',
  '*.ts: ${capture}.test.ts, ${capture}.spec.ts, ${capture}.d.ts, ${capture}.js, ${capture}.js.map',
  '*.tsx: ${capture}.test.tsx, ${capture}.spec.tsx, ${capture}.stories.tsx, ${capture}.module.css, ${capture}.module.scss, ${capture}.css',
  '*.js: ${capture}.test.js, ${capture}.spec.js, ${capture}.js.map, ${capture}.min.js',
  '*.jsx: ${capture}.test.jsx, ${capture}.spec.jsx, ${capture}.stories.jsx',
  '*.vue: ${capture}.spec.ts, ${capture}.test.ts',
  '*.css: ${capture}.css.map, ${capture}.min.css',
  '*.scss: ${capture}.css, ${capture}.css.map',
  '*.go: ${capture}_test.go',
  '*.py: test_${capture}.py, ${capture}_test.py'
]

const globBody = (g: string): string => g.replace(/[.+^$()|[\]\\{}]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')

/** "parent: child, child" lines → rules (blank lines and # comments skipped). */
export function parseNesting(lines: string[]): NestRule[] {
  const out: NestRule[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const at = line.indexOf(':')
    if (at <= 0) continue
    const parent = line.slice(0, at).trim()
    const children = line
      .slice(at + 1)
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
    if (!children.length) continue
    // (The parent's first * is what ${capture} stands for.)
    const star = parent.indexOf('*')
    const body = star < 0 ? globBody(parent) : `${globBody(parent.slice(0, star))}(.*?)${globBody(parent.slice(star + 1))}`
    out.push({ parent: new RegExp(`^${body}$`, 'i'), children })
  }
  return out
}

/**
 * One folder's files, nested: the ones shown (each with what's folded under
 * it). A file goes under the first parent that claims it; one that has files
 * under it isn't put under another. Shorter names claim first (foo.ts before
 * foo.test.ts).
 */
export function nestFiles<T extends { path: string }>(files: T[], rules: NestRule[]): { top: T[]; kids: Map<string, T[]> } {
  const name = (f: T): string => f.path.slice(f.path.lastIndexOf('/') + 1)
  const byName = new Map(files.map((f) => [name(f).toLowerCase(), f]))
  const taken = new Set<string>()
  const kids = new Map<string, T[]>()
  const order = [...files].sort((a, b) => name(a).length - name(b).length)
  for (const p of order) {
    if (taken.has(p.path)) continue
    const n = name(p)
    for (const r of rules) {
      const m = r.parent.exec(n)
      if (!m) continue
      const capture = m[1] ?? ''
      for (const c of r.children) {
        const pattern = c.split('${capture}').join(capture)
        const claim = (k: T | undefined): void => {
          if (!k || k === p || taken.has(k.path) || kids.has(k.path)) return
          taken.add(k.path)
          kids.set(p.path, [...(kids.get(p.path) ?? []), k])
        }
        if (/[*?]/.test(pattern)) {
          const re = new RegExp(`^${globBody(pattern)}$`, 'i')
          for (const k of files) if (re.test(name(k))) claim(k)
        } else claim(byName.get(pattern.toLowerCase()))
      }
    }
  }
  return { top: files.filter((f) => !taken.has(f.path)), kids }
}
