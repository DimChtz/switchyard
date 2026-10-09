import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useHover } from '../../../lib/useHover'
import { timeAgo } from '../../../lib/status'
import { keyLabel } from '../../../lib/keys'
import { plural } from '../../../lib/summary'
import { nativePath } from '../../../lib/paths'
import { Button, Segmented, confirm } from '../../../components/ui'
import { replaceTab } from '../../../lib/wsLayout'
import { setLayout, wsOpen } from '../../../lib/wsStore'
import { gapsOf, highlightLines, hunkLabel, pairLines, segmentsOf, splitRows, wordDiff, type Gap, type Ranges } from '../../../lib/diffView'
import { useAppStore } from '../../../store/AppStore'
import type { DiffLine, FileDiff, Prefs, ReviewComment } from '@shared/types'
import { useChanges } from './ChangesContext'
import { useFilesMaybe } from '../files/FilesContext'
import './diff.css'

/**
 * Which diff row a comment belongs to: the row showing the same file line
 * (so it follows its line as the diff around it changes), or -1 when that
 * line is no longer part of the diff. Comments from older versions only
 * know their row.
 */
function rowOf(c: ReviewComment, lines: DiffLine[]): number {
  if (c.newLine != null) return lines.findIndex((l) => l.kind !== '-' && l.kind !== '@' && l.newLine === c.newLine)
  if (c.oldLine != null) return lines.findIndex((l) => l.kind === '-' && l.oldLine === c.oldLine)
  return c.line < lines.length ? c.line : -1
}

/** A file's text as lines, as git counts them. */
function linesOf(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

const IMAGE = /\.(png|jpe?g|gif|webp|ico|bmp|avif)$/i
/** Unchanged lines shown per click on a gap's "show more". */
const STEP = 20
/** Rows drawn as one block (the browser skips laying out blocks out of view). */
const CHUNK = 60
/** Blocks drawn right away; the others follow, MORE_CHUNKS at a time. */
const FIRST_CHUNKS = 8
const MORE_CHUNKS = 16

/** What the diff shows, row by row. */
type Item =
  | { t: 'line'; i: number }
  | { t: 'pair'; left: number | null; right: number | null }
  | { t: 'hunk'; i: number }
  | { t: 'ctx'; n: number; o: number }
  | { t: 'gap'; gap: Gap; hidden: number }

/** One file's changes as a tab: click a line (shift-click for several) to comment for the agent. */
export function DiffTab({ path, gid }: { path: string; gid: string }): React.JSX.Element {
  const ch = useChanges()
  const filesApi = useFilesMaybe()
  const { state, dispatch } = useAppStore()
  const { task, files, agent } = ch
  const file = files?.find((f) => f.path === path) ?? null
  const split = state.prefs.diffLayout === 'split'
  const wrap = split || state.prefs.diffWrap
  const setPrefs = (patch: Partial<Prefs>): void => dispatch({ type: 'SET_PREFS', patch })
  const scrollRef = useRef<HTMLDivElement>(null)
  // The rows a comment is being written on (shift-click extends from the anchor).
  const [sel, setSel] = useState<{ anchor: number; from: number; to: number } | null>(null)
  const [commentText, setCommentText] = useState('')
  const sorted = ch.ordered
  const swapTo = (next: string): void => setLayout(task.id, (L) => replaceTab(L, gid, `diff:${path}`, `diff:${next}`))
  const step = (by: 1 | -1): void => {
    const i = sorted.findIndex((f) => f.path === path)
    const nx = sorted[(i + by + sorted.length) % sorted.length]
    if (nx && nx.path !== path) swapTo(nx.path)
  }
  const markViewed = (): void => {
    const on = !ch.viewed[path]
    ch.toggleViewed(path)
    // Viewed: on to the next one not viewed yet.
    if (on) {
      const nx = sorted.find((f) => f.path !== path && !ch.viewed[f.path])
      if (nx) swapTo(nx.path)
    }
  }

  // The file as it is now: the unchanged lines between hunks come from it ("show more").
  const commitScope = typeof ch.scope === 'object'
  const canExpand = !!file && !commitScope && file.status !== 'deleted' && !file.binary && file.lines.some((l) => l.kind === '@')
  const sig = file ? `${file.lines.length}:${file.added}:${file.deleted}` : ''
  const [full, setFull] = useState<string[] | null>(null)
  const [opened, setOpened] = useState<Record<number, { top: number; bottom: number }>>({})
  // A long diff draws its first screens at once and the rest a bit at a time (placeholders keep the scrollbar right).
  const [drawn, setDrawn] = useState(FIRST_CHUNKS)
  useEffect(() => {
    setOpened({})
    setSel(null)
    setDrawn(FIRST_CHUNKS)
  }, [path])
  useEffect(() => {
    if (!canExpand) return setFull(null)
    let live = true
    window.api.fs
      .read(nativePath(ch.root, path))
      .then((t) => live && setFull(linesOf(t)))
      .catch(() => live && setFull(null))
    return () => {
      live = false
    }
  }, [path, canExpand, sig, ch.root])

  const lines = useMemo(() => file?.lines ?? [], [file])
  // Syntax colors: each side read as one piece of code (the whole file, for the new side, when it's read).
  const colors = useMemo(() => {
    const byIndex = new Map<number, [number, number, string][]>()
    if (!file || file.binary || !lines.length) return { byIndex, fullHl: null as [number, number, string][][] | null }
    const oldIdx: number[] = []
    const oldTexts: string[] = []
    const newIdx: number[] = []
    const newTexts: string[] = []
    lines.forEach((l, i) => {
      if (l.kind === '-' || l.kind === ' ') {
        oldIdx.push(i)
        oldTexts.push(l.text)
      }
      if (l.kind === '+' || l.kind === ' ') {
        newIdx.push(i)
        newTexts.push(l.text)
      }
    })
    const o = highlightLines(path, oldTexts)
    oldIdx.forEach((i, k) => lines[i].kind === '-' && o?.[k] && byIndex.set(i, o[k]))
    const fullHl = full ? highlightLines(path, full) : null
    if (fullHl) {
      lines.forEach((l, i) => l.kind !== '-' && l.kind !== '@' && l.newLine != null && fullHl[l.newLine - 1] && byIndex.set(i, fullHl[l.newLine - 1]))
    } else {
      const n = highlightLines(path, newTexts)
      newIdx.forEach((i, k) => n?.[k] && byIndex.set(i, n[k]))
    }
    return { byIndex, fullHl }
  }, [file, lines, full, path])
  // The words that changed in a line that replaced another.
  const marks = useMemo(() => {
    const m = new Map<number, Ranges>()
    if (lines.length > 8000) return m
    for (const [a, b] of pairLines(lines)) {
      if (lines[a].kind !== '-') continue
      const d = wordDiff(lines[a].text, lines[b].text)
      if (d) {
        m.set(a, d.a)
        m.set(b, d.b)
      }
    }
    return m
  }, [lines])
  const gaps = useMemo(() => (canExpand ? gapsOf(lines, full ? full.length : null) : []), [canExpand, lines, full])

  const items = useMemo(() => {
    const out: Item[] = []
    const gapAt = new Map(gaps.map((g) => [g.before, g]))
    const addGap = (g: Gap | undefined): void => {
      if (!g) return
      const size = g.to - g.from + 1
      const st = opened[g.before] ?? { top: 0, bottom: 0 }
      const ctx = (n: number): void => void out.push({ t: 'ctx', n, o: n + g.oldShift })
      if (st.top + st.bottom >= size) {
        for (let n = g.from; n <= g.to; n++) ctx(n)
        return
      }
      for (let n = g.from; n < g.from + st.top; n++) ctx(n)
      out.push({ t: 'gap', gap: g, hidden: size - st.top - st.bottom })
      for (let n = g.to - st.bottom + 1; n <= g.to; n++) ctx(n)
    }
    if (split) {
      for (const r of splitRows(lines)) {
        if (r.hunk != null) {
          addGap(gapAt.get(r.hunk))
          out.push({ t: 'hunk', i: r.hunk })
        } else out.push({ t: 'pair', left: r.left, right: r.right })
      }
    } else {
      lines.forEach((l, i) => {
        if (l.kind === '@') {
          addGap(gapAt.get(i))
          out.push({ t: 'hunk', i })
        } else out.push({ t: 'line', i })
      })
    }
    addGap(gapAt.get(lines.length))
    return out
  }, [lines, gaps, opened, split])

  const clickRow = (i: number, shift: boolean): void => {
    if (shift && sel) setSel({ anchor: sel.anchor, from: Math.min(sel.anchor, i), to: Math.max(sel.anchor, i) })
    else if (sel && sel.from === i && sel.to === i) setSel(null)
    else setSel({ anchor: i, from: i, to: i })
  }

  /** The comment on the selected rows: into the review (sent with it), or to the agent now. */
  const saveComment = (sendNow: boolean): void => {
    if (!commentText.trim() || !file || !sel) return
    const first = file.lines[sel.from]
    const last = file.lines[sel.to]
    const onOld = first?.kind === '-'
    const now = Date.now()
    const comment: ReviewComment = {
      id: `${task.id}-${file.path}-${sel.from}-${now}`,
      taskId: task.id,
      path: file.path,
      line: sel.from,
      // The real line in the file (the old file's line for a removed line).
      newLine: onOld ? null : (first?.newLine ?? null),
      oldLine: onOld ? (first?.oldLine ?? null) : null,
      toLine: !onOld && sel.to > sel.from ? (last?.newLine ?? null) : null,
      code: first?.kind !== '@' ? first?.text : undefined,
      text: commentText.trim(),
      createdAt: now,
      pending: !sendNow,
      sentAt: sendNow ? now : null,
      ref: null,
      awaiting: sendNow
    }
    ch.addComment(comment, sendNow).then(() => {
      setCommentText('')
      setSel(null)
    })
  }

  const fileComments = file ? ch.comments.filter((c) => c.path === file.path) : []
  // A comment shows under its (last) line.
  const placed = file
    ? fileComments.map((c) => {
        const row = rowOf(c, file.lines)
        const end = c.toLine != null ? file.lines.findIndex((l, i) => i >= row && l.kind !== '-' && l.newLine === c.toLine) : -1
        // Outdated: its first line's code isn't what it was when written.
        const outdated = c.code != null && row !== -1 && file.lines[row]?.text !== c.code
        return { c, row: row !== -1 && end !== -1 ? end : row, outdated }
      })
    : []
  const orphaned = placed.filter((p) => p.row === -1).map((p) => p.c)
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  const sent = ch.comments.filter((c) => !c.pending && sorted.some((f) => f.path === c.path)).length

  // ── Rows ──
  const canGo = !!filesApi && !!file && file.status !== 'deleted' && !commitScope
  const goTo = (n: number | null): void => {
    if (canGo && n != null) filesApi!.jumpTo(path, n - 1, 0, 0)
  }
  const canUndoHunk = !!file && !commitScope && !ch.ignoreSpace && !file.truncated && file.status === 'modified'
  const undoHunk = async (i: number): Promise<void> => {
    if (!file) return
    const ok = await confirm({
      title: `Undo this change to ${path.split('/').pop()}?`,
      body: `${hunkLabel(file.lines[i].text).where} go back to how they were. Uncommitted edits in them can’t be brought back.`,
      confirmLabel: 'Undo change',
      danger: true
    })
    if (ok) ch.revertHunk(file, i)
  }
  const text = (t: string, i: number | null, ctxLine?: number): React.ReactNode =>
    segmentsOf(t, i != null ? colors.byIndex.get(i) : ctxLine != null ? colors.fullHl?.[ctxLine - 1] : undefined, i != null ? marks.get(i) : undefined).map((s, k) =>
      s.cls || s.mark ? (
        <span key={k} className={`${s.cls}${s.mark ? ' w' : ''}`}>
          {s.text}
        </span>
      ) : (
        s.text
      )
    )
  const picked = (i: number | null): boolean => i != null && !!sel && i >= sel.from && i <= sel.to
  const num = (n: number | null, go: boolean, cls = ''): React.JSX.Element => (
    <span
      className={`num${go && canGo && n != null ? ' go' : ''}${cls ? ` ${cls}` : ''}`}
      onClick={
        go && canGo && n != null
          ? (e) => {
              e.stopPropagation()
              goTo(n)
            }
          : undefined
      }
      title={go && canGo && n != null ? `Open the file at line ${n}` : undefined}
    >
      {n ?? ''}
    </span>
  )
  const signOf = (l: DiffLine | undefined): React.JSX.Element => (
    <span className="sign" style={{ color: l?.kind === '+' ? 'var(--c-green)' : 'var(--c-red)' }}>
      {l?.kind === '+' ? '+' : l?.kind === '-' ? '−' : ''}
    </span>
  )
  const clickable = (i: number) => ({
    onClick: (e: React.MouseEvent) => clickRow(i, e.shiftKey),
    onMouseDown: (e: React.MouseEvent) => e.shiftKey && e.preventDefault(),
    title: 'Click to comment - shift-click to comment on several lines'
  })

  // ── Lines picked for the next commit (the Uncommitted view: its diff is what gets committed) ──
  const canPick = !!file && ch.scope === 'uncommitted' && file.uncommitted && !ch.ignoreSpace && !file.binary && !file.oldPath && file.status !== 'deleted' && !file.truncated && !ch.sync
  const pickState = file ? ch.pickState(file) : 'all'
  const skipped = ch.skippedLines(path)
  const isIn = (i: number): boolean => pickState !== 'none' && !skipped?.has(i)
  const lastPick = useRef<number | null>(null)
  const changedIn = (from: number, to: number): number[] => {
    const out: number[] = []
    for (let k = from; k <= to; k++) if (lines[k] && (lines[k].kind === '+' || lines[k].kind === '-')) out.push(k)
    return out
  }
  const pickBox = (i: number): React.JSX.Element => {
    const on = isIn(i)
    return (
      <span
        className={`pk-box${on ? ' on' : ''}`}
        title={on ? 'In the next commit - click to leave it out (shift-click for a range)' : 'Left out of the next commit - click to put it in'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation()
          if (!file) return
          const from = e.shiftKey && lastPick.current != null ? Math.min(lastPick.current, i) : i
          const to = e.shiftKey && lastPick.current != null ? Math.max(lastPick.current, i) : i
          ch.pickLines(file, changedIn(from, to), !on)
          lastPick.current = i
        }}
      />
    )
  }
  const hunkPick = (at: number): React.JSX.Element | null => {
    if (!canPick || !file) return null
    let end = at + 1
    while (end < lines.length && lines[end].kind !== '@') end++
    const idx = changedIn(at + 1, end - 1)
    const inCount = idx.filter(isIn).length
    const state = inCount === idx.length ? 'on' : inCount ? 'some' : ''
    return (
      <span
        className={`pk-box ${state}`}
        title={state === 'on' ? 'This change is in the next commit - click to leave it out' : 'Put this whole change in the next commit'}
        onClick={() => ch.pickLines(file, idx, state !== 'on')}
      />
    )
  }

  const lineRow = (i: number): React.JSX.Element => {
    const l = lines[i]
    const changed = l.kind === '+' || l.kind === '-'
    const cls = picked(i) ? 'picked' : l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : ''
    return (
      <div className={`sy-dr click ${cls}${canPick ? ' pk' : ''}${canPick && changed && !isIn(i) ? ' out' : ''}`} {...clickable(i)}>
        {canPick ? changed ? pickBox(i) : <span /> : null}
        {num(l.kind === '+' ? null : l.oldLine, false)}
        {num(l.kind === '-' ? null : l.newLine, true)}
        {signOf(l)}
        <span className="txt">{text(l.text, i)}</span>
      </div>
    )
  }
  const side = (i: number | null, isLeft: boolean): React.JSX.Element[] => {
    const l = i != null ? lines[i] : undefined
    const cls = !l ? 'none' : picked(i) ? 'picked' : l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : ''
    const props = l ? clickable(i!) : {}
    const n = !l ? null : isLeft ? l.oldLine : l.newLine
    return [
      <React.Fragment key="n">{num(n, !isLeft, cls)}</React.Fragment>,
      <span key="s" className={`sign ${cls}`} {...props} style={{ color: l?.kind === '+' ? 'var(--c-green)' : 'var(--c-red)' }}>
        {l?.kind === '+' ? '+' : l?.kind === '-' ? '−' : ''}
      </span>,
      <span key="t" className={`txt ${cls}${isLeft ? ' side-l' : ''}`} {...props} style={{ cursor: l ? 'text' : 'default' }}>
        {l ? text(l.text, i) : null}
      </span>
    ]
  }
  const pairRow = (left: number | null, right: number | null): React.JSX.Element => (
    <div className="sy-dr split">
      {side(left, true)}
      {side(right, false)}
    </div>
  )
  const ctxRow = (n: number, o: number): React.JSX.Element => {
    const t = full?.[n - 1] ?? ''
    return split ? (
      <div className="sy-dr split">
        <span className="num">{o}</span>
        <span />
        <span className="txt side-l">{text(t, null, n)}</span>
        {num(n, true)}
        <span />
        <span className="txt">{text(t, null, n)}</span>
      </div>
    ) : (
      <div className={`sy-dr${canPick ? ' pk' : ''}`}>
        {canPick ? <span /> : null}
        {num(o, false)}
        {num(n, true)}
        <span />
        <span className="txt">{text(t, null, n)}</span>
      </div>
    )
  }
  const hunkRow = (i: number): React.JSX.Element => {
    const h = hunkLabel(lines[i].text)
    return (
      <div className="sy-hunk" data-hunk={i}>
        {hunkPick(i)}
        <span style={{ whiteSpace: 'nowrap' }}>{h.where}</span>
        {h.context ? <span className="ctx">{h.context}</span> : null}
        <span style={{ flex: 1 }} />
        {canUndoHunk ? (
          <span className="act">
            <Button size="xs" tone="danger" onClick={() => undoHunk(i)} title="Put these lines back as they were">
              Undo change
            </Button>
          </span>
        ) : null}
      </div>
    )
  }
  const gapRow = (g: Gap, hidden: number): React.JSX.Element => {
    const more = (key: 'top' | 'bottom', by: number): void =>
      setOpened((o) => {
        const st = o[g.before] ?? { top: 0, bottom: 0 }
        return { ...o, [g.before]: { ...st, [key]: st[key] + by } }
      })
    const first = g.from === 1
    const last = g.before === lines.length
    return (
      <div className="sy-gap">
        <span>⋯ {plural(hidden, 'unchanged line')}</span>
        {!first ? <button onClick={() => more('top', STEP)}>↓ {Math.min(STEP, hidden)} more</button> : null}
        {!last ? <button onClick={() => more('bottom', STEP)}>↑ {Math.min(STEP, hidden)} more</button> : null}
        {hidden > STEP ? <button onClick={() => more('top', hidden)}>show all</button> : null}
      </div>
    )
  }

  /** The line index a row stands for (where its comments go). */
  const indexesOf = (it: Item): number[] => (it.t === 'line' ? [it.i] : it.t === 'pair' ? [...new Set([it.left, it.right].filter((x): x is number => x != null))] : [])
  const after = (i: number): React.ReactNode => {
    const lineComments = placed.filter((p) => p.row === i)
    const l = lines[i]
    return (
      <>
        {lineComments.map(({ c, outdated }) => (
          <CommentBox key={c.id} c={c} agent={agent} outdated={outdated} onDelete={() => ch.removeComment(c.id)} onPatch={(p) => ch.patchComment(c.id, p)} onReply={(t) => ch.replyTo(c, t)} indent />
        ))}
        {sel && sel.to === i && file ? (
          <div style={{ margin: '6px 16px 8px 112px', maxWidth: 640, display: 'flex', flexDirection: 'column', border: '1px solid color-mix(in srgb, var(--c-blue) 50%, transparent)', borderRadius: 6, background: 'var(--bg-panel)', font: '13px var(--font-ui)' }}>
            <textarea
              autoFocus
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  saveComment(e.shiftKey)
                }
                if (e.key === 'Escape') setSel(null)
              }}
              rows={3}
              placeholder={`Comment on ${sel.to > sel.from ? `lines ${file.lines[sel.from]?.newLine ?? file.lines[sel.from]?.oldLine}-${file.lines[sel.to]?.newLine ?? file.lines[sel.to]?.oldLine}` : `line ${l.newLine ?? l.oldLine}`} for ${agent}`}
              style={{ minHeight: 64, resize: 'vertical', background: 'transparent', border: 'none', outline: 'none', color: 'var(--t1)', font: '13px/1.45 var(--font-ui)', padding: '10px 12px' }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderTop: '1px solid var(--bd-2)' }}>
              <span style={{ flex: 1, font: '11px var(--font-mono)', color: 'var(--t4)' }}>
                {keyLabel('⌘↵')} review · {keyLabel('⇧⌘↵')} send now · esc
              </span>
              <Button size="sm" onClick={() => setSel(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => saveComment(true)} title={`Send just this comment to ${agent} now`}>
                Send now
              </Button>
              <Button size="sm" variant="primary" onClick={() => saveComment(false)}>
                Add to review
              </Button>
            </div>
          </div>
        ) : null}
      </>
    )
  }
  const render = (it: Item, k: number): React.JSX.Element => (
    <React.Fragment key={k}>
      {it.t === 'line' ? lineRow(it.i) : it.t === 'pair' ? pairRow(it.left, it.right) : it.t === 'hunk' ? hunkRow(it.i) : it.t === 'ctx' ? ctxRow(it.n, it.o) : gapRow(it.gap, it.hidden)}
      {indexesOf(it).map((i) => (
        <React.Fragment key={i}>{after(i)}</React.Fragment>
      ))}
    </React.Fragment>
  )
  const chunks: Item[][] = []
  for (let k = 0; k < items.length; k += CHUNK) chunks.push(items.slice(k, k + CHUNK))
  const pendingChunks = drawn < chunks.length
  useEffect(() => {
    if (!pendingChunks) return
    const t = setTimeout(() => setDrawn((d) => d + MORE_CHUNKS), 30)
    return () => clearTimeout(t)
  }, [pendingChunks, drawn])

  // n / p: files · j / k: changes · v: viewed (while the diff has focus).
  const onKey = (e: React.KeyboardEvent): void => {
    const el = e.target as HTMLElement
    if (e.metaKey || e.ctrlKey || e.altKey || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return
    if (e.key === 'n' || e.key === 'p') step(e.key === 'n' ? 1 : -1)
    else if (e.key === 'v') markViewed()
    else if (e.key === 'j' || e.key === 'k') {
      const box = scrollRef.current
      if (!box) return
      const top = box.getBoundingClientRect().top
      const hunks = [...box.querySelectorAll<HTMLElement>('[data-hunk]')]
      const target = e.key === 'j' ? hunks.find((h) => h.getBoundingClientRect().top > top + 8) : [...hunks].reverse().find((h) => h.getBoundingClientRect().top < top - 8)
      target?.scrollIntoView({ block: 'start' })
    } else return
    e.preventDefault()
  }

  const isImage = !!file?.binary && IMAGE.test(path)
  const blank = !file
    ? null
    : file.binary
      ? isImage
        ? null
        : 'Binary file - it can’t be shown as text.'
      : file.lines.length
        ? null
        : file.status === 'deleted'
          ? 'File deleted.'
          : file.oldPath
            ? `Moved from ${file.oldPath} - its content didn’t change.`
            : file.status === 'added'
              ? 'An empty file (or one too big to show).'
              : 'Only the file’s mode changed.'

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 40, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--bd-1)', background: 'var(--bg-input)', minWidth: 0, overflow: 'hidden' }}>
        <span title={file?.oldPath ? `${file.oldPath} → ${path}` : path} style={{ font: '12.5px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 56, flex: '0 0 auto', maxWidth: '45%', direction: 'rtl', textAlign: 'left' }}>
          <bdi>
            {file?.oldPath ? <span style={{ color: 'var(--t4)' }}>{file.oldPath} → </span> : null}
            {dir}
            <span style={{ color: 'var(--t1)' }}>{path.split('/').pop()}</span>
          </bdi>
        </span>
        {file ? (
          <span style={{ display: 'flex', gap: 6, font: '12px var(--font-mono)', whiteSpace: 'nowrap', flex: 'none' }}>
            {file.binary ? null : <span style={{ color: 'var(--c-green)' }}>+{file.added}</span>}
            {file.deleted ? <span style={{ color: 'var(--c-red)' }}>−{file.deleted}</span> : null}
            {file.oldPath ? <span style={{ color: 'var(--c-blue)' }}>moved</span> : file.status !== 'modified' ? <span style={{ color: 'var(--t4)' }}>{file.status}</span> : null}
            {file.uncommitted ? <span style={{ color: 'var(--c-amber)' }}>uncommitted</span> : null}
            {canPick && pickState !== 'all' ? (
              <span style={{ color: 'var(--t3)' }} title="Only the ticked lines go into the next commit">
                · {pickState === 'none' ? 'left out of the commit' : 'some lines picked'}
              </span>
            ) : null}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {file?.uncommitted ? (
          <Button size="xs" tone="danger" onClick={() => ch.discard(path)}>
            Discard…
          </Button>
        ) : null}
        {ch.openSent(path) > 1 ? (
          <Button size="xs" onClick={() => ch.resolveAll(path)} title="Fold away every comment sent on this file">
            Resolve all {ch.openSent(path)}
          </Button>
        ) : null}
        {file && file.status !== 'deleted' ? (
          <Button size="xs" onClick={() => wsOpen(task.id, `file:${path}`)} title="Open it in the Files editor">
            Open file
          </Button>
        ) : null}
        {file ? (
          <Button size="xs" tone={ch.viewed[path] ? 'success' : undefined} onClick={markViewed} title="Mark it viewed and go on to the next one (v)">
            {ch.viewed[path] ? 'Viewed ✓' : 'Mark viewed'}
          </Button>
        ) : null}
        {sorted.length > 1 ? (
          <span style={{ display: 'flex', gap: 2, flex: 'none' }}>
            <Button size="xs" onClick={() => step(-1)} title="Previous file (p)">
              ‹
            </Button>
            <Button size="xs" onClick={() => step(1)} title="Next file (n)">
              ›
            </Button>
          </span>
        ) : null}
      </div>
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKey}
        className={`sy-diff${wrap ? '' : ' nowrap'}`}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg-console)', padding: '6px 0' }}
      >
        {files === null ? (
          <div style={{ padding: 40, color: 'var(--t3)', fontSize: 13, fontFamily: 'var(--font-ui)' }}>Loading…</div>
        ) : !file ? (
          <div style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 10, font: '13px var(--font-ui)', color: 'var(--t3)', alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--t2)' }}>
              {typeof ch.scope === 'object'
                ? `${path.split('/').pop()} isn’t in this commit.`
                : ch.scope === 'branch'
                  ? `No changes to ${path.split('/').pop()} vs ${ch.base} any more.`
                  : `No ${ch.scope === 'unpushed' ? 'unpushed' : 'uncommitted'} changes to ${path.split('/').pop()}.`}
            </span>
            <Button size="sm" onClick={() => wsOpen(task.id, `file:${path}`)}>
              Open the file
            </Button>
          </div>
        ) : (
          <>
            {/* (Notes and images keep to the view's width; only the rows grow with the longest line.) */}
            <div style={{ position: 'sticky', left: 0, width: '100%' }}>
            {orphaned.length > 0 ? (
              <div style={{ margin: '0 16px 8px', display: 'flex', flexDirection: 'column', gap: 4, font: '13px var(--font-ui)' }}>
                <div style={{ font: '11px var(--font-mono)', color: 'var(--t4)' }}>Comments on lines no longer in this diff</div>
                {orphaned.map((c) => (
                  <CommentBox key={c.id} c={c} agent={agent} outdated onDelete={() => ch.removeComment(c.id)} onPatch={(p) => ch.patchComment(c.id, p)} onReply={(t) => ch.replyTo(c, t)} />
                ))}
              </div>
            ) : null}
            {isImage ? <ImageDiff file={file} /> : null}
            {blank ? <div style={{ padding: '12px 16px', color: 'var(--t4)', font: '12.5px var(--font-ui)' }}>{blank}</div> : null}
            </div>
            <div className="sy-diff-body">
              {chunks.map((c, k) =>
                k < drawn ? (
                  <div key={k} className="sy-chunk" style={{ containIntrinsicSize: `auto ${c.length * 21}px` }}>
                    {c.map((it, j) => render(it, k * CHUNK + j))}
                  </div>
                ) : (
                  <div key={k} style={{ height: c.length * 21 }} />
                )
              )}
            </div>
            {file.truncated ? (
              <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--t4)', font: '12.5px var(--font-ui)' }}>
                Showing the first {file.lines.length.toLocaleString()} lines of this diff.
                {file.status !== 'deleted' ? (
                  <Button size="xs" onClick={() => wsOpen(task.id, `file:${path}`)}>
                    Open the file
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      <div style={{ flex: 'none', borderTop: '1px solid var(--bd-1)', background: 'var(--bg-input)', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ font: '12.5px var(--font-ui)', color: 'var(--t2)', flex: 1, minWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ch.pending.length
            ? `${plural(ch.pending.length, 'comment')} in the review - sent to ${agent} together`
            : sent
              ? `${plural(sent, 'comment')} sent · ${agent} picks up review comments between steps`
              : `Click any line to comment. Comments go to ${agent}.`}
        </span>
        {ch.pending.length ? (
          <Button size="sm" variant="primary" onClick={ch.sendReview}>
            Send review
          </Button>
        ) : null}
        <Segmented
          value={split ? 'split' : 'unified'}
          onChange={(v) => setPrefs({ diffLayout: v === 'split' ? 'split' : 'unified' })}
          options={[
            ['unified', <span key="u" title="Old and new lines in one column">Unified</span>],
            ['split', <span key="s" title="Old on the left, new on the right">Side by side</span>]
          ]}
          style={{ font: '11.5px var(--font-ui)' }}
        />
        <Chip on={wrap} disabled={split} onClick={() => setPrefs({ diffWrap: !state.prefs.diffWrap })} title={split ? 'Side by side always wraps' : 'Wrap long lines instead of scrolling sideways'}>
          Wrap
        </Chip>
        <Chip on={ch.ignoreSpace} onClick={() => setPrefs({ diffIgnoreSpace: !ch.ignoreSpace })} title="Leave out lines that only changed indentation or spacing">
          Hide whitespace
        </Chip>
      </div>
    </div>
  )
}

/** A small on/off button. */
function Chip({ on, disabled, onClick, title, children }: { on: boolean; disabled?: boolean; onClick: () => void; title: string; children: React.ReactNode }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      title={title}
      {...hoverProps}
      style={{
        all: 'unset',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        padding: '3px 9px',
        borderRadius: 6,
        font: '11.5px var(--font-ui)',
        border: `1px solid ${on ? 'color-mix(in srgb, var(--c-blue) 50%, transparent)' : 'var(--bd-2)'}`,
        background: on ? 'color-mix(in srgb, var(--c-blue) 14%, transparent)' : hover && !disabled ? 'var(--bg-menu)' : 'transparent',
        color: on ? 'var(--t1)' : 'var(--t3)',
        whiteSpace: 'nowrap'
      }}
    >
      {children}
    </button>
  )
}

/** An image's before and after. */
function ImageDiff({ file }: { file: FileDiff }): React.JSX.Element {
  const ch = useChanges()
  const [imgs, setImgs] = useState<{ old: string | null; now: string | null } | null>(null)
  const scopeKey = typeof ch.scope === 'object' ? ch.scope.commit : ch.scope
  useEffect(() => {
    let live = true
    Promise.all([file.status === 'added' ? null : ch.image(file, 'old'), file.status === 'deleted' ? null : ch.image(file, 'new')]).then(([old, now]) => live && setImgs({ old, now }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, file.status, scopeKey, ch.files])
  if (!imgs) return <div style={{ padding: '12px 16px', color: 'var(--t4)', font: '12.5px var(--font-ui)' }}>Loading the image…</div>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: 16, font: '12px var(--font-ui)' }}>
      {file.status !== 'added' ? <ImageSide label="Before" url={imgs.old} tone="var(--c-red)" /> : null}
      {file.status !== 'deleted' ? <ImageSide label={file.status === 'added' ? 'Added' : 'After'} url={imgs.now} tone="var(--c-green)" /> : null}
    </div>
  )
}

function ImageSide({ label, url, tone }: { label: string; url: string | null; tone: string }): React.JSX.Element {
  const [size, setSize] = useState<string>('')
  return (
    <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, color: 'var(--t3)' }}>
        <span style={{ color: tone }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--t4)' }}>{size}</span>
      </div>
      <div
        style={{
          border: `1px solid color-mix(in srgb, ${tone} 40%, transparent)`,
          borderRadius: 6,
          padding: 10,
          display: 'flex',
          justifyContent: 'center',
          // A checkerboard behind it: transparent parts show as such.
          backgroundColor: 'var(--bg-panel)',
          backgroundImage: 'linear-gradient(45deg, var(--bd-1) 25%, transparent 25%, transparent 75%, var(--bd-1) 75%), linear-gradient(45deg, var(--bd-1) 25%, transparent 25%, transparent 75%, var(--bd-1) 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 8px 8px'
        }}
      >
        {url ? (
          <img src={url} alt={label} onLoad={(e) => setSize(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)} style={{ maxWidth: '100%', maxHeight: 480, objectFit: 'contain' }} />
        ) : (
          <span style={{ color: 'var(--t4)', padding: 20 }}>Can’t be shown (too big, or not there).</span>
        )}
      </div>
    </div>
  )
}

/** A review comment: what was said, whether it's waiting in the review or went to the agent (when), and a way to delete it. */
function CommentBox({
  c,
  agent,
  outdated,
  onDelete,
  onPatch,
  onReply,
  indent
}: {
  c: ReviewComment
  agent: string
  outdated: boolean
  onDelete: () => void
  onPatch: (patch: Partial<ReviewComment>) => void
  onReply: (text: string) => void
  indent?: boolean
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  // Editing a comment still in the review (a sent one is what the agent has).
  const [editing, setEditing] = useState<string | null>(null)
  // A follow-up being written on a sent one.
  const [reply, setReply] = useState<string | null>(null)
  const sendReply = (): void => {
    if (!reply?.trim()) return
    onReply(reply.trim())
    setReply(null)
  }
  const action = (label: string, title: string, onClick: () => void): React.JSX.Element => (
    <span onClick={onClick} title={title} style={{ cursor: 'pointer', color: hover ? 'var(--t2)' : 'var(--t5)' }}>
      {label}
    </span>
  )
  const where = c.newLine != null ? (c.toLine != null && c.toLine !== c.newLine ? ` · lines ${c.newLine}-${c.toLine}` : ` · line ${c.newLine}`) : c.oldLine != null ? ` · removed line ${c.oldLine}` : ''
  const margin = indent ? '6px 16px 8px 112px' : 0
  if (c.resolved) {
    // Folded away: one line, to reopen.
    return (
      <div {...hoverProps} style={{ margin: indent ? '2px 16px 2px 112px' : 0, maxWidth: 640, padding: '3px 10px', display: 'flex', gap: 8, alignItems: 'center', font: '11px var(--font-mono)', color: 'var(--t4)', border: '1px solid var(--bd-1)', borderRadius: 5 }}>
        <span style={{ color: 'var(--c-green)' }}>✓ resolved</span>
        {c.thread?.length ? <span>{c.thread.length} repl{c.thread.length === 1 ? 'y' : 'ies'}</span> : null}
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', font: '12px var(--font-ui)' }}>{c.text}</span>
        {action('reopen', 'Show it again as open', () => onPatch({ resolved: false }))}
        {action('×', 'Delete comment', onDelete)}
      </div>
    )
  }
  return (
    <div
      {...hoverProps}
      style={{
        margin,
        maxWidth: 640,
        background: 'var(--bg-panel)',
        border: `1px ${c.pending ? 'dashed' : 'solid'} ${c.pending ? 'color-mix(in srgb, var(--c-blue) 50%, transparent)' : 'var(--bd-4)'}`,
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4, borderBottom: c.thread?.length || reply != null ? '1px solid var(--bd-2)' : 'none' }}>
        <div style={{ display: 'flex', gap: 8, font: '11px var(--font-mono)', color: 'var(--t4)' }}>
          <span>
            {c.ref != null ? <span style={{ color: 'var(--t3)' }}>[{c.ref}] </span> : null}
            {c.pending ? <span style={{ color: 'var(--c-blue)' }}>in the review</span> : <span style={{ color: 'var(--c-blue)' }}>→ sent to {agent} · {timeAgo(c.sentAt ?? c.createdAt)} ago</span>}
            {where}
          </span>
          {outdated ? <span style={{ color: 'var(--c-amber)' }}>outdated</span> : null}
          {c.awaiting && !c.pending ? <span title={`${agent} answers once its turn is done (Claude Code)`}>· waiting for an answer</span> : null}
          <span style={{ flex: 1 }} />
          {c.pending ? editing == null && action('edit', 'Change the comment before the review goes', () => setEditing(c.text)) : reply == null && action('reply', `Ask ${agent} more about it`, () => setReply(''))}
          {!c.pending ? action('resolve', 'Dealt with - fold it away', () => onPatch({ resolved: true })) : null}
          {action('×', 'Delete comment', onDelete)}
        </div>
        {editing != null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              autoFocus
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && editing.trim()) {
                  e.preventDefault()
                  onPatch({ text: editing.trim() })
                  setEditing(null)
                }
                if (e.key === 'Escape') setEditing(null)
              }}
              rows={2}
              style={{ resize: 'vertical', background: 'var(--bg-panel-3)', color: 'var(--t1)', border: '1px solid var(--bd-3)', borderRadius: 5, padding: '6px 8px', font: '12.5px/1.45 var(--font-ui)', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <Button size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                hint={keyLabel('⌘↵')}
                onClick={() => {
                  if (!editing.trim()) return
                  onPatch({ text: editing.trim() })
                  setEditing(null)
                }}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ font: '13px/1.45 var(--font-ui)', color: 'var(--t1)', whiteSpace: 'pre-wrap' }}>{c.text}</div>
        )}
      </div>
      {c.thread?.length ? (
        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {c.thread.map((r, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: '11px var(--font-mono)', color: r.from === 'agent' ? 'var(--t1)' : 'var(--t4)' }}>
                {r.from === 'agent' ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c-green)' }} /> : null}
                {r.from === 'agent' ? agent : 'you'} · {timeAgo(r.at)} ago
              </span>
              <span style={{ font: '13px/1.45 var(--font-ui)', color: r.from === 'agent' ? 'var(--t2)' : 'var(--t3)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.text}</span>
            </div>
          ))}
        </div>
      ) : null}
      {reply != null ? (
        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            autoFocus
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                sendReply()
              }
              if (e.key === 'Escape') setReply(null)
            }}
            rows={2}
            placeholder={`Reply - goes to ${agent} now`}
            style={{ resize: 'vertical', background: 'var(--bg-panel-3)', color: 'var(--t1)', border: '1px solid var(--bd-3)', borderRadius: 5, padding: '6px 8px', font: '12.5px/1.45 var(--font-ui)', outline: 'none' }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Button size="sm" onClick={() => setReply(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" hint={keyLabel('⌘↵')} disabled={!reply.trim()} onClick={sendReply}>
              Send
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
