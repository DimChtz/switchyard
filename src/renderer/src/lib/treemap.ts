/**
 * The repository map's layout: folders and files as nested rectangles,
 * sized by how much each holds (squarified, so they stay close to square).
 */

export interface MapNode {
  name: string
  /** Its path in the repository ('' for the root). */
  path: string
  /** Its weight: the file's, or the sum of what's inside. */
  size: number
  children?: MapNode[]
  /** Not on the default branch yet (a task made it). */
  isNew?: boolean
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Placed {
  node: MapNode
  rect: Rect
  depth: number
  /** A folder whose insides are too small to draw: shown as one block. */
  folded?: boolean
  /** A folder's label strip along its top. */
  header?: number
}

/** A file's weight: its size, capped (a lockfile mustn't take the map), plus a floor (an empty file still shows). */
export function weight(bytes: number): number {
  return Math.min(bytes, 48 * 1024) + 800
}

/** The folder tree for these files; `added` are new files (not on the default branch) to fit in. */
export function buildTree(files: { path: string; size: number }[], added: string[] = []): MapNode {
  const root: MapNode = { name: '', path: '', size: 0, children: [] }
  const dirs = new Map<string, MapNode>([['', root]])
  const dirOf = (path: string): MapNode => {
    const hit = dirs.get(path)
    if (hit) return hit
    const cut = path.lastIndexOf('/')
    const parent = dirOf(cut < 0 ? '' : path.slice(0, cut))
    const node: MapNode = { name: path.slice(cut + 1), path, size: 0, children: [] }
    parent.children!.push(node)
    dirs.set(path, node)
    return node
  }
  const known = new Set<string>()
  const add = (path: string, size: number, isNew?: boolean): void => {
    const cut = path.lastIndexOf('/')
    dirOf(cut < 0 ? '' : path.slice(0, cut)).children!.push({ name: path.slice(cut + 1), path, size: weight(size), isNew })
    known.add(path)
  }
  for (const f of files) add(f.path, f.size)
  for (const p of added) if (!known.has(p)) add(p, 2048, true)
  const total = (n: MapNode): number => {
    if (!n.children) return n.size
    n.size = n.children.reduce((s, c) => s + total(c), 0)
    n.children.sort((a, b) => b.size - a.size)
    return n.size
  }
  total(root)
  return root
}

/** The node at a path (a folder to zoom into), or undefined. */
export function find(root: MapNode, path: string): MapNode | undefined {
  if (!path) return root
  let node: MapNode | undefined = root
  for (const part of path.split('/')) {
    node = node?.children?.find((c) => c.name === part && !!c.children)
    if (!node) return undefined
  }
  return node
}

/** The worst aspect ratio in a row of areas laid along a side of length `side`. */
function worst(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0)
  const max = Math.max(...row)
  const min = Math.min(...row)
  const s2 = side * side
  const sum2 = sum * sum
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min))
}

/** Squarified layout of weights in a rectangle (they're sorted largest first). */
export function squarify(sizes: number[], rect: Rect): Rect[] {
  const out: Rect[] = []
  const total = sizes.reduce((a, b) => a + b, 0)
  if (!total || rect.w <= 0 || rect.h <= 0) return sizes.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }))
  const scale = (rect.w * rect.h) / total
  const areas = sizes.map((s) => s * scale)
  let { x, y, w, h } = rect
  let i = 0
  while (i < areas.length) {
    const side = Math.min(w, h)
    const row = [areas[i]]
    let j = i + 1
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) row.push(areas[j++])
    const sum = row.reduce((a, b) => a + b, 0)
    if (w >= h) {
      // A column along the left side.
      const cw = sum / h
      let cy = y
      for (const a of row) {
        const ch = a / cw
        out.push({ x, y: cy, w: cw, h: ch })
        cy += ch
      }
      x += cw
      w -= cw
    } else {
      // A row along the top.
      const rh = sum / w
      let cx = x
      for (const a of row) {
        const rw = a / rh
        out.push({ x: cx, y, w: rw, h: rh })
        cx += rw
      }
      y += rh
      h -= rh
    }
    i = j
  }
  return out
}

/**
 * Every rectangle to draw, parents before their insides. A folder big
 * enough gets a label strip; one too small to show its insides is folded.
 */
export function layout(root: MapNode, rect: Rect, opts: { header?: number; pad?: number; minSide?: number } = {}): Placed[] {
  const header = opts.header ?? 16
  const pad = opts.pad ?? 2
  const minSide = opts.minSide ?? 7
  const out: Placed[] = []
  const place = (node: MapNode, r: Rect, depth: number): void => {
    if (!node.children) {
      out.push({ node, rect: r, depth })
      return
    }
    const roomy = r.w > 64 && r.h > 34
    const inner: Rect = roomy ? { x: r.x + pad, y: r.y + header, w: r.w - pad * 2, h: r.h - header - pad } : { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }
    const tooSmall = inner.w < minSide || inner.h < minSide || (inner.w * inner.h) / Math.max(1, node.children.length) < minSide * minSide
    if (depth > 0 && tooSmall) {
      out.push({ node, rect: r, depth, folded: true })
      return
    }
    if (depth > 0) out.push({ node, rect: r, depth, header: roomy ? header : 0 })
    const rects = squarify(
      node.children.map((c) => c.size),
      depth > 0 ? inner : r
    )
    node.children.forEach((c, i) => place(c, rects[i], depth + 1))
  }
  place(root, rect, 0)
  return out
}

/** Where a path shows: its own rectangle, or the folded folder (or nearest one drawn) it's inside. */
export function placeOf(placed: Map<string, Placed>, path: string): Placed | undefined {
  for (let p = path; ; ) {
    const hit = placed.get(p)
    if (hit) return hit
    const cut = p.lastIndexOf('/')
    if (cut < 0) return undefined
    p = p.slice(0, cut)
  }
}

/** The deepest folder holding all these paths ('' for the root). */
export function commonFolder(paths: string[]): string {
  if (!paths.length) return ''
  const parts = paths.map((p) => p.split('/').slice(0, -1))
  const first = parts[0]
  let n = 0
  while (n < first.length && parts.every((x) => x[n] === first[n])) n++
  return first.slice(0, n).join('/')
}
