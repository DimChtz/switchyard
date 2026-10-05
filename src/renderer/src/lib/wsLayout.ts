/**
 * The workspace's editor area: a tree of splits whose leaves are groups of
 * tabs (VS Code's editor groups). Pure functions over plain data - the
 * workspace keeps one layout per task (see wsStore).
 *
 * Tab ids: 'agent', 'setup', 'tests', 'shell:<session id>', 'file:<path>',
 * 'diff:<path>', 'preview', 'notes', 'timeline' (paths are relative to the
 * task's folder).
 */

export type TabId = string
export interface Group {
  g: string
  tabs: TabId[]
  /** The tab showing. */
  a: TabId | null
}
export interface Split {
  d: 'row' | 'col'
  c: LayoutNode[]
  /** Each child's share (they add up to 1). */
  z: number[]
}
export type LayoutNode = Group | Split
export interface Layout {
  root: LayoutNode
  focus: string
  /** A group filling the whole area for now. */
  max: string | null
  /** The next group's number. */
  n: number
}
export type Zone = 'left' | 'right' | 'top' | 'bottom' | 'center'
export type Side = 'L' | 'R'
export type ViewId = 'task' | 'explorer' | 'search' | 'changes' | 'sessions' | 'activity'

export const isGroup = (n: LayoutNode): n is Group => 'g' in n

/** A file's tab can be open in several groups at once (a split of the same file); a terminal can't. */
export const canDuplicate = (id: TabId): boolean => /^(file|diff):/.test(id) || id === 'preview' || id === 'notes' || id === 'timeline'

export function defaultLayout(tabs: TabId[] = ['agent']): Layout {
  return { root: { g: 'g1', tabs, a: tabs[0] ?? null }, focus: 'g1', max: null, n: 2 }
}

export function groupsOf(n: LayoutNode, out: Group[] = []): Group[] {
  if (isGroup(n)) out.push(n)
  else n.c.forEach((c) => groupsOf(c, out))
  return out
}

interface Found {
  node: Group
  parent: Split | null
  idx: number
}
export function findGroup(n: LayoutNode, gid: string, parent: Split | null = null, idx = -1): Found | null {
  if (isGroup(n)) return n.g === gid ? { node: n, parent, idx } : null
  for (let i = 0; i < n.c.length; i++) {
    const r = findGroup(n.c[i], gid, n, i)
    if (r) return r
  }
  return null
}

/**
 * Tidies a layout after a change: empty groups go (the last one stays),
 * a split of one is its child, a split inside a split the same way is
 * merged into it, shares add up to 1, and focus/max/active point at what's
 * there.
 */
export function clean(L: Layout): Layout {
  const fix = (n: LayoutNode): LayoutNode | null => {
    if (isGroup(n)) return n.tabs.length ? n : null
    const kids: LayoutNode[] = []
    const z: number[] = []
    n.c.forEach((c, i) => {
      const r = fix(c)
      if (!r) return
      if (!isGroup(r) && r.d === n.d)
        r.c.forEach((cc, j) => {
          kids.push(cc)
          z.push(n.z[i] * r.z[j])
        })
      else {
        kids.push(r)
        z.push(n.z[i])
      }
    })
    if (!kids.length) return null
    if (kids.length === 1) return kids[0]
    const sum = z.reduce((a, b) => a + b, 0) || 1
    n.c = kids
    n.z = z.map((v) => v / sum)
    return n
  }
  // Nothing open anywhere: one empty group (the same one, when it was one already).
  const wasGroup = isGroup(L.root) ? L.root : null
  L.root = fix(L.root) ?? (wasGroup ? { ...wasGroup, tabs: [], a: null } : { g: `g${L.n++}`, tabs: [], a: null })
  const gs = groupsOf(L.root)
  if (!gs.some((g) => g.g === L.focus)) L.focus = gs[0].g
  if (L.max && !gs.some((g) => g.g === L.max)) L.max = null
  for (const g of gs) if (!g.a || !g.tabs.includes(g.a)) g.a = g.tabs[g.tabs.length - 1] ?? null
  return L
}

/** A changed copy, tidied. */
export function update(L: Layout, fn: (draft: Layout) => void): Layout {
  const draft = structuredClone(L)
  fn(draft)
  return clean(draft)
}

/** Shows a tab: where it's open already (the focused group first), else in the focused group. */
export function openTab(L: Layout, id: TabId, inGroup?: string): Layout {
  return update(L, (d) => {
    const gs = groupsOf(d.root)
    const target = inGroup ? gs.find((g) => g.g === inGroup) : undefined
    const focused = gs.find((g) => g.g === d.focus)
    let g = target?.tabs.includes(id) ? target : focused?.tabs.includes(id) ? focused : target ? undefined : gs.find((x) => x.tabs.includes(id))
    if (!g) {
      g = target ?? focused ?? gs[0]
      // Not a second copy of a terminal: it moves here.
      if (!canDuplicate(id)) for (const o of gs) o.tabs = o.tabs.filter((x) => x !== id)
      g.tabs.push(id)
    }
    g.a = id
    d.focus = g.g
    if (d.max && d.max !== g.g) d.max = null
  })
}

/** Closes a tab in one group (or everywhere, without a group). */
export function closeTab(L: Layout, id: TabId, gid?: string): Layout {
  return update(L, (d) => {
    for (const g of groupsOf(d.root)) {
      if (gid && g.g !== gid) continue
      const i = g.tabs.indexOf(id)
      if (i < 0) continue
      g.tabs.splice(i, 1)
      if (g.a === id) g.a = g.tabs[Math.max(0, i - 1)] ?? null
    }
  })
}

/** Closes every tab the test picks (a deleted file's, a shell that's gone). */
export function closeWhere(L: Layout, test: (id: TabId) => boolean): Layout {
  if (!groupsOf(L.root).some((g) => g.tabs.some(test))) return L
  return update(L, (d) => {
    for (const g of groupsOf(d.root)) g.tabs = g.tabs.filter((x) => !test(x))
  })
}

/** Renames tabs (a file moved): `map` gives the new id, or the same one. */
export function renameTabs(L: Layout, map: (id: TabId) => TabId): Layout {
  if (!groupsOf(L.root).some((g) => g.tabs.some((x) => map(x) !== x))) return L
  return update(L, (d) => {
    for (const g of groupsOf(d.root)) {
      g.tabs = [...new Set(g.tabs.map(map))]
      if (g.a) g.a = map(g.a)
    }
  })
}

/** A tab swapped for another in its place (a diff's Next file); just shown when the group has that one already. */
export function replaceTab(L: Layout, gid: string, oldId: TabId, newId: TabId): Layout {
  return update(L, (d) => {
    const r = findGroup(d.root, gid)
    if (!r) return
    const g = r.node
    if (!g.tabs.includes(newId)) {
      const i = g.tabs.indexOf(oldId)
      if (i < 0) g.tabs.push(newId)
      else g.tabs[i] = newId
    }
    g.a = newId
    d.focus = gid
  })
}

export function activate(L: Layout, gid: string, id: TabId): Layout {
  return update(L, (d) => {
    const r = findGroup(d.root, gid)
    if (!r || !r.node.tabs.includes(id)) return
    r.node.a = id
    d.focus = gid
  })
}

export function focusGroup(L: Layout, gid: string): Layout {
  return L.focus === gid ? L : update(L, (d) => void (d.focus = gid))
}

function insertBeside(d: Layout, gid: string, ng: Group, zone: Exclude<Zone, 'center'>): void {
  const dir = zone === 'left' || zone === 'right' ? 'row' : 'col'
  const before = zone === 'left' || zone === 'top'
  const r = findGroup(d.root, gid)
  if (!r) return
  if (r.parent && r.parent.d === dir) {
    const half = r.parent.z[r.idx] / 2
    const at = before ? r.idx : r.idx + 1
    r.parent.z.splice(r.idx, 1, half)
    r.parent.z.splice(at, 0, half)
    r.parent.c.splice(at, 0, ng)
  } else {
    const sp: Split = { d: dir, c: before ? [ng, r.node] : [r.node, ng], z: [0.5, 0.5] }
    if (r.parent) r.parent.c[r.idx] = sp
    else d.root = sp
  }
}

/**
 * Split right/down (the group's buttons, ⌘\): its tab in a new group beside
 * it - a copy for a file, moved for a terminal. Null when there's nothing
 * to split off (one terminal tab: a new shell goes there instead).
 */
export function splitGroup(L: Layout, gid: string, zone: Exclude<Zone, 'center'>): Layout | null {
  const r = findGroup(L.root, gid)
  if (!r) return null
  const id = r.node.a
  if (!id || (!canDuplicate(id) && r.node.tabs.length < 2)) return null
  return update(L, (d) => {
    const r2 = findGroup(d.root, gid)!
    if (!canDuplicate(id)) r2.node.tabs = r2.node.tabs.filter((x) => x !== id)
    const ng: Group = { g: `g${d.n++}`, tabs: [id], a: id }
    insertBeside(d, gid, ng, zone)
    d.focus = ng.g
    d.max = null
  })
}

/** A new tab in a new group beside one (a new shell split off). */
export function openBeside(L: Layout, gid: string, zone: Exclude<Zone, 'center'>, id: TabId): Layout {
  return update(L, (d) => {
    if (!canDuplicate(id)) for (const g of groupsOf(d.root)) g.tabs = g.tabs.filter((x) => x !== id)
    const ng: Group = { g: `g${d.n++}`, tabs: [id], a: id }
    if (!findGroup(d.root, gid)) gid = groupsOf(d.root)[0].g
    insertBeside(d, gid, ng, zone)
    d.focus = ng.g
    d.max = null
  })
}

/**
 * A dragged tab dropped on a group: into its tabs (center, or the tab bar
 * before `beforeId`), or beside it in a new group (an edge). `from` is the
 * group it was dragged out of - none for something dragged from a side bar
 * (it's opened, not moved).
 */
export function dropTab(L: Layout, id: TabId, from: string | null, gid: string, zone: Zone | 'bar', beforeId: TabId | null = null): Layout {
  return update(L, (d) => {
    const target = findGroup(d.root, gid)
    if (!target) return
    const src = from ? findGroup(d.root, from) : null
    // Out of the group it was dragged from. A terminal is in one place only,
    // wherever it was dragged from; a file from a side bar comes as a copy.
    const takeOut = (): void => {
      if (src) src.node.tabs = src.node.tabs.filter((x) => x !== id)
      else if (!canDuplicate(id)) for (const g of groupsOf(d.root)) g.tabs = g.tabs.filter((x) => x !== id)
    }
    if (zone === 'center' || zone === 'bar') {
      takeOut()
      const tabs = target.node.tabs.filter((x) => x !== id)
      const bi = beforeId ? tabs.indexOf(beforeId) : -1
      tabs.splice(bi < 0 ? tabs.length : bi, 0, id)
      target.node.tabs = tabs
      target.node.a = id
      d.focus = target.node.g
      return
    }
    // Its own group's only tab, beside itself: nothing changes.
    if (src && src.node === target.node && target.node.tabs.length === 1) return
    takeOut()
    const ng: Group = { g: `g${d.n++}`, tabs: [id], a: id }
    insertBeside(d, gid, ng, zone)
    d.focus = ng.g
    d.max = null
  })
}

export function toggleMax(L: Layout, gid: string): Layout {
  if (groupsOf(L.root).length < 2) return L
  return update(L, (d) => {
    d.max = d.max === gid ? null : gid
    d.focus = gid
  })
}

export function closeGroup(L: Layout, gid: string): Layout {
  return update(L, (d) => {
    const r = findGroup(d.root, gid)
    if (r) r.node.tabs = []
  })
}

/** The split at `path` (child indexes from the root). */
function splitAt(root: LayoutNode, path: number[]): Split | null {
  let n: LayoutNode | undefined = root
  for (const i of path) n = n && !isGroup(n) ? n.c[i] : undefined
  return n && !isGroup(n) ? n : null
}

/** Moves the border after child `i` of the split at `path`: child i gets `share` of the two's space. */
export function resize(L: Layout, path: number[], i: number, share: number): Layout {
  const draft = structuredClone(L)
  const s = splitAt(draft.root, path)
  if (!s || i + 1 >= s.z.length) return L
  const both = s.z[i] + s.z[i + 1]
  s.z[i] = Math.max(0, Math.min(both, share))
  s.z[i + 1] = both - s.z[i]
  return draft
}

/** Double-click on a border: the two either side of it share evenly. */
export function evenOut(L: Layout, path: number[], i: number): Layout {
  const s = splitAt(L.root, path)
  if (!s || i + 1 >= s.z.length) return L
  return resize(L, path, i, (s.z[i] + s.z[i + 1]) / 2)
}

export interface Box {
  group: Group
  x: number
  y: number
  w: number
  h: number
}
export interface Splitter {
  /** Where it is, as fractions of the area. */
  x: number
  y: number
  w: number
  h: number
  dir: 'row' | 'col'
  path: number[]
  i: number
  /** The split's own box (for turning pixels into shares). */
  rect: { x: number; y: number; w: number; h: number }
  /** The two children's shares when the drag starts. */
  a: number
  b: number
}

/** Where every group goes, as fractions of the editor area, and the borders between them. */
export function place(L: Layout): { boxes: Box[]; splitters: Splitter[] } {
  const boxes: Box[] = []
  const splitters: Splitter[] = []
  const max = L.max ? groupsOf(L.root).find((g) => g.g === L.max) : undefined
  if (max) return { boxes: [{ group: max, x: 0, y: 0, w: 1, h: 1 }], splitters }
  const walk = (n: LayoutNode, x: number, y: number, w: number, h: number, path: number[]): void => {
    if (isGroup(n)) {
      boxes.push({ group: n, x, y, w, h })
      return
    }
    let acc = 0
    n.c.forEach((c, i) => {
      const sz = n.z[i]
      if (n.d === 'row') walk(c, x + acc * w, y, sz * w, h, [...path, i])
      else walk(c, x, y + acc * h, w, sz * h, [...path, i])
      acc += sz
      if (i < n.c.length - 1) {
        const rect = { x, y, w, h }
        splitters.push(
          n.d === 'row'
            ? { x: x + acc * w, y, w: 0, h, dir: 'row', path, i, rect, a: n.z[i], b: n.z[i + 1] }
            : { x, y: y + acc * h, w, h: 0, dir: 'col', path, i, rect, a: n.z[i], b: n.z[i + 1] }
        )
      }
    })
  }
  walk(L.root, 0, 0, 1, 1, [])
  return { boxes, splitters }
}

/** Which part of a group a drag is over (fractions within its content area). */
export function zoneAt(px: number, py: number): Zone {
  return px < 0.22 ? 'left' : px > 0.78 ? 'right' : py < 0.22 ? 'top' : py > 0.78 ? 'bottom' : 'center'
}

// --- side bars ---------------------------------------------------------------

export interface SideBars {
  /** Each view's side, in order. */
  views: [ViewId, Side][]
  open: Record<Side, ViewId | null>
  width: Record<Side, number>
}

export const DEFAULT_BARS: SideBars = {
  views: [
    ['task', 'L'],
    ['explorer', 'L'],
    ['search', 'L'],
    ['changes', 'L'],
    ['sessions', 'L'],
    ['activity', 'R']
  ],
  open: { L: 'task', R: null },
  width: { L: 264, R: 240 }
}

export const sideOf = (b: SideBars, id: ViewId): Side => b.views.find((v) => v[0] === id)?.[1] ?? 'L'

/** Shows a view in its side bar (opening that side bar). */
export function showView(b: SideBars, id: ViewId): SideBars {
  const side = sideOf(b, id)
  return b.open[side] === id ? b : { ...b, open: { ...b.open, [side]: id } }
}

/** Its icon clicked: shown, or the side bar closed when it's the one showing. */
export function toggleView(b: SideBars, id: ViewId): SideBars {
  const side = sideOf(b, id)
  return { ...b, open: { ...b.open, [side]: b.open[side] === id ? null : id } }
}

/** A side bar opened (with its first view) or closed. */
export function toggleSide(b: SideBars, side: Side): SideBars {
  return { ...b, open: { ...b.open, [side]: b.open[side] ? null : (b.views.find((v) => v[1] === side)?.[0] ?? null) } }
}

/** A view dragged to a place in a side bar (before `beforeId`, or last); it shows there if it was showing, or moved sides. */
export function moveView(b: SideBars, id: ViewId, side: Side, beforeId: ViewId | null = null): SideBars {
  const cur = b.views.find((v) => v[0] === id)
  if (!cur) return b
  const rest = b.views.filter((v) => v[0] !== id)
  const bi = beforeId ? rest.findIndex((v) => v[0] === beforeId) : -1
  rest.splice(bi < 0 ? rest.length : bi, 0, [id, side])
  const open = { ...b.open }
  const was = open[cur[1]] === id
  if (was && cur[1] !== side) open[cur[1]] = null
  if (was || cur[1] !== side) open[side] = id
  return { ...b, views: rest, open }
}

/** Reads stored side bars, keeping only what still makes sense (every view once). */
export function readBars(raw: unknown): SideBars {
  const ids = DEFAULT_BARS.views.map((v) => v[0])
  const r = raw as Partial<SideBars> | null
  if (!r || !Array.isArray(r.views)) return DEFAULT_BARS
  const views = r.views.filter((v): v is [ViewId, Side] => Array.isArray(v) && ids.includes(v[0]) && (v[1] === 'L' || v[1] === 'R'))
  const seen = new Set(views.map((v) => v[0]))
  for (const v of DEFAULT_BARS.views) if (!seen.has(v[0])) views.push(v)
  const deduped = views.filter((v, i) => views.findIndex((o) => o[0] === v[0]) === i)
  const okOpen = (side: Side): ViewId | null => {
    const id = r.open?.[side] ?? null
    return id && deduped.some((v) => v[0] === id && v[1] === side) ? id : null
  }
  const w = (side: Side): number => {
    const n = Number(r.width?.[side])
    return Number.isFinite(n) ? Math.max(180, Math.min(640, n)) : DEFAULT_BARS.width[side]
  }
  return { views: deduped, open: { L: okOpen('L'), R: okOpen('R') }, width: { L: w('L'), R: w('R') } }
}

/** Reads a stored layout: null when it isn't one. */
export function readLayout(raw: unknown): Layout | null {
  const ok = (n: unknown): n is LayoutNode => {
    if (!n || typeof n !== 'object') return false
    const o = n as Record<string, unknown>
    if (typeof o.g === 'string') return Array.isArray(o.tabs) && o.tabs.every((t) => typeof t === 'string')
    return (o.d === 'row' || o.d === 'col') && Array.isArray(o.c) && Array.isArray(o.z) && o.c.length === o.z.length && o.c.every(ok)
  }
  const r = raw as Partial<Layout> | null
  if (!r || !ok(r.root) || typeof r.n !== 'number') return null
  return clean(structuredClone({ root: r.root, focus: String(r.focus ?? ''), max: r.max ?? null, n: r.n }))
}
