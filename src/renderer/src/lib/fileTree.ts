export interface TreeItem {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'unchanged'
  isDir?: boolean
  /** git ignores it (shown dimmed). */
  ignored?: boolean
}

export interface TreeRow extends TreeItem {
  name: string
  depth: number
  isDir: boolean
  dirHasChanges: boolean
}

interface DirNode {
  dirs: Map<string, DirNode>
  files: TreeItem[]
}

export function buildTree(items: TreeItem[], collapsed: Set<string>): TreeRow[] {
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
      ensureDir(parts)
      continue
    }
    ensureDir(parts.slice(0, -1)).files.push(item)
  }

  const changedPaths = items.filter((i) => !i.isDir && i.status !== 'unchanged').map((i) => i.path)
  const rows: TreeRow[] = []

  const walk = (node: DirNode, prefix: string, depth: number): void => {
    const dirNames = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))
    for (const name of dirNames) {
      const full = prefix ? `${prefix}/${name}` : name
      const dirHasChanges = changedPaths.some((p) => p.startsWith(`${full}/`))
      rows.push({ path: full, name, depth, isDir: true, status: 'unchanged', dirHasChanges })
      if (!collapsed.has(full)) walk(node.dirs.get(name)!, full, depth + 1)
    }
    const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path))
    for (const f of files) {
      rows.push({ path: f.path, name: f.path.split('/').pop()!, depth, isDir: false, status: f.status, ignored: f.ignored, dirHasChanges: false })
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
