import React, { useState } from 'react'
import { plural } from '../../../lib/summary'
import { useHover } from '../../../lib/useHover'
import { timeAgo } from '../../../lib/status'
import { errText } from '../../../lib/errors'
import { keyLabel, revealLabel } from '../../../lib/keys'
import { nativePath } from '../../../lib/paths'
import { commitMessageFor } from '../../../lib/taskActions'
import { Button, Menu, TextInput, type MenuItem } from '../../../components/ui'
import { useAppStore } from '../../../store/AppStore'
import { startTabDrag, setDrag, wsOpen } from '../../../lib/wsStore'
import type { FileDiff } from '@shared/types'
import { useChanges } from './ChangesContext'
import { PanelHeader, PanelIcon, type PanelChrome } from '../layout/PanelHeader'

const SECTION: React.CSSProperties = { font: '500 11px var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)' }

/** The Changes side bar view: what the branch changed, file by file (each opens as a diff tab), the review, and its commits. */
export function ChangesView({ chrome, activeDiff, root }: { chrome: PanelChrome; activeDiff: string | null; root: string }): React.JSX.Element {
  const { dispatch } = useAppStore()
  const ch = useChanges()
  const { task, files } = ch
  const [menu, setMenu] = useState<{ x: number; y: number; file: FileDiff } | null>(null)
  const totalAdd = (files ?? []).reduce((n, f) => n + f.added, 0)
  const totalDel = (files ?? []).reduce((n, f) => n + f.deleted, 0)
  const viewedCount = (files ?? []).filter((f) => ch.viewed[f.path]).length
  const uncommitted = (files ?? []).filter((f) => f.uncommitted)
  const pending = ch.pending
  const native = (rel: string): string => nativePath(root, rel)
  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  const open = (path: string): void => wsOpen(task.id, `diff:${path}`)

  const fileMenu = (f: FileDiff): MenuItem[] => [
    { label: 'Open Diff', onClick: () => open(f.path) },
    ...(f.status !== 'deleted'
      ? [
          { label: 'Open File', onClick: () => wsOpen(task.id, `file:${f.path}`) },
          { label: 'Open in Editor', onClick: () => window.api.sys.openInEditor(native(f.path)).catch(toastErr) }
        ]
      : []),
    { label: ch.viewed[f.path] ? 'Mark as not viewed' : 'Mark viewed', separatorBefore: true, onClick: () => ch.toggleViewed(f.path) },
    ...(ch.openSent(f.path) ? [{ label: `Resolve all ${ch.openSent(f.path)} comments`, onClick: () => ch.resolveAll(f.path) }] : []),
    ...(f.uncommitted ? [{ label: 'Discard changes…', danger: true, onClick: () => ch.discard(f.path) }] : []),
    { label: 'Copy Path', separatorBefore: true, onClick: () => window.api.sys.copy(native(f.path)) },
    { label: 'Copy Relative Path', onClick: () => window.api.sys.copy(f.path) },
    ...(f.status !== 'deleted' ? [{ label: revealLabel, onClick: () => window.api.sys.showItem(native(f.path)).catch(toastErr) }] : [])
  ]

  // Files under their folder (the top folder's first), each folder once.
  const rows: ({ dir: string } | { file: FileDiff })[] = []
  let lastDir: string | null = null
  for (const file of ch.ordered) {
    const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.'
    if (dir !== lastDir) rows.push({ dir })
    lastDir = dir
    rows.push({ file })
  }

  return (
    <>
      <PanelHeader title="Changes" chrome={chrome}>
        <PanelIcon title="Refresh" onClick={ch.refresh}>
          <path d="M11.6 6.2A4.7 4.7 0 0 0 3 4.3" />
          <path d="M2.8 1.8v2.7h2.7" />
          <path d="M2.4 7.8a4.7 4.7 0 0 0 8.6 1.9" />
          <path d="M11.2 12.2V9.5H8.5" />
        </PanelIcon>
      </PanelHeader>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '6px 14px 8px', display: 'flex', alignItems: 'center', gap: 8, font: '12px var(--font-mono)', color: 'var(--t3)' }}>
          <span style={{ flex: 1, whiteSpace: 'nowrap' }}>
            {files === null ? (
              'Loading…'
            ) : (
              <>
                {plural(files.length, 'file')} <span style={{ color: 'var(--c-green)' }}>+{totalAdd}</span> <span style={{ color: 'var(--c-red)' }}>−{totalDel}</span>
              </>
            )}
          </span>
          {files && files.length ? (
            <span title="Files you've marked viewed - they unmark when they change again" style={{ color: viewedCount === files.length ? 'var(--c-green)' : 'var(--t3)', whiteSpace: 'nowrap' }}>
              {viewedCount}/{files.length} viewed
            </span>
          ) : null}
        </div>
        <div style={{ margin: '0 14px 8px', height: 3, background: 'var(--bd-1)', borderRadius: 2, flex: 'none' }}>
          <div style={{ width: files?.length ? `${(viewedCount / files.length) * 100}%` : 0, height: '100%', background: 'var(--c-green)', borderRadius: 2, transition: 'width .2s' }} />
        </div>
        <div title={`${task.branch} vs ${ch.base}`} style={{ padding: '0 14px 8px', font: '11.5px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          ⎇ {task.branch} vs {ch.base}
        </div>
        {pending.length > 0 ? (
          <div style={{ margin: '0 10px 10px', border: '1px solid color-mix(in srgb, var(--c-blue) 40%, transparent)', background: 'color-mix(in srgb, var(--c-blue) 5%, transparent)', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ font: '500 12.5px var(--font-ui)', color: 'var(--t1)', flex: 1 }}>Review</span>
              <span style={{ font: '11.5px var(--font-mono)', color: 'var(--c-blue)' }}>
                {plural(pending.length, 'comment')} · {plural(new Set(pending.map((c) => c.path)).size, 'file')}
              </span>
            </div>
            <textarea
              value={ch.summary}
              onChange={(e) => ch.setSummary(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') ch.sendReview()
              }}
              placeholder="Overall note (optional)"
              rows={2}
              style={{ resize: 'vertical', background: 'var(--bg-panel-3)', color: 'var(--t1)', border: '1px solid var(--bd-3)', borderRadius: 5, padding: '6px 8px', font: '12px/1.45 var(--font-ui)', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <Button variant="primary" onClick={ch.sendReview} title={`Send the comments and note to ${ch.agent} as one message (${keyLabel('⌘↵')} in the note)`} style={{ flex: 1, minWidth: 0 }}>
                Send review to {ch.agent}
              </Button>
              <Button onClick={ch.discardReview} title="Delete the review's comments">
                Discard
              </Button>
            </div>
          </div>
        ) : null}
        {uncommitted.length > 0 ? (
          <div style={{ margin: '0 10px 10px', border: '1px solid color-mix(in srgb, var(--c-amber) 35%, transparent)', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ font: '12px var(--font-mono)', color: 'var(--c-amber)' }}>{plural(uncommitted.length, 'uncommitted file')}</div>
            <TextInput
              size="md"
              value={ch.commitMsg}
              onChange={(e) => ch.setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') ch.commit()
              }}
              placeholder={commitMessageFor(task)}
              style={{ background: 'var(--bg-panel-3)', fontSize: 12 }}
            />
            <Button variant="primary" disabled={ch.committing} onClick={ch.commit} style={{ width: '100%' }}>
              {ch.committing ? 'Committing…' : 'Commit all'}
            </Button>
          </div>
        ) : null}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 6px' }}>
          {files && files.length === 0 ? <div style={{ padding: '8px 8px', color: 'var(--t4)', fontSize: 12.5 }}>No changes vs {ch.base}.</div> : null}
          {rows.map((r) =>
            'dir' in r ? (
              <div key={`d:${r.dir}`} style={{ display: 'flex', alignItems: 'center', height: 26, padding: '0 8px', font: '12px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.dir}/
              </div>
            ) : (
              <FileRow
                key={r.file.path}
                file={r.file}
                active={r.file.path === activeDiff}
                isViewed={!!ch.viewed[r.file.path]}
                comments={ch.comments.filter((c) => c.path === r.file.path && !c.resolved).length}
                pendingComments={ch.comments.filter((c) => c.path === r.file.path && c.pending).length}
                onClick={() => open(r.file.path)}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', native(r.file.path))
                  startTabDrag(e, `diff:${r.file.path}`, null)
                }}
                onDiscard={r.file.uncommitted ? () => ch.discard(r.file.path) : undefined}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, file: r.file })
                }}
              />
            )
          )}
        </div>
        {ch.commits.length || uncommitted.length ? (
          <div style={{ flex: 'none', borderTop: '1px solid var(--bd-1)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, font: '12px var(--font-mono)', color: 'var(--t3)', maxHeight: '40%', overflow: 'auto' }}>
            <div style={{ ...SECTION, marginBottom: 2 }}>Commits</div>
            {uncommitted.length ? (
              <div style={{ display: 'flex', gap: 10, whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--c-amber)' }}>●</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--t2)', fontFamily: 'var(--font-ui)' }}>uncommitted · {plural(uncommitted.length, 'file')}</span>
                <span style={{ color: 'var(--t4)' }}>now</span>
              </div>
            ) : null}
            {ch.commits.map((c) => (
              <div key={c.hash} title={`${c.hash}\n${c.message}`} style={{ display: 'flex', gap: 10, whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--c-blue)' }}>{c.hash.slice(0, 7)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--t2)', fontFamily: 'var(--font-ui)' }}>{c.message.split('\n')[0]}</span>
                <span style={{ color: 'var(--t4)' }}>{c.date ? timeAgo(new Date(c.date).getTime()) : ''}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {menu ? <Menu anchor={menu} items={fileMenu(menu.file)} onClose={() => setMenu(null)} /> : null}
    </>
  )
}

function FileRow({
  file,
  active,
  isViewed,
  comments,
  pendingComments,
  onClick,
  onDragStart,
  onDiscard,
  onContextMenu
}: {
  file: FileDiff
  active: boolean
  isViewed: boolean
  comments: number
  pendingComments: number
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
  onDiscard?: () => void
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const name = file.path.split('/').pop()
  const s = file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => setDrag(null)}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...hoverProps}
      title={file.uncommitted ? `${file.path} · has uncommitted changes` : file.path}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 26,
        padding: '0 8px 0 22px',
        borderRadius: 4,
        cursor: 'pointer',
        font: '12px var(--font-mono)',
        background: active ? 'color-mix(in srgb, var(--c-blue) 10%, transparent)' : hover ? 'var(--bg-menu)' : 'transparent'
      }}
    >
      <span style={{ width: 10, flex: 'none', color: s === 'A' ? 'var(--c-green)' : s === 'D' ? 'var(--c-red)' : 'var(--c-amber)' }}>{s}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: isViewed ? 'var(--t4)' : active ? 'var(--t1)' : 'var(--t2)',
          textDecoration: file.status === 'deleted' ? 'line-through' : 'none'
        }}
      >
        {name}
        {file.uncommitted ? <span title="Uncommitted changes" style={{ color: 'var(--c-amber)' }}> •</span> : null}
      </span>
      {onDiscard && hover ? (
        <span
          onClick={(e) => {
            e.stopPropagation()
            onDiscard()
          }}
          title="Discard this file's uncommitted changes"
          style={{ font: '11px var(--font-mono)', color: 'var(--c-red)' }}
        >
          ↺
        </span>
      ) : (
        <>
          {comments ? (
            <span style={{ color: 'var(--c-blue)' }} title={pendingComments ? `${pendingComments} in the review, not sent yet` : plural(comments, 'comment')}>
              {comments}✎{pendingComments ? '·' : ''}
            </span>
          ) : null}
          <span style={{ color: 'var(--c-green)' }}>+{file.added}</span>
          <span style={{ color: 'var(--c-red)', minWidth: 24, textAlign: 'right' }}>{file.deleted ? `−${file.deleted}` : ''}</span>
        </>
      )}
      <span style={{ width: 12, textAlign: 'center', color: 'var(--c-green)' }}>{isViewed ? '✓' : ''}</span>
    </div>
  )
}
