import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../store/AppStore'
import { useHover } from '../../lib/useHover'
import { agentShort, hasTools } from '../../lib/derive'
import { timeAgo } from '../../lib/status'
import { keyLabel } from '../../lib/keys'
import { criteriaDone, criteriaMessage, newCriterion, parseCriteria } from '../../lib/criteria'
import { Button, Modal } from '../../components/ui'
import type { Criterion, Task } from '@shared/types'

const MARK: Record<Criterion['status'], { icon: string; color: string }> = {
  open: { icon: '○', color: 'var(--t4)' },
  passed: { icon: '✓', color: 'var(--c-green)' },
  failed: { icon: '✕', color: 'var(--c-red)' }
}

/**
 * What "done" means for the task: criteria the agent verifies with evidence
 * (verify_criterion: how it checked, a screenshot), or you tick yourself.
 */
export function AcceptanceCriteria({ task }: { task: Task }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [adding, setAdding] = useState<string | null>(null)
  const [zoom, setZoom] = useState<Criterion | null>(null)
  const list = task.criteria ?? []
  const done = criteriaDone(task)
  const agent = agentShort(task.agentKind) || 'the agent'
  const set = (criteria: Criterion[]): void => dispatch({ type: 'SET_CRITERIA', taskId: task.id, criteria })
  const running = !!task.agentKind && task.col !== 'done'

  const add = (): void => {
    const texts = parseCriteria(adding ?? '')
    if (texts.length) set([...list, ...texts.map(newCriterion)])
    setAdding(null)
  }
  const ask = (): void =>
    dispatch({
      type: 'MESSAGE_AGENT',
      taskId: task.id,
      text: criteriaMessage(task, state.prefs.agentTools && hasTools(task.agentKind), 'unverified'),
      toast: `Asked ${agent} to verify ${done.total - done.passed} criteri${done.total - done.passed === 1 ? 'on' : 'a'}.`
    })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ font: '500 11px var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)', flex: 1 }}>Acceptance</span>
        {list.length ? <span style={{ font: '11.5px var(--font-mono)', color: done.passed === done.total ? 'var(--c-green)' : 'var(--t3)' }}>{done.passed}/{done.total} verified</span> : null}
      </div>
      {list.map((c, i) => (
        <CriterionRow
          key={c.id}
          c={c}
          n={i + 1}
          agent={agent}
          onToggle={() => set(list.map((x) => (x.id === c.id ? { ...x, status: x.status === 'passed' ? 'open' : 'passed', by: 'you', at: Date.now(), note: x.status === 'passed' ? null : 'Checked by you', image: x.status === 'passed' ? null : x.image } : x)))}
          onEdit={(text) => set(text.trim() ? list.map((x) => (x.id === c.id ? { ...x, text: text.trim() } : x)) : list.filter((x) => x.id !== c.id))}
          onDelete={() => set(list.filter((x) => x.id !== c.id))}
          onZoom={() => setZoom(c)}
        />
      ))}
      {adding !== null ? (
        <textarea
          autoFocus
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              add()
            }
            if (e.key === 'Escape') setAdding(null)
          }}
          onBlur={add}
          rows={2}
          placeholder={`What must be true when it's done? ${keyLabel('⇧↵')} for another line`}
          style={{ resize: 'vertical', background: 'var(--bg-panel-3)', color: 'var(--t1)', border: '1px solid color-mix(in srgb, var(--c-blue) 60%, transparent)', borderRadius: 5, padding: '6px 8px', font: '12.5px/1.45 var(--font-ui)', outline: 'none' }}
        />
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span onClick={() => setAdding('')} style={{ font: '12px var(--font-ui)', color: 'var(--t3)', cursor: 'pointer' }}>
            + {list.length ? 'Add a criterion' : 'Add acceptance criteria'}
          </span>
          <span style={{ flex: 1 }} />
          {running && done.passed < done.total ? (
            <Button size="xs" onClick={ask} title={`Send ${agent} the criteria not verified yet, to check and prove`}>
              Ask {agent} to verify
            </Button>
          ) : null}
        </div>
      )}
      {zoom?.image ? <EvidenceModal c={zoom} onClose={() => setZoom(null)} /> : null}
    </div>
  )
}

function CriterionRow({
  c,
  n,
  agent,
  onToggle,
  onEdit,
  onDelete,
  onZoom
}: {
  c: Criterion
  n: number
  agent: string
  onToggle: () => void
  onEdit: (text: string) => void
  onDelete: () => void
  onZoom: () => void
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const [editing, setEditing] = useState<string | null>(null)
  const mark = MARK[c.status]
  return (
    <div {...hoverProps} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span
        onClick={onToggle}
        title={c.status === 'passed' ? 'Mark as not verified' : 'Mark as verified yourself'}
        style={{ width: 16, flex: 'none', textAlign: 'center', font: '600 12.5px/19px var(--font-mono)', color: mark.color, cursor: 'pointer' }}
      >
        {mark.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {editing !== null ? (
          <input
            autoFocus
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setEditing(null)
            }}
            onBlur={() => {
              if (editing !== null) onEdit(editing)
              setEditing(null)
            }}
            style={{ font: '12.5px/1.45 var(--font-ui)', color: 'var(--t1)', background: 'var(--bg-panel-3)', border: '1px solid color-mix(in srgb, var(--c-blue) 60%, transparent)', borderRadius: 4, padding: '1px 5px', outline: 'none' }}
          />
        ) : (
          <span onDoubleClick={() => setEditing(c.text)} title="Double-click to edit" style={{ font: '12.5px/1.45 var(--font-ui)', color: c.status === 'passed' ? 'var(--t2)' : 'var(--t1)', overflowWrap: 'anywhere' }}>
            <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)' }}>{n}. </span>
            {c.text}
          </span>
        )}
        {c.note || c.image ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            {c.image ? <Thumb path={c.image} onClick={onZoom} /> : null}
            <span style={{ font: '11.5px/1.45 var(--font-ui)', color: c.status === 'failed' ? 'var(--c-red)' : 'var(--t3)', overflowWrap: 'anywhere' }}>
              {c.note}
              {c.at ? <span style={{ font: '10.5px var(--font-mono)', color: 'var(--t5)' }}> · {c.by === 'agent' ? agent : 'you'} · {timeAgo(c.at)} ago</span> : null}
            </span>
          </div>
        ) : null}
      </div>
      {hover && editing === null ? (
        <span onClick={onDelete} title="Remove" style={{ font: '12px var(--font-mono)', color: 'var(--t5)', cursor: 'pointer', lineHeight: '19px' }}>
          ×
        </span>
      ) : null}
    </div>
  )
}

/** An evidence screenshot, small; click for the whole of it. */
function Thumb({ path, onClick }: { path: string; onClick: () => void }): React.JSX.Element | null {
  const src = useEvidence(path)
  if (!src) return null
  return <img src={src} onClick={onClick} alt="Evidence" title="The agent's screenshot - click to enlarge" style={{ width: 64, maxHeight: 48, objectFit: 'cover', objectPosition: 'top', borderRadius: 3, border: '1px solid var(--bd-3)', cursor: 'zoom-in', flex: 'none' }} />
}

function useEvidence(path: string): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    window.api.evidenceImage(path).then((s) => live && setSrc(s))
    return () => {
      live = false
    }
  }, [path])
  return src
}

function EvidenceModal({ c, onClose }: { c: Criterion; onClose: () => void }): React.JSX.Element {
  const src = useEvidence(c.image!)
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  return (
    <Modal width={900} top={60} kicker={c.status === 'passed' ? 'Verified' : c.status === 'failed' ? 'Failed' : 'Evidence'} title={c.text} onClose={onClose}>
      <div style={{ overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {c.note ? <div style={{ font: '13px/1.5 var(--font-ui)', color: 'var(--t2)' }}>{c.note}</div> : null}
        {src ? <img src={src} alt="Evidence" style={{ maxWidth: '100%', border: '1px solid var(--bd-3)', borderRadius: 5 }} /> : null}
      </div>
    </Modal>
  )
}
