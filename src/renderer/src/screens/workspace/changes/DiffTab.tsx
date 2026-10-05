import React, { useState } from 'react'
import { useHover } from '../../../lib/useHover'
import { timeAgo } from '../../../lib/status'
import { keyLabel } from '../../../lib/keys'
import { plural } from '../../../lib/summary'
import { Button } from '../../../components/ui'
import { replaceTab } from '../../../lib/wsLayout'
import { setLayout, wsOpen } from '../../../lib/wsStore'
import type { DiffLine, ReviewComment } from '@shared/types'
import { useChanges } from './ChangesContext'

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

/** One file's changes as a tab: click a line (shift-click for several) to comment for the agent. */
export function DiffTab({ path, gid }: { path: string; gid: string }): React.JSX.Element {
  const ch = useChanges()
  const { task, files, agent } = ch
  const file = files?.find((f) => f.path === path) ?? null
  // The rows a comment is being written on (shift-click extends from the anchor).
  const [sel, setSel] = useState<{ anchor: number; from: number; to: number } | null>(null)
  const [commentText, setCommentText] = useState('')
  const sorted = ch.ordered
  const swapTo = (next: string): void => setLayout(task.id, (L) => replaceTab(L, gid, `diff:${path}`, `diff:${next}`))
  const nextFile = (): void => {
    const i = sorted.findIndex((f) => f.path === path)
    const nx = sorted[(i + 1) % sorted.length]
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

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 40, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--bd-1)', background: 'var(--bg-input)', minWidth: 0 , overflow: 'hidden' }}>
        <span title={path} style={{ font: '12.5px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 56, flex: '0 0 auto', maxWidth: '45%', direction: 'rtl', textAlign: 'left' }}>
          <bdi>
            {dir}
            <span style={{ color: 'var(--t1)' }}>{path.split('/').pop()}</span>
          </bdi>
        </span>
        {file ? (
          <span style={{ display: 'flex', gap: 6, font: '12px var(--font-mono)', whiteSpace: 'nowrap', flex: 'none' }}>
            <span style={{ color: 'var(--c-green)' }}>+{file.added}</span>
            {file.deleted ? <span style={{ color: 'var(--c-red)' }}>−{file.deleted}</span> : null}
            {file.status !== 'modified' ? <span style={{ color: 'var(--t4)' }}>{file.status}</span> : null}
            {file.uncommitted ? <span style={{ color: 'var(--c-amber)' }}>uncommitted</span> : null}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {file && file.lines.length ? <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1000 auto' }}>click a line to comment</span> : null}
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
          <Button size="xs" onClick={() => wsOpen(task.id, `file:${path}`)}>
            Edit file
          </Button>
        ) : null}
        {file ? (
          <Button size="xs" tone={ch.viewed[path] ? 'success' : undefined} onClick={markViewed}>
            {ch.viewed[path] ? 'Viewed ✓' : 'Mark viewed'}
          </Button>
        ) : null}
        {sorted.length > 1 ? (
          <Button size="xs" onClick={nextFile}>
            Next file
          </Button>
        ) : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg-console)', padding: '6px 0' }}>
        {files === null ? (
          <div style={{ padding: 40, color: 'var(--t3)', fontSize: 13 }}>Loading…</div>
        ) : !file ? (
          <div style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 10, font: '13px var(--font-ui)', color: 'var(--t3)', alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--t2)' }}>No changes to {path.split('/').pop()} vs {ch.base} any more.</span>
            <Button size="sm" onClick={() => wsOpen(task.id, `file:${path}`)}>
              Open the file
            </Button>
          </div>
        ) : (
          <>
            {orphaned.length > 0 ? (
              <div style={{ margin: '0 16px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ font: '11px var(--font-mono)', color: 'var(--t4)' }}>Comments on lines no longer in this diff</div>
                {orphaned.map((c) => (
                  <CommentBox key={c.id} c={c} agent={agent} outdated onDelete={() => ch.removeComment(c.id)} onPatch={(p) => ch.patchComment(c.id, p)} onReply={(t) => ch.replyTo(c, t)} />
                ))}
              </div>
            ) : null}
            {file.lines.length === 0 ? (
              <div style={{ padding: '12px 16px', color: 'var(--t4)', fontSize: 12.5 }}>{file.status === 'deleted' ? 'File deleted.' : 'Binary file or no textual diff.'}</div>
            ) : (
              file.lines.map((l, i) => {
                const lineComments = placed.filter((p) => p.row === i)
                const picked = !!sel && i >= sel.from && i <= sel.to
                const add = l.kind === '+'
                const del = l.kind === '-'
                const hunk = l.kind === '@'
                return (
                  <div key={i}>
                    <DiffRow
                      line={l}
                      picked={picked}
                      onClick={(e) => !hunk && clickRow(i, e.shiftKey)}
                      bg={picked ? 'color-mix(in srgb, var(--c-blue) 14%, transparent)' : add ? 'color-mix(in srgb, var(--c-green) 8%, transparent)' : del ? 'color-mix(in srgb, var(--c-red) 8%, transparent)' : hunk ? 'color-mix(in srgb, var(--c-blue) 5%, transparent)' : 'transparent'}
                      edge={picked ? 'var(--c-blue)' : add ? 'color-mix(in srgb, var(--c-green) 60%, transparent)' : del ? 'color-mix(in srgb, var(--c-red) 60%, transparent)' : 'transparent'}
                    />
                    {lineComments.map(({ c, outdated }) => (
                      <CommentBox key={c.id} c={c} agent={agent} outdated={outdated} onDelete={() => ch.removeComment(c.id)} onPatch={(p) => ch.patchComment(c.id, p)} onReply={(t) => ch.replyTo(c, t)} indent />
                    ))}
                    {sel && sel.to === i ? (
                      <div style={{ margin: '6px 16px 8px 112px', maxWidth: 640, display: 'flex', flexDirection: 'column', border: '1px solid color-mix(in srgb, var(--c-blue) 50%, transparent)', borderRadius: 6, background: 'var(--bg-panel)' }}>
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
                  </div>
                )
              })
            )}
          </>
        )}
      </div>
      <div style={{ flex: 'none', borderTop: '1px solid var(--bd-1)', background: 'var(--bg-input)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ font: '12.5px var(--font-ui)', color: 'var(--t2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
      </div>
    </div>
  )
}

function DiffRow({ line: l, picked, bg, edge, onClick }: { line: DiffLine; picked: boolean; bg: string; edge: string; onClick: (e: React.MouseEvent) => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const hunk = l.kind === '@'
  const add = l.kind === '+'
  const del = l.kind === '-'
  return (
    <div
      onClick={onClick}
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      {...hoverProps}
      title={hunk ? undefined : 'Click to comment - shift-click to comment on several lines'}
      style={{
        display: 'grid',
        gridTemplateColumns: '46px 46px 20px minmax(0,1fr)',
        font: '12.5px/21px var(--font-mono)',
        background: bg,
        boxShadow: `inset 2px 0 0 ${edge}`,
        cursor: hunk ? 'default' : 'text',
        filter: hover && !hunk && !picked ? 'brightness(1.35)' : undefined
      }}
    >
      <span style={{ textAlign: 'right', paddingRight: 10, color: 'var(--t5)' }}>{hunk || add ? '' : l.oldLine}</span>
      <span style={{ textAlign: 'right', paddingRight: 10, color: 'var(--t5)' }}>{hunk || del ? '' : l.newLine}</span>
      <span style={{ color: add ? 'var(--c-green)' : 'var(--c-red)' }}>{add ? '+' : del ? '−' : ''}</span>
      <span style={{ whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis', color: hunk ? 'var(--t3)' : add || del ? 'var(--t1)' : 'var(--t2)' }}>{l.text}</span>
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
