import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '../../../components/ui'
import { errText } from '../../../lib/errors'
import { nativePath } from '../../../lib/paths'
import { plural } from '../../../lib/summary'
import { highlightLines, segmentsOf } from '../../../lib/diffView'
import { parseConflicts, resolveConflict, type Choice, type Part } from '../../../lib/mergeConflicts'
import { wsOpen } from '../../../lib/wsStore'
import { useAppStore } from '../../../store/AppStore'
import { sidesOf, useChanges } from './ChangesContext'
import './diff.css'

/** Unchanged lines shown around a conflict; the rest fold away. */
const AROUND = 3

/** A conflicted file: each conflict's two sides, settled one at a time (or the file taken whole from a side). */
export function ConflictTab({ path }: { path: string }): React.JSX.Element {
  const ch = useChanges()
  const { dispatch } = useAppStore()
  const s = ch.sync
  const prefix = s?.dir ? `${s.dir}/` : ''
  const entry = s?.files.find((f) => prefix + f.path === path) ?? null
  const sides = s ? sidesOf(s, ch.base) : null
  const abs = nativePath(ch.root, path)
  const [text, setText] = useState<string | null>(null)
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set())

  // Read again whenever the changes are (an edit in the editor, the agent, a resolve).
  useEffect(() => {
    let live = true
    window.api.fs
      .read(abs)
      .then((t) => live && setText(t))
      .catch(() => live && setText(null))
    return () => {
      live = false
    }
  }, [abs, ch.files, s])

  const parts = useMemo(() => (text != null ? parseConflicts(text) : []), [text])
  const conflicts = parts.filter((p) => p.t === 'conflict').length
  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  const next = s?.files.find((f) => prefix + f.path !== path)

  /** Conflict n settled; the file marked resolved once none are left. */
  const choose = async (n: number, which: 'mine' | 'other' | 'both'): Promise<void> => {
    if (text == null || !sides) return
    const mineIsOurs = sides.mine === 'ours'
    const choice: Choice = which === 'both' ? (mineIsOurs ? 'both' : 'both-theirs-first') : (which === 'mine') === mineIsOurs ? 'ours' : 'theirs'
    const after = resolveConflict(text, n, choice)
    try {
      await window.api.fs.write(abs, after)
      setText(after)
      if (parseConflicts(after).every((p) => p.t === 'text')) {
        await ch.resolveFile(path, 'as-is')
        dispatch({ type: 'TOAST', text: `${path.split('/').pop()} resolved.` })
      }
    } catch (err) {
      toastErr(err)
    }
  }
  const markResolved = async (): Promise<void> => {
    await ch.resolveFile(path, 'as-is')
  }

  if (!s || !sides) {
    return <Done text="Nothing to resolve: no merge or rebase is going on." />
  }
  if (!entry) {
    return (
      <Done text={`${path.split('/').pop()} is resolved.`}>
        {next ? (
          <Button size="sm" variant="primary" onClick={() => wsOpen(ch.task.id, `conflict:${prefix}${next.path}`)}>
            Next: {next.path.split('/').pop()}
          </Button>
        ) : (
          <span style={{ color: 'var(--t3)' }}>Every file is resolved - Continue in Changes finishes the {s.op}.</span>
        )}
      </Done>
    )
  }

  const header = (
    <div style={{ height: 40, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid var(--bd-1)', background: 'var(--bg-input)', minWidth: 0, overflow: 'hidden' }}>
      <span title={path} style={{ font: '12.5px var(--font-mono)', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 40 }}>
        {path}
      </span>
      <span style={{ font: '12px var(--font-mono)', color: conflicts ? 'var(--c-red)' : 'var(--c-green)', whiteSpace: 'nowrap' }}>{conflicts ? `${plural(conflicts, 'conflict')} left` : 'no conflicts left'}</span>
      <span style={{ flex: 1 }} />
      {entry.kind === 'both' ? (
        <>
          <Button size="xs" onClick={() => ch.resolveFile(path, 'mine')} title={`The whole file as ${sides.mineLabel.toLowerCase()} has it`}>
            Take all yours
          </Button>
          <Button size="xs" onClick={() => ch.resolveFile(path, 'theirs')} title={`The whole file as ${sides.otherLabel} has it`}>
            Take all {sides.otherLabel}’s
          </Button>
          <Button size="xs" onClick={() => wsOpen(ch.task.id, `file:${path}`)} title="Edit it by hand - then Mark resolved">
            Edit file
          </Button>
          <Button size="xs" tone={conflicts ? undefined : 'success'} onClick={markResolved} title={conflicts ? 'It still has conflict markers' : 'Done with this file'}>
            Mark resolved
          </Button>
        </>
      ) : null}
    </div>
  )

  // One side deleted the file, the other changed it: keep it or let it go.
  if (entry.kind !== 'both') {
    const gitSideWithFile = entry.kind === 'deleted-ours' ? 'theirs' : 'ours'
    const keepSide = gitSideWithFile === sides.mine ? 'mine' : 'theirs'
    const deletedBy = entry.kind === 'both-deleted' ? 'both sides' : keepSide === 'mine' ? sides.otherLabel : 'your branch'
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {header}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, font: '13px var(--font-ui)', color: 'var(--t2)', alignItems: 'flex-start' }}>
          <span>
            {entry.kind === 'both-deleted' ? 'Both sides deleted this file.' : `${deletedBy === 'your branch' ? 'Your branch' : deletedBy} deleted this file; the other side changed it.`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {entry.kind !== 'both-deleted' ? (
              <Button size="sm" variant="primary" onClick={() => ch.resolveFile(path, keepSide)}>
                Keep the file
              </Button>
            ) : null}
            <Button size="sm" tone="danger" onClick={() => ch.resolveFile(path, entry.kind === 'both-deleted' ? 'as-is' : keepSide === 'mine' ? 'theirs' : 'mine')}>
              Delete it
            </Button>
          </div>
        </div>
      </div>
    )
  }

  let k = -1
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {header}
      <div className="sy-diff" style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg-console)', padding: '8px 0 24px' }}>
        {text == null ? <div style={{ padding: 24, color: 'var(--t3)', font: '13px var(--font-ui)' }}>Reading the file…</div> : null}
        {parts.map((p, i) => {
          if (p.t === 'text') return <Unchanged key={i} lines={p.lines} first={i === 0} last={i === parts.length - 1} open={unfolded.has(i)} onOpen={() => setUnfolded((u) => new Set(u).add(i))} path={path} />
          k++
          const n = k
          return <ConflictBlock key={i} part={p} n={n} total={conflicts} path={path} mineIsOurs={sides.mine === 'ours'} mineLabel={sides.mineLabel} otherLabel={sides.otherLabel} onChoose={(w) => choose(n, w)} />
        })}
      </div>
    </div>
  )
}

function Done({ text, children }: { text: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', font: '13px var(--font-ui)', color: 'var(--t2)' }}>
      <span>{text}</span>
      {children}
    </div>
  )
}

/** Settled lines between conflicts: a few next to each, the rest folded. */
function Unchanged({ lines, first, last, open, onOpen, path }: { lines: string[]; first: boolean; last: boolean; open: boolean; onOpen: () => void; path: string }): React.JSX.Element {
  const head = first ? 0 : AROUND
  const tail = last ? 0 : AROUND
  const fold = !open && lines.length > head + tail + 1
  const shown = fold ? [...lines.slice(0, head).map((l) => ({ l, gap: false })), { l: '', gap: true }, ...lines.slice(lines.length - tail).map((l) => ({ l, gap: false }))] : lines.map((l) => ({ l, gap: false }))
  const hidden = lines.length - head - tail
  const hl = useMemo(() => highlightLines(path, lines.map((l) => l.replace(/\r?\n$/, ''))), [lines, path])
  let at = 0
  return (
    <>
      {shown.map((x, i) => {
        if (x.gap) {
          at = lines.length - tail
          return (
            <div key={i} className="sy-gap">
              <span>⋯ {plural(hidden, 'line')}</span>
              <button onClick={onOpen}>show</button>
            </div>
          )
        }
        const idx = at++
        const t = x.l.replace(/\r?\n$/, '')
        return (
          <div key={i} className="sy-dr" style={{ gridTemplateColumns: '20px minmax(0,1fr)' }}>
            <span />
            <span className="txt">{segmentsOf(t, hl?.[idx], undefined).map((s, j) => (s.cls ? <span key={j} className={s.cls}>{s.text}</span> : s.text))}</span>
          </div>
        )
      })}
    </>
  )
}

function ConflictBlock({
  part,
  n,
  total,
  path,
  mineIsOurs,
  mineLabel,
  otherLabel,
  onChoose
}: {
  part: Extract<Part, { t: 'conflict' }>
  n: number
  total: number
  path: string
  mineIsOurs: boolean
  mineLabel: string
  otherLabel: string
  onChoose: (which: 'mine' | 'other' | 'both') => void
}): React.JSX.Element {
  const mine = mineIsOurs ? part.ours : part.theirs
  const other = mineIsOurs ? part.theirs : part.ours
  return (
    <div style={{ margin: '10px 16px', border: '1px solid color-mix(in srgb, var(--c-red) 40%, transparent)', borderRadius: 6, overflow: 'hidden', background: 'var(--bg-panel)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--bd-2)', font: '12px var(--font-ui)', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--c-red)', fontFamily: 'var(--font-mono)' }}>
          Conflict {n + 1}/{total}
        </span>
        <span style={{ flex: 1 }} />
        <Button size="xs" onClick={() => onChoose('mine')}>
          Keep yours
        </Button>
        <Button size="xs" onClick={() => onChoose('other')}>
          Keep {otherLabel}’s
        </Button>
        <Button size="xs" onClick={() => onChoose('both')} title="Yours, then theirs">
          Keep both
        </Button>
      </div>
      <Side label={mineLabel} tone="var(--c-green)" lines={mine} path={path} />
      <Side label={otherLabel} tone="var(--c-blue)" lines={other} path={path} />
    </div>
  )
}

function Side({ label, tone, lines, path }: { label: string; tone: string; lines: string[]; path: string }): React.JSX.Element {
  const texts = useMemo(() => lines.map((l) => l.replace(/\r?\n$/, '')), [lines])
  const hl = useMemo(() => highlightLines(path, texts), [texts, path])
  return (
    <div style={{ boxShadow: `inset 3px 0 0 color-mix(in srgb, ${tone} 70%, transparent)`, background: `color-mix(in srgb, ${tone} 6%, transparent)` }}>
      <div style={{ padding: '4px 12px 2px 14px', font: '11px var(--font-mono)', color: tone }}>{label}</div>
      {texts.length ? (
        texts.map((t, i) => (
          <div key={i} className="sy-dr" style={{ gridTemplateColumns: '14px minmax(0,1fr)' }}>
            <span />
            <span className="txt">{segmentsOf(t, hl?.[i], undefined).map((s, j) => (s.cls ? <span key={j} className={s.cls}>{s.text}</span> : s.text))}</span>
          </div>
        ))
      ) : (
        <div style={{ padding: '2px 14px 6px', font: '12px var(--font-ui)', color: 'var(--t4)', fontStyle: 'italic' }}>(nothing - these lines are removed on this side)</div>
      )}
      <div style={{ height: 4 }} />
    </div>
  )
}
