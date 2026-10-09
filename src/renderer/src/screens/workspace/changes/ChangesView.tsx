import React, { useState } from 'react'
import { plural } from '../../../lib/summary'
import { useHover } from '../../../lib/useHover'
import { timeAgo } from '../../../lib/status'
import { errText } from '../../../lib/errors'
import { keyLabel, revealLabel } from '../../../lib/keys'
import { nativePath } from '../../../lib/paths'
import { commitMessageFor } from '../../../lib/taskActions'
import { Button, Menu, Segmented, TextInput, type MenuItem } from '../../../components/ui'
import { useAppStore } from '../../../store/AppStore'
import { startTabDrag, setDrag, wsOpen } from '../../../lib/wsStore'
import type { FileDiff, StashEntry } from '@shared/types'
import { useChanges } from './ChangesContext'
import { PanelHeader, PanelIcon, type PanelChrome } from '../layout/PanelHeader'

const SECTION: React.CSSProperties = { font: '500 11px var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)' }

/** The Changes side bar view: what the branch changed, file by file (each opens as a diff tab), the review, and its commits. */
export function ChangesView({ chrome, activeDiff, activeConflict, root }: { chrome: PanelChrome; activeDiff: string | null; activeConflict?: string | null; root: string }): React.JSX.Element {
  const { dispatch } = useAppStore()
  const ch = useChanges()
  const { task, files } = ch
  const [menu, setMenu] = useState<{ x: number; y: number; file: FileDiff } | null>(null)
  const [filter, setFilter] = useState('')
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const totalAdd = (files ?? []).reduce((n, f) => n + f.added, 0)
  const totalDel = (files ?? []).reduce((n, f) => n + f.deleted, 0)
  const viewedCount = (files ?? []).filter((f) => ch.viewed[f.path]).length
  const uncommitted = (files ?? []).filter((f) => f.uncommitted)
  const picked = uncommitted.filter((f) => ch.pickState(f) !== 'none')
  const someLines = picked.some((f) => ch.pickState(f) === 'some')
  const commitScope = typeof ch.scope === 'object' ? ch.scope.commit : null
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
    ...(f.uncommitted ? [{ label: 'Discard uncommitted changes…', danger: true, onClick: () => ch.discard(f.path) }] : []),
    ...(!commitScope && ch.scope !== 'uncommitted'
      ? [{ label: ch.scope === 'branch' ? `Undo all changes (back to ${ch.base})…` : 'Undo changes not pushed…', danger: true, onClick: () => ch.revertFile(f) }]
      : []),
    { label: 'Copy Path', separatorBefore: true, onClick: () => window.api.sys.copy(native(f.path)) },
    { label: 'Copy Relative Path', onClick: () => window.api.sys.copy(f.path) },
    ...(f.status !== 'deleted' ? [{ label: revealLabel, onClick: () => window.api.sys.showItem(native(f.path)).catch(toastErr) }] : [])
  ]

  // Files under their folder (the top folder's first), each folder once; a folded folder's files hidden.
  const needle = filter.trim().toLowerCase()
  const shown = needle ? ch.ordered.filter((f) => f.path.toLowerCase().includes(needle) || f.oldPath?.toLowerCase().includes(needle)) : ch.ordered
  const rows: ({ dir: string; count: number } | { file: FileDiff })[] = []
  let lastDir: string | null = null
  for (const file of shown) {
    const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.'
    if (dir !== lastDir) rows.push({ dir, count: shown.filter((f) => (f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.') === dir).length })
    lastDir = dir
    if (!folded.has(dir)) rows.push({ file })
  }
  const toggleFold = (dir: string): void =>
    setFolded((s) => {
      const next = new Set(s)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })

  // What the files are compared with, in so many words.
  const branch = task.branch ? `⎇ ${task.branch}` : 'The worktree'
  const against = commitScope
    ? `What commit ${commitScope.slice(0, 7)} changed`
    : ch.scope === 'branch'
      ? `${branch} vs ${ch.base}`
      : ch.scope === 'unpushed'
        ? `${branch} vs origin`
        : `${branch} vs its last commit`
  const empty = commitScope
    ? 'This commit changed nothing to show.'
    : ch.scope === 'branch'
      ? `No changes vs ${ch.base}.`
      : ch.scope === 'unpushed'
        ? 'Everything is committed and pushed.'
        : 'Nothing uncommitted.'

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
        {ch.sync ? <SyncBox activeConflict={activeConflict} /> : null}
        {!ch.sync && ch.behind > 0 && !commitScope ? (
          <div style={{ margin: '0 10px 8px', padding: '6px 8px 6px 10px', display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--bd-2)', borderRadius: 6, font: '12px var(--font-ui)', color: 'var(--t3)' }}>
            <span style={{ flex: 1, minWidth: 0 }} title={`${ch.base} has ${plural(ch.behind, 'commit')} this branch doesn't`}>
              <span style={{ color: 'var(--c-blue)' }}>↓</span> {ch.base} has {plural(ch.behind, 'new commit')}
            </span>
            <Button size="xs" disabled={ch.syncing} onClick={ch.updateBranch} title={`Bring them into this branch (Settings → Git: rebase or merge). Conflicts are left for you to resolve here.`}>
              {ch.syncing ? 'Updating…' : 'Update branch'}
            </Button>
          </div>
        ) : null}
        <div style={{ padding: '0 14px 8px' }}>
          {commitScope ? (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, height: 26, padding: '0 4px 0 10px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--c-blue) 45%, transparent)', background: 'color-mix(in srgb, var(--c-blue) 8%, transparent)', font: '12px var(--font-mono)' }}
            >
              <span style={{ color: 'var(--c-blue)' }}>{commitScope.slice(0, 7)}</span>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--t2)', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {ch.commits.find((c) => c.hash === commitScope || commitScope.startsWith(c.hash))?.message.split('\n')[0] ?? ch.commitSubject ?? 'commit'}
              </span>
              <Button size="xs" onClick={() => ch.setScope('branch')} title="Back to all the branch's changes">
                ✕
              </Button>
            </div>
          ) : (
            <Segmented
              value={ch.scope as string}
              onChange={(v) => ch.setScope(v as 'branch' | 'unpushed' | 'uncommitted')}
              options={[
                ['uncommitted', <span key="c" title="Only what isn't committed yet">Uncommitted</span>],
                ['unpushed', <span key="p" title={`Your pending work: what isn't on origin's copy of ${task.branch} yet - uncommitted or committed (all of it when the branch was never pushed)`}>Unpushed</span>],
                ['branch', <span key="b" title={`Everything the branch changed since it left ${ch.base} - what its pull request shows`}>Branch</span>]
              ]}
              style={{ font: '11.5px var(--font-ui)', flexWrap: 'nowrap', width: 'fit-content' }}
            />
          )}
        </div>
        <div title={against} style={{ padding: '0 14px 6px', font: '11.5px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {against}
        </div>
        <div style={{ padding: '0 14px 6px', display: 'flex', alignItems: 'center', gap: 8, font: '12px var(--font-mono)', color: 'var(--t3)' }}>
          <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${task.branch ?? ''} · ${ch.scopeNote}`}>
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
        {uncommitted.length > 0 && !commitScope && !ch.sync ? (
          <div style={{ margin: '0 10px 10px', border: '1px solid color-mix(in srgb, var(--c-amber) 35%, transparent)', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 8, font: '12px var(--font-mono)', color: 'var(--c-amber)' }}>
              <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{plural(uncommitted.length, 'uncommitted file')}</span>
              {picked.length < uncommitted.length || someLines ? <span style={{ color: 'var(--t3)' }}>{picked.length} picked{someLines ? ' (some lines)' : ''}</span> : null}
            </div>
            <TextInput
              size="md"
              value={ch.commitMsg}
              onChange={(e) => ch.setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') ch.commit((e.metaKey || e.ctrlKey) && !!task.branch)
              }}
              placeholder={commitMessageFor(task)}
              style={{ background: 'var(--bg-panel-3)', fontSize: 12 }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                variant="primary"
                disabled={ch.committing || picked.length === 0}
                onClick={() => ch.commit()}
                title="Untick a file in the list to leave it out"
                style={{ flex: 1, minWidth: 0 }}
              >
                {ch.committing ? 'Committing…' : picked.length === uncommitted.length && !someLines ? 'Commit all' : someLines ? 'Commit picked lines' : `Commit ${plural(picked.length, 'file')}`}
              </Button>
              {task.branch ? (
                <Button disabled={ch.committing || picked.length === 0} onClick={() => ch.commit(true)} title={`Commit, then push ${task.branch} (${keyLabel('⌘↵')} in the message)`}>
                  & Push
                </Button>
              ) : null}
              <Button
                disabled={ch.committing || picked.length === 0 || someLines}
                onClick={ch.stash}
                title={someLines ? 'Stash takes whole files - tick files, not lines' : picked.length < uncommitted.length ? 'Put the ticked files aside, uncommitted (the message box names it)' : 'Put the uncommitted changes aside (the message box names it) - bring them back from Stashed'}
              >
                Stash
              </Button>
            </div>
          </div>
        ) : null}
        {files && files.length > 1 ? (
          <div style={{ padding: '0 10px 6px', flex: 'none' }}>
            <TextInput
              size="sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') setFilter('')
                if (e.key === 'Enter' && shown[0]) open(shown[0].path)
              }}
              placeholder="Filter files"
              style={{ width: '100%', fontSize: 12 }}
            />
          </div>
        ) : null}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 6px' }}>
          {files && files.length === 0 ? (
            <div style={{ padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', color: 'var(--t4)', fontSize: 12.5 }}>
              <span>{empty}</span>
              {ch.scope !== 'branch' ? (
                <Button size="sm" onClick={() => ch.setScope('branch')} title="What its pull request shows">
                  Show the whole branch vs {ch.base}
                </Button>
              ) : null}
            </div>
          ) : null}
          {files && files.length > 0 && shown.length === 0 ? <div style={{ padding: '8px 8px', color: 'var(--t4)', fontSize: 12.5 }}>No file matches “{filter}”.</div> : null}
          {rows.map((r) =>
            'dir' in r ? (
              <DirRow key={`d:${r.dir}`} dir={r.dir} count={r.count} folded={folded.has(r.dir)} onClick={() => toggleFold(r.dir)} />
            ) : (
              <FileRow
                key={r.file.path}
                file={r.file}
                active={r.file.path === activeDiff}
                isViewed={!!ch.viewed[r.file.path]}
                comments={ch.comments.filter((c) => c.path === r.file.path && !c.resolved).length}
                pendingComments={ch.comments.filter((c) => c.path === r.file.path && c.pending).length}
                picked={r.file.uncommitted && !commitScope && !ch.sync ? ch.pickState(r.file) : null}
                onPick={() => ch.toggleExcluded(r.file.path)}
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
        {ch.stashes.length ? (
          <div style={{ flex: 'none', borderTop: '1px solid var(--bd-1)', padding: '10px 8px 6px', display: 'flex', flexDirection: 'column', gap: 1, maxHeight: '25%', overflow: 'auto' }}>
            <div style={{ ...SECTION, margin: '0 6px 4px' }}>Stashed</div>
            {ch.stashes.map((s) => (
              <StashRow key={s.ref} s={s} onApply={(pop) => ch.applyStash(s, pop)} onDrop={() => ch.dropStash(s)} />
            ))}
          </div>
        ) : null}
        {ch.commits.length || uncommitted.length ? (
          <div style={{ flex: 'none', borderTop: '1px solid var(--bd-1)', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 1, font: '12px var(--font-mono)', color: 'var(--t3)', maxHeight: '35%', overflow: 'auto' }}>
            <div style={{ ...SECTION, margin: '0 6px 4px', display: 'flex' }}>
              <span style={{ flex: 1 }}>Commits</span>
              <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>click one for its changes</span>
            </div>
            {uncommitted.length ? (
              <CommitRow
                active={ch.scope === 'uncommitted'}
                onClick={() => ch.setScope(ch.scope === 'uncommitted' ? 'branch' : 'uncommitted')}
                mark={<span style={{ color: 'var(--c-amber)' }}>●</span>}
                text={`uncommitted · ${plural(uncommitted.length, 'file')}`}
                when="now"
              />
            ) : null}
            {ch.commits.map((c) => (
              <CommitRow
                key={c.hash}
                active={!!commitScope && (commitScope === c.hash || commitScope.startsWith(c.hash))}
                title={`${c.hash}\n${c.message}`}
                onClick={() => ch.setScope(commitScope && commitScope.startsWith(c.hash) ? 'branch' : { commit: c.hash })}
                mark={<span style={{ color: 'var(--c-blue)' }}>{c.hash.slice(0, 7)}</span>}
                text={c.message.split('\n')[0]}
                when={c.date ? timeAgo(new Date(c.date).getTime()) : ''}
              />
            ))}
          </div>
        ) : null}
      </div>
      {menu ? <Menu anchor={menu} items={fileMenu(menu.file)} onClose={() => setMenu(null)} /> : null}
    </>
  )
}

const KIND: Record<string, string> = {
  both: 'both changed',
  'deleted-ours': 'deleted on one side',
  'deleted-theirs': 'deleted on one side',
  'both-deleted': 'deleted on both'
}

/** A merge or rebase stopped on conflicts: its files to resolve, and going on or giving up. */
function SyncBox({ activeConflict }: { activeConflict?: string | null }): React.JSX.Element | null {
  const ch = useChanges()
  const s = ch.sync
  if (!s) return null
  const open = (path: string): void => wsOpen(ch.task.id, `conflict:${path}`)
  const prefix = s.dir ? `${s.dir}/` : ''
  const what = s.op === 'rebase' ? `Rebasing onto ${s.onto || ch.base}` : s.op === 'merge' ? `Merging ${s.onto || ch.base}` : 'Cherry-picking'
  const left = s.files.length
  return (
    <div style={{ margin: '0 10px 10px', border: `1px solid color-mix(in srgb, var(--c-${left ? 'red' : 'green'}) 45%, transparent)`, background: `color-mix(in srgb, var(--c-${left ? 'red' : 'green'}) 5%, transparent)`, borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ font: '500 12.5px var(--font-ui)', color: 'var(--t1)', flex: 1, minWidth: 0 }}>{what}</span>
        {s.step ? <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t3)' }}>commit {s.step[0]}/{s.step[1]}</span> : null}
      </div>
      {s.commit ? (
        <div title={s.commit} style={{ font: '11.5px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          at {s.commit}
        </div>
      ) : null}
      <div style={{ font: '12px var(--font-ui)', color: left ? 'var(--c-red)' : 'var(--c-green)' }}>
        {left ? `${plural(left, 'file')} to resolve` : `All resolved - continue the ${s.op}.`}
      </div>
      {s.files.map((f) => (
        <ConflictRow key={f.path} path={prefix + f.path} kind={KIND[f.kind]} active={activeConflict === prefix + f.path} onClick={() => open(prefix + f.path)} />
      ))}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button variant="primary" size="sm" disabled={!!left || ch.syncing} onClick={ch.continueSync} title={left ? 'Resolve every file first' : `Finish the ${s.op}`} style={{ flex: 1 }}>
          {ch.syncing ? 'Working…' : 'Continue'}
        </Button>
        {left && ch.task.agentKind ? (
          <Button size="sm" onClick={ch.askToResolve} title={`${ch.agent} resolves them; you continue`}>
            Ask {ch.agent}
          </Button>
        ) : null}
        <Button size="sm" tone="danger" disabled={ch.syncing} onClick={ch.abortSync} title="Back to how the branch was before">
          Abort
        </Button>
      </div>
    </div>
  )
}

function ConflictRow({ path, kind, active, onClick }: { path: string; kind: string; active: boolean; onClick: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      onClick={onClick}
      {...hoverProps}
      title={`${path} · ${kind}`}
      style={{ display: 'flex', alignItems: 'center', gap: 8, height: 24, padding: '0 6px', borderRadius: 4, cursor: 'pointer', font: '12px var(--font-mono)', background: active ? 'color-mix(in srgb, var(--c-red) 12%, transparent)' : hover ? 'var(--bg-menu)' : 'transparent' }}
    >
      <span style={{ color: 'var(--c-red)', width: 10 }}>!</span>
      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--t1)' }}>{path.split('/').pop()}</span>
      <span style={{ color: 'var(--t4)', fontSize: 11 }}>{kind}</span>
    </div>
  )
}

function DirRow({ dir, count, folded, onClick }: { dir: string; count: number; folded: boolean; onClick: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      onClick={onClick}
      {...hoverProps}
      title={folded ? 'Show its files' : 'Hide its files'}
      style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px', borderRadius: 4, cursor: 'pointer', font: '12px var(--font-mono)', color: 'var(--t3)', background: hover ? 'var(--bg-menu)' : 'transparent' }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" style={{ flex: 'none', transform: folded ? 'rotate(-90deg)' : 'none', transition: 'transform .12s', color: 'var(--t4)' }}>
        <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left' }}>
        <bdi>{dir}/</bdi>
      </span>
      {folded ? <span style={{ color: 'var(--t4)' }}>{count}</span> : null}
    </div>
  )
}

/** A stash: what it is, and bringing it back (applying keeps it; Restore drops it after) or deleting it. */
function StashRow({ s, onApply, onDrop }: { s: StashEntry; onApply: (pop: boolean) => void; onDrop: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const link = (label: string, title: string, on: () => void, danger = false): React.JSX.Element => (
    <span
      onClick={(e) => {
        e.stopPropagation()
        on()
      }}
      title={title}
      style={{ color: danger ? 'var(--c-red)' : 'var(--c-blue)', cursor: 'pointer' }}
    >
      {label}
    </span>
  )
  return (
    <div
      {...hoverProps}
      title={`${s.message}\n${s.files.join('\n')}`}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px', borderRadius: 4, font: '12px var(--font-mono)', whiteSpace: 'nowrap', background: hover ? 'var(--bg-menu)' : 'transparent' }}
    >
      <span style={{ color: 'var(--c-amber)' }}>⧉</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--t2)', fontFamily: 'var(--font-ui)' }}>{s.message}</span>
      {hover ? (
        <span style={{ display: 'flex', gap: 8, fontSize: 11.5 }}>
          {link('restore', 'Bring the changes back and delete the stash', () => onApply(true))}
          {link('apply', 'Bring the changes back and keep the stash', () => onApply(false))}
          {link('×', 'Delete the stash', onDrop, true)}
        </span>
      ) : (
        <span style={{ color: 'var(--t4)' }}>
          {plural(s.files.length, 'file')} · {timeAgo(s.at)}
        </span>
      )}
    </div>
  )
}

function CommitRow({ active, title, onClick, mark, text, when }: { active: boolean; title?: string; onClick: () => void; mark: React.ReactNode; text: string; when: string }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      onClick={onClick}
      {...hoverProps}
      title={title}
      style={{
        display: 'flex',
        gap: 10,
        whiteSpace: 'nowrap',
        padding: '3px 6px',
        borderRadius: 4,
        cursor: 'pointer',
        background: active ? 'color-mix(in srgb, var(--c-blue) 12%, transparent)' : hover ? 'var(--bg-menu)' : 'transparent'
      }}
    >
      {mark}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: active ? 'var(--t1)' : 'var(--t2)', fontFamily: 'var(--font-ui)' }}>{text}</span>
      <span style={{ color: 'var(--t4)' }}>{when}</span>
    </div>
  )
}

function FileRow({
  file,
  active,
  isViewed,
  comments,
  pendingComments,
  picked,
  onPick,
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
  /** In the next commit or not (null: not an uncommitted file). */
  picked: 'all' | 'some' | 'none' | null
  onPick: () => void
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
  onDiscard?: () => void
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const name = file.path.split('/').pop()
  const s = file.oldPath ? 'R' : file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'
  const moved = file.oldPath ? (file.oldPath.split('/').slice(0, -1).join('/') === file.path.split('/').slice(0, -1).join('/') ? file.oldPath.split('/').pop() : file.oldPath) : null
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => setDrag(null)}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...hoverProps}
      title={`${file.oldPath ? `${file.oldPath} → ` : ''}${file.path}${file.uncommitted ? ' · has uncommitted changes' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 26,
        padding: '0 8px 0 4px',
        borderRadius: 4,
        cursor: 'pointer',
        font: '12px var(--font-mono)',
        background: active ? 'color-mix(in srgb, var(--c-blue) 10%, transparent)' : hover ? 'var(--bg-menu)' : 'transparent'
      }}
    >
      <span style={{ width: 14, flex: 'none', display: 'flex', justifyContent: 'center' }}>
        {picked != null ? (
          <input
            type="checkbox"
            checked={picked !== 'none'}
            ref={(el) => {
              if (el) el.indeterminate = picked === 'some'
            }}
            title={picked === 'all' ? 'In the next commit - untick to leave it out' : picked === 'some' ? 'Some of its lines are in the next commit - tick for all of it' : 'Left out of the next commit'}
            onClick={(e) => e.stopPropagation()}
            onChange={onPick}
            style={{ margin: 0, width: 12, height: 12, accentColor: 'var(--c-amber)', cursor: 'pointer', opacity: picked === 'all' && !hover ? 0.55 : 1 }}
          />
        ) : null}
      </span>
      <span style={{ width: 10, flex: 'none', color: s === 'A' ? 'var(--c-green)' : s === 'D' ? 'var(--c-red)' : s === 'R' ? 'var(--c-blue)' : 'var(--c-amber)' }}>{s}</span>
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
        {moved ? <span style={{ color: 'var(--t4)' }}> ← {moved}</span> : null}
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
          {file.binary ? (
            <span style={{ color: 'var(--t4)' }}>bin</span>
          ) : file.oldPath && !file.added && !file.deleted ? null : (
            <>
              <span style={{ color: 'var(--c-green)' }}>+{file.added}</span>
              <span style={{ color: 'var(--c-red)', minWidth: 24, textAlign: 'right' }}>{file.deleted ? `−${file.deleted}` : ''}</span>
            </>
          )}
        </>
      )}
      <span style={{ width: 12, textAlign: 'center', color: 'var(--c-green)' }}>{isViewed ? '✓' : ''}</span>
    </div>
  )
}
