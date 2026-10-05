import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../../store/AppStore'
import { useHover } from '../../../lib/useHover'
import { Menu, type MenuAnchor, type MenuItem } from '../../../components/ui'
import { FILE_DRAG_TYPE } from '../../../lib/dropPaths'
import {
  activate,
  closeGroup,
  dropTab,
  evenOut,
  focusGroup,
  groupsOf,
  place,
  resize,
  splitGroup,
  toggleMax,
  zoneAt,
  type Box,
  type Group,
  type Layout,
  type Splitter,
  type TabId,
  type Zone
} from '../../../lib/wsLayout'
import { setDrag, setLayout, startTabDrag, useDrag } from '../../../lib/wsStore'

const BAR = 35
const pct = (v: number): string => `${(v * 100).toFixed(4)}%`

/** Something a group's + opens (`extra`: only in the menu, not in an empty group's list). */
export type AddItem = MenuItem & { extra?: boolean }

/** How a tab looks in its group's tab bar. */
export interface TabMeta {
  label: string
  /** Small text after the label (a diff's "diff", the preview's port). */
  sub?: string
  ic: string
  icColor: string
  /** A status dot (the agent's state, a file's unsaved changes). */
  dot?: string
  tip: string
  italic?: boolean
}

export interface EditorAreaProps {
  taskId: string
  layout: Layout
  meta: (id: TabId) => TabMeta | null
  /** A tab's content (`visible`: it's the one showing in its group). */
  render: (id: TabId, gid: string, visible: boolean) => React.ReactNode
  /** Closes a tab in a group (a shell's process too). */
  close: (id: TabId, gid: string) => void
  /** What a group's + offers (and an empty group lists). */
  addItems: (gid: string) => AddItem[]
  /** A tab's right-click menu, beyond closing. */
  tabMenu: (id: TabId, gid: string) => MenuItem[]
  /** Split right/down with nothing to split off: a new terminal there. */
  splitEmpty: (gid: string, zone: Exclude<Zone, 'center'>) => void
  /** A file dropped on a terminal: its path typed in (true when it was). */
  typePaths: (id: TabId, paths: string[]) => boolean
  /** Renaming a shell (double-click on its tab). */
  rename?: { id: TabId; start: (id: TabId) => void; value: string | null; onChange: (v: string) => void; onDone: (save: boolean) => void }
}

/** The tabs a terminal (where a dropped file's path is typed in). */
const isTerminal = (id: TabId | null): boolean => !!id && (id === 'agent' || id.startsWith('shell:'))

/**
 * The editor area: groups of tabs side by side and stacked (VS Code's
 * editor groups) - tabs move between them by dragging, onto a group's edge
 * to split it; borders drag to resize. Every tab's content lives in one
 * list beside the groups, placed over its group, so moving a tab to another
 * group keeps it as it was (a terminal isn't restarted).
 */
export function EditorArea(p: EditorAreaProps): React.JSX.Element {
  const { dispatch } = useAppStore()
  const ref = useRef<HTMLDivElement>(null)
  const drag = useDrag()
  const [hoverZone, setHoverZone] = useState<{ g: string; z: Zone | 'bar'; before: TabId | null; paths: boolean } | null>(null)
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; items: MenuItem[] } | null>(null)
  const L = p.layout
  const { boxes, splitters } = place(L)
  const all = groupsOf(L.root)
  const many = all.length > 1
  const set = (fn: (l: Layout) => Layout | null): void => setLayout(p.taskId, (l) => fn(l) ?? l)

  // A drag that ended without a drop on us: the zones go.
  useEffect(() => {
    if (!drag) setHoverZone(null)
  }, [drag])

  /** Whether a group is big enough to split that way (the toast says why not). */
  const roomFor = (gid: string, zone: Zone | 'bar'): boolean => {
    if (zone === 'center' || zone === 'bar') return true
    const r = ref.current?.getBoundingClientRect()
    const b = boxes.find((x) => x.group.g === gid)
    if (!r || !b) return true
    const ok = zone === 'left' || zone === 'right' ? r.width * b.w >= 400 : r.height * b.h >= 300
    if (!ok) dispatch({ type: 'TOAST', text: 'Not enough room to split this group - widen it or close a side bar.' })
    return ok
  }

  const split = (gid: string, zone: Exclude<Zone, 'center'>): void => {
    if (!roomFor(gid, zone)) return
    const next = splitGroup(L, gid, zone)
    if (next) setLayout(p.taskId, () => next)
    else p.splitEmpty(gid, zone)
  }

  const onDropOn = (gid: string, zone: Zone | 'bar', before: TabId | null, e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const d = drag
    setHoverZone(null)
    setDrag(null)
    if (!d || d.type !== 'tab') return
    // A file onto a terminal's middle: its path is typed in, as in VS Code.
    const g = all.find((x) => x.g === gid)
    const files = e.dataTransfer.getData(FILE_DRAG_TYPE)
    if (zone === 'center' && files && isTerminal(g?.a ?? null)) {
      try {
        if (p.typePaths(g!.a!, JSON.parse(files) as string[])) return
      } catch {
        // not paths after all: opened instead
      }
    }
    if (!roomFor(gid, zone)) return
    set((l) => dropTab(l, d.id, d.from, gid, zone, before))
  }

  const showMenu = (el: HTMLElement, items: MenuItem[]): void => setMenu({ anchor: { el }, items })

  // Every tab's content, once (a file open in two groups: twice).
  const seen = new Set<string>()
  const layers: { key: string; id: TabId; group: Group; box: Box | undefined }[] = []
  for (const g of all)
    for (const id of g.tabs) {
      const key = seen.has(id) ? `${id}@${g.g}` : id
      seen.add(id)
      layers.push({ key, id, group: g, box: boxes.find((b) => b.group.g === g.g) })
    }

  return (
    <div ref={ref} style={{ order: 2, flex: 1, minWidth: 0, minHeight: 0, position: 'relative', background: 'var(--bg-console)' }}>
      {boxes.map((b) => (
        <GroupFrame
          key={b.group.g}
          box={b}
          focused={b.group.g === L.focus}
          many={many}
          maxed={L.max === b.group.g}
          showTools={b.group.g === L.focus || !many}
          meta={p.meta}
          hover={hoverZone?.g === b.group.g ? hoverZone : null}
          dragging={drag?.type === 'tab'}
          rename={p.rename}
          onFocus={() => set((l) => focusGroup(l, b.group.g))}
          onActivate={(id) => {
            set((l) => activate(l, b.group.g, id))
            // Its terminal or editor takes the keyboard, as a click on it would.
            setTimeout(() => {
              const layer = ref.current?.querySelector(`[data-ws-group="${CSS.escape(b.group.g)}"][data-ws-tab="${CSS.escape(id)}"]`)
              layer?.querySelector<HTMLElement>('.xterm-helper-textarea, .cm-content')?.focus()
            }, 30)
          }}
          onClose={(id) => p.close(id, b.group.g)}
          onTabMenu={(id, e) => {
            e.preventDefault()
            setMenu({ anchor: { x: e.clientX, y: e.clientY }, items: p.tabMenu(id, b.group.g) })
          }}
          onDragTab={(id, e) => startTabDrag(e, id, b.group.g)}
          onBarOver={(before, e) => {
            if (drag?.type !== 'tab') return
            e.preventDefault()
            e.stopPropagation()
            if (hoverZone?.g !== b.group.g || hoverZone.z !== 'bar' || hoverZone.before !== before) setHoverZone({ g: b.group.g, z: 'bar', before, paths: false })
          }}
          onBarDrop={(before, e) => onDropOn(b.group.g, 'bar', before, e)}
          onZoneOver={(e) => {
            if (drag?.type !== 'tab') return
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            const z = zoneAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
            const paths = z === 'center' && e.dataTransfer.types.includes(FILE_DRAG_TYPE) && isTerminal(b.group.a)
            e.dataTransfer.dropEffect = paths ? 'copy' : 'move'
            if (hoverZone?.g !== b.group.g || hoverZone.z !== z || hoverZone.paths !== paths) setHoverZone({ g: b.group.g, z, before: null, paths })
          }}
          onZoneLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHoverZone((h) => (h?.g === b.group.g && h.z !== 'bar' ? null : h))
          }}
          onZoneDrop={(e) => onDropOn(b.group.g, hoverZone?.g === b.group.g && hoverZone.z !== 'bar' ? hoverZone.z : 'center', null, e)}
          onAdd={(el) => showMenu(el, p.addItems(b.group.g))}
          addItems={b.group.tabs.length ? [] : p.addItems(b.group.g)}
          onSplit={(zone) => split(b.group.g, zone)}
          onMax={() => set((l) => toggleMax(l, b.group.g))}
          onCloseGroup={() => set((l) => closeGroup(l, b.group.g))}
        />
      ))}
      {layers.map(({ key, id, group, box }) => {
        const visible = !!box && group.a === id
        const bl = box && box.x > 0.0001 ? 1 : 0
        const bt = box && box.y > 0.0001 ? 1 : 0
        return (
          <div
            key={key}
            data-ws-tab={id}
            data-ws-group={group.g}
            onMouseDownCapture={() => L.focus !== group.g && set((l) => focusGroup(l, group.g))}
            style={
              box
                ? {
                    position: 'absolute',
                    left: `calc(${pct(box.x)} + ${bl}px)`,
                    top: `calc(${pct(box.y)} + ${BAR + bt}px)`,
                    width: `calc(${pct(box.w)} - ${bl}px)`,
                    height: `calc(${pct(box.h)} - ${BAR + bt}px)`,
                    display: visible ? 'flex' : 'none',
                    flexDirection: 'column',
                    minWidth: 0,
                    minHeight: 0,
                    overflow: 'hidden',
                    zIndex: 1
                  }
                : { display: 'none' }
            }
          >
            {p.render(id, group.g, visible)}
          </div>
        )
      })}
      {splitters.map((s) => (
        <SplitHandle
          key={`${s.path.join('.')}:${s.i}`}
          s={s}
          onDown={(e) => {
            e.preventDefault()
            const area = ref.current?.getBoundingClientRect()
            if (!area) return
            const row = s.dir === 'row'
            const start = row ? e.clientX : e.clientY
            const tot = row ? area.width * s.rect.w : area.height * s.rect.h
            const both = s.a + s.b
            const min = Math.min(0.45 * both, 160 / tot)
            const move = (ev: MouseEvent): void => {
              const share = Math.max(min, Math.min(both - min, s.a + ((row ? ev.clientX : ev.clientY) - start) / tot))
              setLayout(p.taskId, (l) => resize(l, s.path, s.i, share))
            }
            dragWith(row ? 'col-resize' : 'row-resize', move)
          }}
          onReset={() => set((l) => evenOut(l, s.path, s.i))}
        />
      ))}
      {menu ? <Menu anchor={menu.anchor} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </div>
  )
}

/** Follows the mouse until it's let go (a border being dragged), with that cursor everywhere meanwhile. */
export function dragWith(cursor: string, move: (e: MouseEvent) => void): void {
  const up = (): void => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.body.style.cursor = cursor
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

const DZ: Record<Zone, [string, string, string, string]> = {
  left: ['0', '0', '50%', '100%'],
  right: ['50%', '0', '50%', '100%'],
  top: ['0', '0', '100%', '50%'],
  bottom: ['0', '50%', '100%', '50%'],
  center: ['0', '0', '100%', '100%']
}

interface FrameProps {
  box: Box
  focused: boolean
  many: boolean
  maxed: boolean
  showTools: boolean
  meta: (id: TabId) => TabMeta | null
  hover: { z: Zone | 'bar'; before: TabId | null; paths: boolean } | null
  dragging: boolean
  rename?: EditorAreaProps['rename']
  onFocus: () => void
  onActivate: (id: TabId) => void
  onClose: (id: TabId) => void
  onTabMenu: (id: TabId, e: React.MouseEvent) => void
  onDragTab: (id: TabId, e: React.DragEvent) => void
  onBarOver: (before: TabId | null, e: React.DragEvent) => void
  onBarDrop: (before: TabId | null, e: React.DragEvent) => void
  onZoneOver: (e: React.DragEvent) => void
  onZoneLeave: (e: React.DragEvent) => void
  onZoneDrop: (e: React.DragEvent) => void
  onAdd: (el: HTMLElement) => void
  addItems: AddItem[]
  onSplit: (zone: 'right' | 'bottom') => void
  onMax: () => void
  onCloseGroup: () => void
}

/** A group: its tab bar and tools, the drop zones while a tab is dragged, and what an empty one offers. */
function GroupFrame(f: FrameProps): React.JSX.Element {
  const { box } = f
  const g = box.group
  const tabs = g.tabs.map((id) => [id, f.meta(id)] as const).filter((x): x is readonly [TabId, TabMeta] => !!x[1])
  const dz = f.hover && f.hover.z !== 'bar' ? DZ[f.hover.z] : null
  const scroller = useRef<HTMLDivElement>(null)
  // The showing tab scrolled into view.
  useEffect(() => {
    scroller.current?.querySelector(`[data-tab="${CSS.escape(g.a ?? '')}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [g.a])
  return (
    <div
      onMouseDown={f.onFocus}
      style={{
        position: 'absolute',
        left: pct(box.x),
        top: pct(box.y),
        width: pct(box.w),
        height: pct(box.h),
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        borderLeft: box.x > 0.0001 ? '1px solid var(--bd-1)' : 'none',
        borderTop: box.y > 0.0001 ? '1px solid var(--bd-1)' : 'none',
        minWidth: 0,
        minHeight: 0
      }}
    >
      <div
        onDragOver={(e) => f.onBarOver(null, e)}
        onDrop={(e) => f.onBarDrop(null, e)}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.barSpace) f.onMax()
        }}
        style={{ height: BAR, flex: 'none', display: 'flex', alignItems: 'stretch', background: 'var(--bg-app)', borderBottom: '1px solid var(--bd-1)', position: 'relative' }}
      >
        <div
          ref={scroller}
          className="sy-tabstrip"
          onWheel={(e) => {
            if (!e.deltaY || e.shiftKey) return
            e.currentTarget.scrollLeft += e.deltaY
          }}
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch', overflowX: 'auto', overflowY: 'hidden' }}
        >
          {tabs.map(([id, m]) => (
            <EditorTab
              key={id}
              id={id}
              m={m}
              active={id === g.a}
              accent={id === g.a ? (f.focused && f.many ? 'var(--c-blue)' : 'var(--bd-6)') : null}
              dropBefore={f.hover?.z === 'bar' && f.hover.before === id}
              renaming={f.rename && f.rename.value !== null && f.rename.id === id ? f.rename : undefined}
              onClick={() => f.onActivate(id)}
              onDoubleClick={() => (id.startsWith('shell:') && f.rename ? f.rename.start(id) : undefined)}
              onClose={() => f.onClose(id)}
              onMenu={(e) => f.onTabMenu(id, e)}
              onDragStart={(e) => f.onDragTab(id, e)}
              onDragOver={(e) => f.onBarOver(id, e)}
              onDrop={(e) => f.onBarDrop(id, e)}
            />
          ))}
          <div
            data-bar-space="1"
            style={{ flex: 1, minWidth: 24, boxShadow: f.hover?.z === 'bar' && f.hover.before === null ? 'inset 2px 0 0 var(--c-blue)' : 'none' }}
          />
        </div>
        {f.showTools ? (
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 1, padding: '0 6px' }}>
            <ToolIcon title="Open in this group" onClick={(e) => f.onAdd(e.currentTarget)}>
              <path d="M7 2.5v9M2.5 7h9" />
            </ToolIcon>
            <ToolIcon title="Split right (⌘\)" onClick={() => f.onSplit('right')}>
              <rect x="1.5" y="2" width="11" height="10" rx="1.5" />
              <path d="M7 2v10" />
            </ToolIcon>
            <ToolIcon title="Split down (⇧⌘\)" onClick={() => f.onSplit('bottom')}>
              <rect x="1.5" y="2" width="11" height="10" rx="1.5" />
              <path d="M1.5 7h11" />
            </ToolIcon>
            {f.many ? (
              <ToolIcon title={f.maxed ? 'Restore layout' : 'Maximize group'} onClick={f.onMax} on={f.maxed}>
                <path d="M1.8 5V1.8H5M9 1.8h3.2V5M12.2 9v3.2H9M5 12.2H1.8V9" />
              </ToolIcon>
            ) : null}
            {f.many ? (
              <ToolIcon title="Close group" onClick={f.onCloseGroup}>
                <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
              </ToolIcon>
            ) : null}
          </div>
        ) : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!tabs.length ? <EmptyGroup items={f.addItems} /> : null}
        {f.dragging ? (
          // Over the content (terminals and editors would take the drop otherwise).
          <div onDragOver={f.onZoneOver} onDragLeave={f.onZoneLeave} onDrop={f.onZoneDrop} style={{ position: 'absolute', inset: 0, zIndex: 6 }}>
            {dz ? (
              <div
                style={{
                  position: 'absolute',
                  left: dz[0],
                  top: dz[1],
                  width: dz[2],
                  height: dz[3],
                  background: 'color-mix(in srgb, var(--c-blue) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--c-blue) 55%, transparent)',
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                  transition: 'left .08s ease, top .08s ease, width .08s ease, height .08s ease',
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  paddingBottom: 14
                }}
              >
                {f.hover?.paths ? <span style={{ background: 'var(--bg-menu)', border: '1px solid var(--bd-4)', borderRadius: 5, padding: '3px 9px', font: '12px var(--font-ui)', color: 'var(--t1)' }}>Drop to insert the path</span> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function EditorTab({
  id,
  m,
  active,
  accent,
  dropBefore,
  renaming,
  onClick,
  onDoubleClick,
  onClose,
  onMenu,
  onDragStart,
  onDragOver,
  onDrop
}: {
  id: TabId
  m: TabMeta
  active: boolean
  accent: string | null
  dropBefore: boolean
  renaming?: NonNullable<EditorAreaProps['rename']>
  onClick: () => void
  onDoubleClick: () => void
  onClose: () => void
  onMenu: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const [xHover, xHoverProps] = useHover()
  const shadows = [accent ? `inset 0 1px 0 ${accent}` : '', dropBefore ? 'inset 2px 0 0 var(--c-blue)' : ''].filter(Boolean).join(',')
  return (
    <div
      data-tab={id}
      draggable={!renaming}
      onDragStart={onDragStart}
      onDragEnd={() => setDrag(null)}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDoubleClick()
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          onClose()
        }
      }}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onContextMenu={onMenu}
      title={m.tip}
      {...hoverProps}
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '0 6px 0 12px',
        borderRight: '1px solid var(--bd-1)',
        background: active ? 'var(--bg-console)' : 'transparent',
        color: active || hover ? 'var(--t1)' : 'var(--t3)',
        boxShadow: shadows || 'none',
        font: '12px var(--font-mono)',
        cursor: 'pointer',
        marginBottom: -1,
        borderBottom: `1px solid ${active ? 'var(--bg-console)' : 'var(--bd-1)'}`,
        whiteSpace: 'nowrap',
        userSelect: 'none'
      }}
    >
      <span style={{ font: '700 9px/1 var(--font-mono)', color: m.icColor, minWidth: 10, textAlign: 'center' }}>{m.ic}</span>
      {renaming ? (
        <input
          autoFocus
          value={renaming.value ?? ''}
          onChange={(e) => renaming.onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => renaming.onDone(true)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') renaming.onDone(true)
            else if (e.key === 'Escape') renaming.onDone(false)
          }}
          style={{ width: Math.max(48, (renaming.value ?? '').length * 7.5 + 10), background: 'var(--bg-input)', border: '1px solid var(--c-blue)', borderRadius: 3, color: 'var(--t1)', font: 'inherit', padding: '0 4px', outline: 'none' }}
        />
      ) : (
        <span style={{ fontStyle: m.italic ? 'italic' : 'normal' }}>{m.label}</span>
      )}
      {m.sub ? <span style={{ color: 'var(--t4)', fontSize: 11 }}>{m.sub}</span> : null}
      {m.dot ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.dot, flex: 'none' }} /> : null}
      <span
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        title="Close · middle-click"
        {...xHoverProps}
        style={{
          width: 18,
          height: 18,
          borderRadius: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          color: xHover ? 'var(--t1)' : active ? 'var(--t2)' : 'var(--t5)',
          background: xHover ? 'color-mix(in srgb, var(--ov) 8%, transparent)' : 'transparent'
        }}
      >
        ×
      </span>
    </div>
  )
}

function ToolIcon({ title, onClick, on, children }: { title: string; onClick: (e: React.MouseEvent<HTMLSpanElement>) => void; on?: boolean; children: React.ReactNode }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      title={title}
      {...hoverProps}
      style={{
        width: 26,
        height: 26,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flex: 'none',
        color: on ? 'var(--c-blue)' : hover ? 'var(--t1)' : 'var(--t-dim)',
        background: hover ? 'var(--bg-hover)' : 'transparent'
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  )
}

/** An empty group: what can open here. */
function EmptyGroup({ items }: { items: AddItem[] }): React.JSX.Element {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 240 }}>
        <div style={{ font: '500 13px var(--font-ui)', color: 'var(--t2)', marginBottom: 8 }}>Nothing open here</div>
        {items
          .filter((i) => !i.extra)
          .map((i) => (
            <EmptyItem key={i.label} item={i} />
          ))}
        <div style={{ font: '12px/1.5 var(--font-ui)', color: 'var(--t4)', marginTop: 10, textWrap: 'pretty' }}>Or drag a file, change or session here from the side bar.</div>
      </div>
    </div>
  )
}

function EmptyItem({ item }: { item: AddItem }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      onClick={() => item.onClick?.()}
      {...hoverProps}
      style={{
        height: 30,
        padding: '0 10px',
        borderRadius: 5,
        border: `1px solid ${hover ? 'var(--bd-4)' : 'var(--bd-2)'}`,
        background: hover ? 'var(--bg-panel)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        font: '12.5px var(--font-ui)',
        color: 'var(--t1)'
      }}
    >
      <span style={{ width: 12, textAlign: 'center', font: '11px var(--font-mono)', color: item.glyphColor }}>{item.glyph}</span>
      {item.label}
    </div>
  )
}

function SplitHandle({ s, onDown, onReset }: { s: Splitter; onDown: (e: React.MouseEvent) => void; onReset: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const row = s.dir === 'row'
  return (
    <div
      onMouseDown={onDown}
      onDoubleClick={onReset}
      title="Drag to resize · double-click to even out"
      {...hoverProps}
      style={{
        position: 'absolute',
        left: row ? `calc(${pct(s.x)} - 3px)` : pct(s.x),
        top: row ? pct(s.y) : `calc(${pct(s.y)} - 3px)`,
        width: row ? 6 : pct(s.w),
        height: row ? pct(s.h) : 6,
        cursor: row ? 'col-resize' : 'row-resize',
        zIndex: 7,
        background: hover ? 'color-mix(in srgb, var(--c-blue) 40%, transparent)' : 'transparent'
      }}
    />
  )
}
