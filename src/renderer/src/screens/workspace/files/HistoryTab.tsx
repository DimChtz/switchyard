import React, { useEffect, useState } from 'react'
import { Button } from '../../../components/ui'
import { useHover } from '../../../lib/useHover'
import { timeAgo } from '../../../lib/status'
import { taskOfCommit } from '../../../lib/commitTask'
import { wsOpen } from '../../../lib/wsStore'
import { useAppStore } from '../../../store/AppStore'
import type { FileCommit } from '@shared/types'
import { useChangesMaybe } from '../changes/ChangesContext'

/** A file's commits, newest first, each with its task when it came from one: click one for its changes. */
export function HistoryTab({ path }: { path: string }): React.JSX.Element {
  const ch = useChangesMaybe()
  const { state, dispatch } = useAppStore()
  const repo = ch?.repoOf(path) ?? null
  const [list, setList] = useState<FileCommit[] | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!repo) return
    let live = true
    setList(null)
    window.api.git
      .fileHistory(repo.path, repo.rel)
      .then((l) => live && setList(l))
      .catch(() => live && setList([]))
    return () => {
      live = false
    }
    // (Read again when a commit lands: the Changes list moves on.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.path, repo?.rel, ch?.commits.length])

  const needle = filter.trim().toLowerCase()
  const shown = (list ?? []).filter((c) => !needle || c.subject.toLowerCase().includes(needle) || c.author.toLowerCase().includes(needle) || c.hash.startsWith(needle))
  const name = path.split('/').pop()

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 40, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid var(--bd-1)', background: 'var(--bg-input)', minWidth: 0 }}>
        <span style={{ font: '12.5px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          History of <span style={{ color: 'var(--t1)' }}>{path}</span>
        </span>
        <span style={{ font: '12px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap' }}>{list ? `${list.length}${list.length >= 200 ? '+' : ''} commits` : ''}</span>
        <span style={{ flex: 1 }} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Filter"
          spellCheck={false}
          style={{ width: 160, height: 24, boxSizing: 'border-box', background: 'var(--bg-panel-3)', border: '1px solid var(--bd-3)', borderRadius: 5, color: 'var(--t1)', font: '12px var(--font-ui)', padding: '0 8px', outline: 'none' }}
        />
        <Button size="xs" onClick={() => wsOpen(ch?.task.id ?? '', `file:${path}`)}>
          Open file
        </Button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 8px', background: 'var(--bg-console)' }}>
        {!repo ? <Note text="Not in one of the task's repositories." /> : list === null ? <Note text="Reading its history…" /> : list.length === 0 ? <Note text={`${name} has no commits yet.`} /> : null}
        {shown.map((c, i) => {
          const t = taskOfCommit(c.subject, state.tasks)
          return (
            <Row
              key={c.hash}
              c={c}
              last={i === shown.length - 1}
              taskKey={t?.key ?? null}
              onOpenTask={t && t.id !== ch?.task.id ? () => dispatch({ type: 'OPEN_TASK', taskId: t.id }) : undefined}
              onClick={() => ch?.showCommit(c.hash, path, c.subject)}
            />
          )
        })}
      </div>
    </div>
  )
}

function Note({ text }: { text: string }): React.JSX.Element {
  return <div style={{ padding: 24, font: '13px var(--font-ui)', color: 'var(--t3)' }}>{text}</div>
}

function Row({ c, last, taskKey, onOpenTask, onClick }: { c: FileCommit; last: boolean; taskKey: string | null; onOpenTask?: () => void; onClick: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      onClick={onClick}
      {...hoverProps}
      title={`${c.hash}\n${c.author} · ${new Date(c.at).toLocaleString()}\n${c.subject}\n\nClick to see what it changed`}
      style={{ display: 'grid', gridTemplateColumns: '14px 64px minmax(0,1fr) auto auto 40px', alignItems: 'center', columnGap: 10, height: 30, padding: '0 8px', borderRadius: 5, cursor: 'pointer', background: hover ? 'var(--bg-menu)' : 'transparent', font: '12px var(--font-mono)' }}
    >
      {/* A line through the dots: the file's timeline. */}
      <span style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ position: 'absolute', top: 0, bottom: last ? '50%' : 0, width: 1, background: 'var(--bd-3)' }} />
        <span style={{ position: 'relative', width: 7, height: 7, borderRadius: '50%', background: taskKey ? 'var(--c-blue)' : 'var(--t4)' }} />
      </span>
      <span style={{ color: 'var(--c-blue)' }}>{c.hash.slice(0, 7)}</span>
      <span style={{ color: 'var(--t1)', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.subject}</span>
      {taskKey ? (
        <span
          onClick={
            onOpenTask
              ? (e) => {
                  e.stopPropagation()
                  onOpenTask()
                }
              : undefined
          }
          title={onOpenTask ? `Open ${taskKey}` : 'This task'}
          style={{ padding: '1px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--c-blue) 14%, transparent)', color: 'var(--c-blue)', fontSize: 11 }}
        >
          {taskKey}
        </span>
      ) : (
        <span />
      )}
      <span style={{ color: 'var(--t3)', whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.author}</span>
      <span style={{ color: 'var(--t4)', textAlign: 'right' }}>{timeAgo(c.at)}</span>
    </div>
  )
}
