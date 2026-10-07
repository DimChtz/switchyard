import React, { useEffect, useMemo, useRef, useState } from 'react'
import { plural } from '../lib/summary'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { clock, statusColor, statusLabel, timeAgo, wakeAt, TEST_COLOR, TEST_LABEL } from '../lib/status'
import { AGENTS, COLUMN_LABEL } from '@shared/constants'
import { agentShort, busyAgents, queuedTasks } from '../lib/derive'
import { useRealDiffStats } from '../lib/realGit'
import type { BoardColumn, PrDetails, Prefs, Project, RemoteInfo, Task } from '@shared/types'
import type { BadgeTone } from '@shared/plugins'
import { useTaskBadges } from '../lib/plugins'
import { Button, Menu, TipNote, TipTitle, Tooltip, confirm, useContextMenu, type MenuAnchor, type MenuItem } from '../components/ui'
import { taskMenuItems } from '../lib/menus'
import { reviewReady } from '../lib/taskActions'
import { finishTask } from '../lib/finishTask'
import { criteriaDone } from '../lib/criteria'
import { keyLabel } from '../lib/keys'
import { shortcut } from '../lib/shortcuts'
import { prefsFor } from '../lib/projectPrefs'
import { inProject, isMulti, reposOf } from '../lib/multiRepo'
import { isStarted } from '@shared/scratch'
import { cardShow, columnName, inColumnSince, isStale, sortColumn, visibleColumns, wipLimit } from '../lib/boardPrefs'
import {
  BUILTIN_VIEWS,
  boardFilterOf,
  boardGroupOf,
  filterCount,
  isFiltering,
  lanesOf,
  matchesFilter,
  pinnedFirst,
  setBoardOrder,
  statusOf,
  viewOf,
  type BoardFilter,
  type BoardGroup,
  type BoardStatus,
  type BoardView,
  type Lane
} from '../lib/boardFilter'
import { useUsage } from '../lib/usage'
import { formatCost, sumUsage } from '@shared/usage'
import { conflictLabel, conflictsOf, useConflicts } from '../lib/conflicts'
import { plainText } from '../lib/noteText'
import { OutsideStrip } from '../components/OutsideWork'
import { BaseStrip } from '../components/BaseStrip'
import { TrustStrip } from '../components/TrustStrip'
import { prSummary } from '@shared/pr'
import { baseFor, parentFinished, parentOf, waitsFor } from '@shared/stack'

function Card({ task, focused, cost }: { task: Task; focused: boolean; cost: number }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [hover, hoverProps] = useHover()
  const realStats = useRealDiffStats([task], state.projects)[task.id]
  // Another running task changes the same files (or its base moved under it).
  const clash = conflictLabel(conflictsOf(useConflicts(), task.id), state.tasks, baseFor(task, state.projects.find((p) => p.id === task.projectId) ?? { id: task.projectId }, state.tasks))
  const active = task.agentKind && task.st !== null && task.st !== 'done'
  // Settings → Board: how much a card shows, and when it's gone stale.
  const bp = prefsFor(state, task.projectId)
  const show = cardShow(bp)
  const compact = bp.cardDensity === 'compact'
  const stale = isStale(task, bp.boardStaleDays)
  const since = timeAgo(inColumnSince(task))

  const ring = focused ? 'color-mix(in srgb, var(--c-blue) 70%, transparent)' : hover ? 'var(--bd-5)' : stale ? 'color-mix(in srgb, var(--c-amber) 45%, transparent)' : 'var(--bd-2)'
  const bg = focused ? 'var(--bg-panel-2)' : 'var(--bg-panel)'

  const parent = parentOf(task, state.tasks)
  const queue = task.queued ? queuedTasks(state.tasks) : []
  const queuePos = task.queued ? queue.findIndex((t) => t.id === task.id) + 1 : 0
  const note =
    task.col === 'done'
      ? null
      : task.sleeping
        ? {
            text: task.sleeping.until ? `Usage limit · sleeps until ${clock(task.sleeping.until)}` : `Usage limit · tries again at ${clock(wakeAt(task.sleeping))}`,
            color: 'var(--c-blue)',
            bg: 'color-mix(in srgb, var(--c-blue) 8%, transparent)'
          }
      : task.queued
        ? {
            text: parent && !parentFinished(task, state.tasks)
              ? `Queued · ${agentShort(task.queued.agentKind)} starts when ${parent.key} is in Review`
              : `Queued ${queuePos} of ${queue.length} · ${agentShort(task.queued.agentKind)}${
                  state.prefs.maxAgents ? ` · ${busyAgents(state.tasks)}/${state.prefs.maxAgents} working` : ''
                }`,
            color: 'var(--c-blue)',
            bg: 'color-mix(in srgb, var(--c-blue) 8%, transparent)'
          }
      : task.st === 'waiting'
        ? {
            text:
              task.askKind === 'permission'
                ? `Asks: ${task.ask ?? 'approval needed'}`
                : task.ask
                  ? `Asks: ${task.ask}`
                  : task.activity
                    ? `Finished its turn: ${task.activity}`
                    : 'Finished its turn - your move',
            color: 'var(--c-amber)',
            bg: 'color-mix(in srgb, var(--c-amber) 8%, transparent)'
          }
        : task.st === 'failed'
          ? { text: `${task.ask ?? 'Exited with an error'} · ${timeAgo(task.lastActivityAt)} ago`, color: 'var(--c-red)', bg: 'color-mix(in srgb, var(--c-red) 8%, transparent)' }
          : task.st === 'paused'
            ? { text: 'Paused · worktree kept', color: 'var(--t2)', bg: 'color-mix(in srgb, var(--ov) 4%, transparent)' }
            : null

  const showStart = (task.col === 'backlog' || task.col === 'ready') && focused
  const showOpen = !!task.worktreePath && task.col !== 'done' && focused

  // Description: its start, as plain text, until an agent picks the task up
  // (then the card shows what the agent is doing). It's written in the task
  // sheet. Done cards show the merge note in the same slot.
  const started = !!(task.st && isStarted(task) && task.col !== 'done')
  const editable = !started && task.col !== 'done'
  const teaser = task.col === 'done' ? (task.doneNote ?? '') : started ? '' : plainText(task.desc ?? '')
  const addHint = editable && focused && !teaser
  // (A compact card: no description - it's in the task sheet.)
  const showDesc = !compact && (!!teaser || addHint)
  const [descHover, descHoverProps] = useHover()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const project = state.projects.find((p) => p.id === task.projectId)
  const openSheet = (): void => dispatch({ type: 'OPEN_TASK_SHEET', taskId: task.id })

  const menuItems = taskMenuItems(task, project, prefsFor(state, task.projectId), dispatch, {
    projects: state.projects,
    rename: () => setRenaming(task.title),
    editDesc: openSheet
  })

  // A click on the description opens the sheet - unless it's the first of a double-click (which opens the task).
  const sheetTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(sheetTimer.current), [])
  const clickDesc = (e: React.MouseEvent): void => {
    if (!editable) return
    e.stopPropagation()
    dispatch({ type: 'SET_BOARD_FOCUS', id: task.id })
    clearTimeout(sheetTimer.current)
    if (e.detail === 1) sheetTimer.current = setTimeout(openSheet, 260)
  }

  return (
    <div
      draggable={renaming === null}
      data-card-id={task.id}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id)
      }}
      onClick={() => dispatch({ type: 'SET_BOARD_FOCUS', id: task.id })}
      onContextMenu={(e) => {
        e.preventDefault()
        dispatch({ type: 'SET_BOARD_FOCUS', id: task.id })
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      onDoubleClick={() => {
        // Its first click may have been on the description: that's not opening the sheet.
        clearTimeout(sheetTimer.current)
        if (task.worktreePath) dispatch({ type: 'OPEN_TASK', taskId: task.id })
        else if (task.col === 'backlog' || task.col === 'ready') dispatch({ type: 'OPEN_START_MODAL', taskId: task.id })
      }}
      {...hoverProps}
      style={{
        background: bg,
        border: `1px solid ${ring}`,
        borderRadius: 6,
        padding: '11px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        cursor: 'pointer',
        flex: 'none'
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        {renaming !== null ? (
          <input
            autoFocus
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => {
              dispatch({ type: 'RENAME_TASK', taskId: task.id, title: renaming })
              setRenaming(null)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(null)
            }}
            style={{ flex: 1, minWidth: 0, font: '500 13px/1.35 var(--font-ui)', color: 'var(--t1)', background: 'var(--bg-panel-3)', border: '1px solid color-mix(in srgb, var(--c-blue) 60%, transparent)', borderRadius: 4, padding: '2px 5px', outline: 'none' }}
          />
        ) : (
          <span style={{ font: "500 13px/1.35 var(--font-ui)", color: 'var(--t1)', flex: 1 }}>
            {task.pinnedAt ? <PinMark onUnpin={() => dispatch({ type: 'PIN_TASK', taskId: task.id, pinned: false })} /> : null}
            {task.title}
          </span>
        )}
        {task.issue ? (
          <span
            onClick={(e) => {
              e.stopPropagation()
              window.api.sys.openExternal(task.issue!.url)
            }}
            title={`GitHub issue #${task.issue.number}`}
            style={{ font: "11px var(--font-mono)", color: 'var(--c-blue)', cursor: 'pointer' }}
          >
            #{task.issue.number}
          </span>
        ) : null}
        {show.pr && task.prDetails && task.pr?.state === 'OPEN' ? <PrChip task={task} /> : null}
        {(show.age && !compact) || stale ? (
          <span title={`In ${columnName(bp, task.col)} for ${since}${stale ? ` - stale (Settings → Board: after ${bp.boardStaleDays} day${bp.boardStaleDays === 1 ? '' : 's'})` : ''}`} style={{ font: '11px var(--font-mono)', color: stale ? 'var(--c-amber)' : 'var(--t4)', whiteSpace: 'nowrap' }}>
            {stale ? '◷ ' : ''}
            {since}
          </span>
        ) : null}
        {show.cost && cost > 0 ? (
          <span title="Agent spend on this task, at API prices (Usage)" style={{ font: '11px var(--font-mono)', color: 'var(--t3)' }}>
            {formatCost(cost)}
          </span>
        ) : null}
        {task.criteria?.length ? (
          <span
            title="Acceptance criteria verified"
            style={{ font: '11px var(--font-mono)', color: criteriaDone(task).passed === task.criteria.length ? 'var(--c-green)' : criteriaDone(task).failed ? 'var(--c-red)' : 'var(--t3)' }}
          >
            ✓{criteriaDone(task).passed}/{task.criteria.length}
          </span>
        ) : null}
        <span style={{ font: "11px var(--font-mono)", color: 'var(--t4)' }}>{task.key}</span>
      </div>
      <PluginBadges taskId={task.id} />
      {parent && task.col !== 'done' ? <BuildsOn task={task} parent={parent} /> : null}
      {isMulti(task) ? (
        <div title="One task, one branch, a worktree in each repo" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: -3 }}>
          {reposOf(task).map((id) => {
            const here = id === state.projectId
            return (
              <span
                key={id}
                style={{
                  height: 18,
                  padding: '0 6px',
                  borderRadius: 3,
                  display: 'flex',
                  alignItems: 'center',
                  font: "10.5px var(--font-mono)",
                  color: here ? 'var(--t1)' : 'var(--t-icon)',
                  background: 'var(--bd-row)',
                  border: `1px solid ${here ? 'var(--bd-5)' : 'var(--bd-2)'}`,
                  boxSizing: 'border-box'
                }}
              >
                {state.projects.find((p) => p.id === id)?.name ?? id}
              </span>
            )
          })}
        </div>
      ) : null}
      {showDesc ? (
        <div
          onClick={clickDesc}
          title={editable ? 'Open the task to edit it' : undefined}
          {...descHoverProps}
          style={{
            font: '12px/1.45 var(--font-ui)',
            color: addHint ? 'var(--t4)' : 'var(--t-dim)',
            textWrap: 'pretty',
            overflowWrap: 'anywhere',
            // Its start: the whole of it is in the task sheet.
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            margin: '-3px -6px',
            padding: '3px 6px',
            borderRadius: 4,
            cursor: 'pointer',
            background: descHover && editable ? 'var(--bg-hover)' : 'transparent'
          }}
        >
          {teaser || '+ Add description'}
        </div>
      ) : null}
      {active ? (
        <div style={{ marginLeft: 3, borderLeft: '1px solid var(--bd-4)', paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, font: '12px var(--font-ui)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(task.st) }} />
            <span style={{ color: 'var(--t1)' }}>{agentShort(task.agentKind)}</span>
            <span style={{ color: statusColor(task.st) }}>{statusLabel(task)}</span>
          </div>
          {/* What a detailed card shows (Settings → Board); a compact one only the agent and its status. */}
          {!compact && show.branch && (task.branch || task.inPlace) ? (
            <div
              style={{
                font: "11.5px var(--font-mono)",
                color: 'var(--t2)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {task.branch ?? '⌂ project folder'}
            </div>
          ) : null}
          {!compact && show.activity && task.st === 'working' && task.activity ? (
            <div style={{ font: '12px var(--font-ui)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={task.activity}>
              {task.activity}
            </div>
          ) : null}
          {!compact && (show.diff || task.lastTest) ? (
            <div style={{ display: 'flex', gap: 8, font: "11.5px var(--font-mono)", color: 'var(--t3)' }}>
              {show.diff ? (
                <>
                  <span>{realStats ? realStats.files : '…'} files</span>
                  <span style={{ color: 'var(--c-green)' }}>+{realStats ? realStats.added : 0}</span>
                  <span style={{ color: 'var(--c-red)' }}>-{realStats ? realStats.deleted : 0}</span>
                </>
              ) : null}
              <span style={{ flex: 1 }} />
              {task.lastTest ? <span style={{ color: TEST_COLOR[task.lastTest.status] }}>{TEST_LABEL[task.lastTest.status]}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {clash && task.col !== 'done' ? (
        <div
          title={clash.hard ? 'Its changes won’t merge cleanly - open the task to see where' : 'Another running task changes the same files - the edits still merge'}
          style={{ display: 'flex', alignItems: 'center', gap: 6, font: '11.5px var(--font-mono)', color: clash.hard ? 'var(--c-red)' : 'var(--c-amber)' }}
        >
          <span>{clash.hard ? '⚠' : '⇄'}</span>
          {clash.text}
        </div>
      ) : null}
      {note ? (
        <div
          style={{
            font: '12px/1.4 var(--font-ui)',
            color: note.color,
            background: note.bg,
            borderRadius: 4,
            padding: '6px 8px',
            textWrap: 'pretty'
          }}
        >
          {note.text}
        </div>
      ) : null}
      {showStart ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button
            variant="primary"
            size="xs"
            hint={shortcut('start-task')}
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'OPEN_START_MODAL', taskId: task.id })
            }}
          >
            Start with agent
          </Button>
          <span
            style={{
              font: "11px var(--font-mono)",
              color: 'var(--t4)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0
            }}
          >
            or drag → In Progress
          </span>
        </div>
      ) : null}
      {showOpen ? (
        <div style={{ display: 'flex', gap: 12, font: "11.5px var(--font-mono)", color: 'var(--c-blue)' }}>
          <span
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'OPEN_TASK', taskId: task.id })
            }}
          >
            ↵ open workspace
          </span>
        </div>
      ) : null}
      {menu ? <Menu anchor={menu} items={menuItems} onClose={() => setMenu(null)} /> : null}
    </div>
  )
}

const BADGE_COLOR: Record<BadgeTone, string> = {
  info: 'var(--c-blue)',
  success: 'var(--c-green)',
  warn: 'var(--c-amber)',
  danger: 'var(--c-red)',
  muted: 'var(--t3)'
}

/** What plugins say about the task (Settings → Plugins). */
function PluginBadges({ taskId }: { taskId: string }): React.JSX.Element | null {
  const badges = useTaskBadges(taskId)
  if (!badges.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: -3 }}>
      {badges.map(({ plugin, badge }, i) => {
        const c = BADGE_COLOR[badge.tone ?? 'info']
        return (
          <span
            key={i}
            title={badge.tooltip ? `${badge.tooltip}\n(${plugin})` : plugin}
            style={{
              font: '10.5px var(--font-mono)',
              color: c,
              border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
              background: `color-mix(in srgb, ${c} 9%, transparent)`,
              borderRadius: 4,
              padding: '0 5px',
              lineHeight: '16px',
              whiteSpace: 'nowrap'
            }}
          >
            {badge.text}
          </span>
        )
      })}
    </div>
  )
}

/** A pinned card's pin, before its title: clicking it unpins. */
function PinMark({ onUnpin }: { onUnpin: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <span
      title="Pinned to the top - click to unpin"
      onClick={(e) => {
        e.stopPropagation()
        onUnpin()
      }}
      {...hoverProps}
      style={{ display: 'inline-flex', verticalAlign: '-1px', marginRight: 6, color: hover ? 'var(--t1)' : 'var(--c-amber)', cursor: 'pointer' }}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
        <path d="M4 1.5h4L7.4 5l2 1.8H2.6l2-1.8L4 1.5Z" />
        <path d="M6 6.8V10.8" fill="none" strokeLinecap="round" strokeWidth="1.3" />
      </svg>
    </span>
  )
}

/** The card's pull request, as GitHub has it: checks failing / running / passing, review. */
function PrChip({ task }: { task: Task }): React.JSX.Element {
  const d = task.prDetails!
  const s = prSummary(d)
  const color = s.tone === 'fail' ? 'var(--c-red)' : s.tone === 'pending' ? 'var(--c-amber)' : s.tone === 'pass' ? 'var(--c-green)' : 'var(--t3)'
  const mark = s.tone === 'fail' ? '✕' : s.tone === 'pending' ? '●' : s.tone === 'pass' ? '✓' : ''
  return (
    <Tooltip content={<PrTip d={d} />} maxWidth={320}>
      <span
        onClick={(e) => {
          e.stopPropagation()
          window.api.sys.openExternal(`${d.url}/checks`)
        }}
        style={{ font: '11px var(--font-mono)', color, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        #{d.number} {mark}
      </span>
    </Tooltip>
  )
}

const CHECK_LOOK: Record<string, [string, string]> = {
  fail: ['✕', 'var(--c-red)'],
  pending: ['●', 'var(--c-amber)'],
  pass: ['✓', 'var(--c-green)'],
  skipped: ['–', 'var(--t4)']
}

/** The chip's tooltip: each check, the review, and how many comments. */
function PrTip({ d }: { d: PrDetails }): React.JSX.Element {
  const s = prSummary(d)
  // Failing first, then running, then the rest.
  const order = { fail: 0, pending: 1, pass: 2, skipped: 3 }
  const checks = d.checks.slice().sort((a, b) => order[a.state] - order[b.state])
  const review = d.reviewDecision === 'CHANGES_REQUESTED' ? ['changes requested', 'var(--c-red)'] : d.reviewDecision === 'APPROVED' ? ['approved', 'var(--c-green)'] : d.reviewDecision === 'REVIEW_REQUIRED' ? ['review required', 'var(--t2)'] : null
  return (
    <div style={{ whiteSpace: 'normal' }}>
      <TipTitle>
        Pull request #{d.number} · {s.text}
      </TipTitle>
      {checks.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {checks.slice(0, 8).map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ color: CHECK_LOOK[c.state][1], width: 10, flex: 'none', textAlign: 'center' }}>{CHECK_LOOK[c.state][0]}</span>
              <span style={{ color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
            </div>
          ))}
          {checks.length > 8 ? <div style={{ color: 'var(--t4)', marginLeft: 18 }}>+{checks.length - 8} more</div> : null}
        </div>
      ) : null}
      {review || d.comments.length ? (
        <div style={{ marginTop: checks.length ? 6 : 0, color: 'var(--t3)' }}>
          {review ? <span style={{ color: review[1] }}>{review[0]}</span> : null}
          {review && d.comments.length ? ' · ' : ''}
          {d.comments.length ? `${d.comments.length} comment${d.comments.length > 1 ? 's' : ''}` : ''}
        </div>
      ) : null}
      <TipNote>Click to open the checks on GitHub · checked {timeAgo(d.at)} ago</TipNote>
    </div>
  )
}

/** A column's title, its count, and its action ("queue all", "archive"). */
function ColumnHead({ col, all, shown, filtering }: { col: BoardColumn; all: Task[]; shown: Task[]; filtering: boolean }): React.JSX.Element {
  const { state, dispatch } = useAppStore()

  const clearDone = async (): Promise<void> => {
    const ok = await confirm({
      title: `Archive ${all.length} finished task${all.length > 1 ? 's' : ''}?`,
      body: 'They leave the board and go to the archive, where you can search them and bring them back.',
      confirmLabel: 'Archive'
    })
    if (ok) dispatch({ type: 'CLEAR_DONE', projectId: state.projectId!, count: all.length })
  }
  const archived = col === 'done' ? state.tasks.filter((t) => t.projectId === state.projectId && t.archivedAt).length : 0
  const openArchive = (): void => dispatch({ type: 'OPEN_ARCHIVE', projectId: state.projectId })

  // The column's own actions take all its tasks, filtered out or not.
  const queueable = all.filter((t) => !t.queued && !t.worktreePath)
  const ctx = useContextMenu(() =>
    col === 'backlog'
      ? [{ label: 'New task', shortcut: shortcut('new-task'), onClick: () => dispatch({ type: 'BEGIN_ADD_TASK' }) }]
      : col === 'ready'
        ? [
            {
              label: state.prefs.maxAgents ? `Queue all ${queueable.length}` : `Start all ${queueable.length} in background`,
              disabled: !queueable.length,
              onClick: () => dispatch({ type: 'QUEUE_TASKS', taskIds: queueable.map((t) => t.id) })
            }
          ]
        : col === 'done'
          ? [
              { label: `Archive ${all.length} finished…`, disabled: !all.length, onClick: clearDone },
              { label: `Open the archive${archived ? ` (${archived})` : ''}`, onClick: openArchive }
            ]
          : [{ label: 'Project settings', shortcut: shortcut('project-settings'), onClick: () => dispatch({ type: 'OPEN_SETTINGS', section: `project:${state.projectId}` }) }]
  )

  const hint =
    col === 'progress'
      ? 'drop to start'
      : col === 'done'
        ? prefsFor(state, state.projectId).pruneAfterMerge
          ? 'merges + prunes'
          : 'merges'
        : plural(shown.filter((t) => t.agentKind).length, 'agent')

  // Settings → Board: its name, its card limit, Done's length.
  const bp = prefsFor(state, state.projectId)
  const limit = wipLimit(bp, col)
  const limitColor = !limit ? 'var(--t4)' : all.length > limit ? 'var(--c-red)' : all.length === limit ? 'var(--c-amber)' : 'var(--t4)'
  const cut = col === 'done' && bp.doneShown > 0 && all.length > bp.doneShown

  return (
    <div onContextMenu={ctx.onContextMenu} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 24, padding: '0 4px', flex: 'none', minWidth: 0 }}>
      {ctx.menu}
      <span title={columnName(bp, col) !== COLUMN_LABEL[col] ? `${COLUMN_LABEL[col]} (renamed in Settings → Board)` : undefined} style={{ font: '500 12.5px var(--font-ui)', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
        {columnName(bp, col)}
      </span>
      <span title={limit ? `At most ${limit} here (Settings → Board)${bp.wipBlock ? ' - moves past it are refused' : ''}` : cut ? `The latest ${bp.doneShown} of ${all.length} show (Settings → Board)` : undefined} style={{ font: "12px var(--font-mono)", color: limitColor, whiteSpace: 'nowrap' }}>
        {filtering ? `${shown.length}/${all.length}` : all.length}
        {limit ? `/${limit}` : ''}
        {cut ? ` · latest ${bp.doneShown}` : ''}
      </span>
      <span style={{ flex: 1 }} />
      {col === 'ready' && queueable.length ? (
        <span
          onClick={() => dispatch({ type: 'QUEUE_TASKS', taskIds: queueable.map((t) => t.id) })}
          title="Start them one after another, as agent slots free up (Settings → Agents)"
          style={{ font: "11px var(--font-mono)", color: 'var(--t3)', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          queue all
        </span>
      ) : col === 'done' && (all.length > 0 || archived > 0) ? (
        <span style={{ display: 'flex', gap: 10, font: "11px var(--font-mono)", color: 'var(--t4)' }}>
          {all.length ? (
            <span onClick={clearDone} title="Move the finished tasks to the archive" style={{ cursor: 'pointer' }}>
              archive
            </span>
          ) : null}
          {archived ? (
            <span onClick={openArchive} title="Finished tasks you archived - search them, bring them back" style={{ cursor: 'pointer' }}>
              {archived} archived
            </span>
          ) : null}
        </span>
      ) : (
        <span style={{ font: "11px var(--font-mono)", color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hint}</span>
      )}
    </div>
  )
}

/**
 * Where a column's cards are, and where cards are dropped into it: the
 * whole column (with its head) on a plain board, a lane's part of it with lanes.
 */
function ColumnCell({
  col,
  tasks,
  costs,
  head,
  adding,
  lanes
}: {
  col: BoardColumn
  tasks: Task[]
  costs: Map<string, number>
  head?: React.ReactNode
  /** The new-task input goes here. */
  adding?: boolean
  /** In a lane: no scrolling of its own (the board scrolls), and a floor to drop onto. */
  lanes?: boolean
}): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [dragOver, setDragOver] = useState(false)
  // Where a dragged card would land: in front of this card, or at the end ('end').
  const [dropAt, setDropAt] = useState<string | null>(null)
  const bp = prefsFor(state, state.projectId)
  // Ordered by hand (Settings → Board): a drop line shows where a card lands.
  const manual = bp.columnSort === 'manual'
  const listRef = useRef<HTMLDivElement>(null)
  const placeAt = (y: number): string => {
    const cards = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-card-id]') ?? [])]
    const next = cards.find((c) => {
      const r = c.getBoundingClientRect()
      return y < r.top + r.height / 2
    })
    return next?.dataset.cardId ?? 'end'
  }

  // Dropping a started task on Done really finishes it: merged (or through
  // its pull request). Leftover changes need a decision first.
  const finishFromBoard = async (task: Task, project: Project): Promise<void> => {
    await finishTask(task, project, prefsFor(state, project.id), dispatch, state.projects)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
        const at = placeAt(e.clientY)
        if (at !== dropAt) setDropAt(at)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDragOver(false)
        setDropAt(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        setDropAt(null)
        const id = e.dataTransfer.getData('text/plain')
        const task = state.tasks.find((t) => t.id === id)
        if (!task) return
        const at = placeAt(e.clientY)
        const before = at === 'end' ? null : at
        // Within its column: a new place, nothing else (a column sorted by something keeps its order).
        if (task.col === col) {
          if (!manual) dispatch({ type: 'TOAST', text: `${columnName(bp, col)} is sorted by ${SORT_LABEL[bp.columnSort]} - set "As dragged" in Settings → Board to order it by hand.` })
          else if (before !== id) dispatch({ type: 'MOVE_TASK', id, col, before })
          return
        }
        if (col === 'progress' && !isStarted(task)) {
          // Settings → Board: the Start dialog, or straight away with the defaults (as "Start in background").
          if (bp.dropToProgress === 'start' && !task.worktreePath) dispatch({ type: 'QUEUE_TASKS', taskIds: [id] })
          else dispatch({ type: 'OPEN_START_MODAL', taskId: id })
        } else if (col === 'done' && task.col !== 'done') {
          // Settings → Board: asked first.
          const sure = bp.confirmDone ? confirm({ title: `Move ${task.key} to ${columnName(bp, 'done')}?`, body: task.title, confirmLabel: `Move to ${columnName(bp, 'done')}` }) : Promise.resolve(true)
          const project = state.projects.find((p) => p.id === task.projectId)
          sure.then((ok) => {
            if (!ok) return
            if (task.worktreePath) {
              if (project) finishFromBoard(task, project)
            } else dispatch({ type: 'MOVE_TASK', id, col, before })
          })
        } else if (col === 'review' && task.col !== 'review') {
          reviewReady(task).then((ok) => ok && dispatch({ type: 'MOVE_TASK', id, col, before }))
        } else {
          dispatch({ type: 'MOVE_TASK', id, col, before })
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
        minHeight: lanes ? 44 : 0,
        borderRadius: 8,
        padding: 4,
        background: dragOver ? 'color-mix(in srgb, var(--c-blue) 5%, transparent)' : 'transparent',
        boxShadow: dragOver ? 'inset 0 0 0 1px color-mix(in srgb, var(--c-blue) 40%, transparent)' : 'inset 0 0 0 1px transparent'
      }}
    >
      {head}
      <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: lanes ? 'visible' : 'auto', minHeight: 0, flex: 1 }}>
        {adding ? <AddTaskInput /> : null}
        {tasks.map((t) => (
          <React.Fragment key={t.id}>
            {manual && dropAt === t.id ? <DropLine /> : null}
            <Card task={t} focused={state.boardFocus === t.id} cost={costs.get(t.id) ?? 0} />
          </React.Fragment>
        ))}
        {manual && dropAt === 'end' && tasks.length ? <DropLine /> : null}
      </div>
    </div>
  )
}

const SORT_LABEL: Record<Prefs['columnSort'], string> = { manual: 'hand', newest: 'newest first', activity: 'latest activity', needs: 'what needs you' }

/** Where a dragged card lands. (Negative margins: the column's gap doesn't grow while dragging.) */
function DropLine(): React.JSX.Element {
  return <div style={{ height: 2, margin: '-5px 2px -5px', borderRadius: 1, background: 'var(--c-blue)', flex: 'none' }} />
}

/** A lane's title row: fold it, and what its cards are doing. */
function LaneHead({ lane, folded, onToggle }: { lane: Lane; folded: boolean; onToggle: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const count = (s: BoardStatus): number => lane.tasks.filter((t) => t.col !== 'done' && statusOf(t) === s).length
  const parts = ([
    ['working', count('working'), 'var(--c-green)'],
    ['need you', count('needs'), 'var(--c-amber)'],
    ['queued', count('queued'), 'var(--c-blue)']
  ] as [string, number, string][]).filter(([, n]) => n)
  return (
    <div
      onClick={onToggle}
      {...hoverProps}
      title={folded ? 'Show this lane' : 'Fold this lane'}
      style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 8px', margin: '0 4px', cursor: 'pointer', borderRadius: 5, background: hover ? 'var(--bg-hover)' : 'transparent', userSelect: 'none' }}
    >
      <span style={{ width: 10, color: 'var(--t4)', font: '10px var(--font-mono)', transform: folded ? 'none' : 'rotate(90deg)', transition: 'transform .12s' }}>▶</span>
      <span style={{ font: '500 12.5px var(--font-ui)', color: 'var(--t1)' }}>{lane.label}</span>
      <span style={{ font: '12px var(--font-mono)', color: 'var(--t4)' }}>{lane.tasks.length}</span>
      {parts.map(([label, n, color]) => (
        <span key={label} style={{ font: '11.5px var(--font-mono)', color }}>
          {n} {label}
        </span>
      ))}
      <span style={{ flex: 1, height: 1, background: 'var(--bd-1)', marginLeft: 6 }} />
    </div>
  )
}

/** "↳ on SYT-9": the task this one builds on - a click finds its card. */
function BuildsOn({ task, parent }: { task: Task; parent: Task }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [hover, hoverProps] = useHover()
  const waiting = !!waitsFor(task, state.tasks)
  const merged = parent.col === 'done'
  return (
    <div
      title={
        merged
          ? `${parent.key} is merged - ${task.key} now compares with the default branch`
          : waiting
            ? `${task.key} starts from ${parent.key}'s branch, once ${parent.key} has one`
            : `${task.key}'s branch starts from ${parent.branch ?? parent.key}, and compares with it until ${parent.key} is merged`
      }
      style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: -3, font: '11.5px var(--font-mono)', color: waiting ? 'var(--c-amber)' : 'var(--t3)', minWidth: 0 }}
    >
      <span style={{ flex: 'none' }}>↳</span>
      <span style={{ flex: 'none' }}>{waiting ? 'after' : merged ? 'built on' : 'on'}</span>
      <span
        onClick={(e) => {
          e.stopPropagation()
          dispatch({ type: 'SET_BOARD_FOCUS', id: parent.id })
        }}
        {...hoverProps}
        style={{ color: 'var(--c-blue)', cursor: 'pointer', textDecoration: hover ? 'underline' : 'none', textUnderlineOffset: 3, flex: 'none' }}
      >
        {parent.key}
      </span>
      <span style={{ fontFamily: 'var(--font-ui)', color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{parent.title}</span>
    </div>
  )
}

function AddTaskInput(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const after = state.tasks.find((t) => t.id === state.newTaskAfter)
  return (
    <input
      autoFocus
      value={state.newTaskTitle}
      onChange={(e) => dispatch({ type: 'SET_NEW_TASK_TITLE', title: e.target.value })}
      onKeyDown={(e) => {
        // Keep ↵/esc from also reaching the global board shortcuts - ↵ there
        // would open the Start modal for the card this just created.
        e.stopPropagation()
        if (e.key === 'Enter') dispatch({ type: 'COMMIT_ADD_TASK', describe: e.shiftKey })
        if (e.key === 'Escape') dispatch({ type: 'CANCEL_ADD_TASK' })
      }}
      onBlur={() => dispatch({ type: 'COMMIT_ADD_TASK' })}
      placeholder={`${after ? `Building on ${after.key} · ` : ''}Task title · ↵ add · ${keyLabel('⇧↵')} describe`}
      style={{
        height: 38,
        flex: 'none',
        boxSizing: 'border-box',
        background: 'var(--bg-panel-3)',
        border: '1px solid color-mix(in srgb, var(--c-blue) 60%, transparent)',
        borderRadius: 6,
        padding: '0 12px',
        color: 'var(--t1)',
        fontSize: 13,
        outline: 'none'
      }}
    />
  )
}

/** The board's search ("/" to it, Esc clears it). */
function BoardSearch(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const on = (): void => ref.current?.focus()
    window.addEventListener('switchyard:board-search', on)
    return () => window.removeEventListener('switchyard:board-search', on)
  }, [])
  const q = boardFilterOf(state).query
  return (
    <div style={{ width: 210, minWidth: 120, height: 28, display: 'flex', alignItems: 'center', gap: 7, padding: '0 6px 0 9px', background: 'var(--bg-input)', border: '1px solid var(--bd-3)', borderRadius: 5, boxSizing: 'border-box', flex: '0 1 210px' }}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" style={{ color: 'var(--t3)', flex: 'none' }}>
        <circle cx="6" cy="6" r="3.8" />
        <path d="m8.8 8.8 3.2 3.2" />
      </svg>
      <input
        ref={ref}
        value={q}
        onChange={(e) => dispatch({ type: 'SET_BOARD_FILTER', patch: { query: e.target.value } })}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            if (q) dispatch({ type: 'SET_BOARD_FILTER', patch: { query: '' } })
            else e.currentTarget.blur()
          }
          if (e.key === 'Enter' || e.key === 'ArrowDown') e.currentTarget.blur()
        }}
        spellCheck={false}
        placeholder="Search tasks"
        style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--t1)', font: '12.5px var(--font-ui)', padding: 0 }}
      />
      {shortcut('board-search') && !q ? <span style={{ font: '11px var(--font-mono)', color: 'var(--t5)' }}>{shortcut('board-search')}</span> : null}
    </div>
  )
}

const SPEND: [number, string][] = [
  [0, 'Any'],
  [0.01, 'Has spend'],
  [1, '$1 or more'],
  [5, '$5 or more'],
  [20, '$20 or more']
]
const STATUS: [BoardStatus, string][] = [
  ['working', 'Working'],
  ['needs', 'Needs you'],
  ['queued', 'Queued'],
  ['idle', 'Not running']
]

/** Views (built in and saved), then the filters: agent, status, spend, open review comments. */
function FilterButton({ costs, onSaveView }: { costs: Map<string, number>; onSaveView: () => void }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const f = boardFilterOf(state)
  const n = filterCount(f)
  const saved = state.board.views
  const view = viewOf(f, [...BUILTIN_VIEWS, ...saved])
  const set = (patch: Partial<BoardFilter>): void => dispatch({ type: 'SET_BOARD_FILTER', patch })
  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const clear = { agents: [], status: [], spend: 0, review: false }
  const viewItem = (v: BoardView): MenuItem => ({
    label: v.name,
    checked: view?.id === v.id,
    stayOpen: true,
    onClick: () => set(view?.id === v.id ? clear : { ...v.filter, query: f.query })
  })
  const isSaved = !!view && saved.some((v) => v.id === view.id)
  const items: MenuItem[] = [
    { label: 'Views', heading: true, onClick: () => {} },
    ...BUILTIN_VIEWS.map(viewItem),
    ...saved.map(viewItem),
    { label: 'Agent', heading: true, onClick: () => {} },
    ...[...AGENTS.map((a): [string, string] => [a.kind, a.name]), ['none', 'No agent'] as [string, string]].map(([k, l]) => ({ label: l, checked: f.agents.includes(k), stayOpen: true, onClick: () => set({ agents: toggle(f.agents, k) }) })),
    { label: 'Status', heading: true, onClick: () => {} },
    ...STATUS.map(([k, l]) => ({ label: l, checked: f.status.includes(k), stayOpen: true, onClick: () => set({ status: toggle(f.status, k) }) })),
    { label: 'Spend', heading: true, onClick: () => {} },
    ...SPEND.map(([v, l]) => ({ label: l, checked: f.spend === v, stayOpen: true, disabled: v > 0 && !costs.size, onClick: () => set({ spend: v }) })),
    { label: 'Review', heading: true, onClick: () => {} },
    { label: 'Open review comments', checked: f.review, stayOpen: true, onClick: () => set({ review: !f.review }) },
    isSaved
      ? { label: `Delete the view “${view!.name}”`, separatorBefore: true, danger: true, onClick: () => dispatch({ type: 'DELETE_BOARD_VIEW', id: view!.id }) }
      : { label: 'Save as a view…', separatorBefore: true, disabled: !n || !!view, onClick: onSaveView },
    { label: 'Clear filters', disabled: !n, onClick: () => set(clear) }
  ]
  return (
    <>
      <Button
        onClick={(e) => {
          const el = e.currentTarget as HTMLElement
          setMenu((m) => (m ? null : { el }))
        }}
        title="Show only some tasks - a view, or filters of your own"
      >
        {view ? view.name : 'Filter'}
        {n && !view ? <span style={{ font: '600 10.5px/15px var(--font-mono)', padding: '0 5px', borderRadius: 3, color: 'var(--bg-chrome)', background: 'var(--c-blue)', marginLeft: 6 }}>{n}</span> : null}
      </Button>
      {menu ? <Menu anchor={menu} width={230} items={items} onClose={() => setMenu(null)} /> : null}
    </>
  )
}

const GROUPS: [BoardGroup, string][] = [
  ['none', 'No lanes'],
  ['agent', 'Agent'],
  ['repo', 'Repository']
]

/** Swimlanes: the cards by agent, or by repository. */
function GroupButton({ multi }: { multi: boolean }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const group = boardGroupOf(state)
  return (
    <>
      <Button
        onClick={(e) => {
          const el = e.currentTarget as HTMLElement
          setMenu((m) => (m ? null : { el }))
        }}
        title="Swimlanes: a row of columns for each agent, or each repository"
      >
        {group === 'none' ? 'Lanes' : `Lanes: ${GROUPS.find(([g]) => g === group)![1]}`}
      </Button>
      {menu ? (
        <Menu
          anchor={menu}
          width={200}
          items={GROUPS.map(([g, label]) => ({
            label,
            checked: group === g,
            sub: g === 'repo' && !multi ? 'one repo' : undefined,
            onClick: () => dispatch({ type: 'SET_BOARD_GROUP', group: g })
          }))}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  )
}

/** Naming the filters as a view: in place of the search while it's asked. */
function ViewName({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { dispatch } = useAppStore()
  const [name, setName] = useState('')
  return (
    <input
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && name.trim()) {
          dispatch({ type: 'SAVE_BOARD_VIEW', name })
          onDone()
        }
        if (e.key === 'Escape') onDone()
      }}
      onBlur={onDone}
      placeholder="Name the view, then ↵"
      style={{ width: 210, height: 28, boxSizing: 'border-box', flex: 'none', background: 'var(--bg-panel-3)', border: '1px solid color-mix(in srgb, var(--c-blue) 60%, transparent)', borderRadius: 5, padding: '0 9px', color: 'var(--t1)', font: '12.5px var(--font-ui)', outline: 'none' }}
    />
  )
}

export function Board(): React.JSX.Element | null {
  const { state, dispatch } = useAppStore()
  const project = state.projects.find((p) => p.id === state.projectId) ?? state.projects[0]
  const [remote, setRemote] = useState<RemoteInfo | null>(null)
  const [naming, setNaming] = useState(false)
  useEffect(() => {
    setRemote(null)
    if (project) window.api.git.remoteInfo(project.repoPath).then(setRemote)
    // Only a different repository changes the remote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.repoPath])
  // What the filters need to know: each task's spend, and which have review comments open.
  const usage = useUsage()
  const costs = useMemo(() => new Map([...sumUsage(usage, { by: 'task', prices: state.prefs.modelPrices })].map(([id, s]) => [id, s.cost])), [usage, state.prefs.modelPrices])
  const f = boardFilterOf(state)
  const [openReview, setOpenReview] = useState<Set<string>>(new Set())
  useEffect(() => {
    const load = (): void => {
      window.api.store
        .getComments()
        .then((cs) => setOpenReview(new Set(cs.filter((c) => !c.resolved).map((c) => c.taskId))))
        .catch(() => {})
    }
    load()
    return window.api.store.onCommentsChanged(load)
  }, [state.view, state.projectId, f.review])
  // (The scratchpad isn't a card: it's in the sidebar.)
  const all = project ? pinnedFirst(state.tasks.filter((t) => inProject(t, project.id) && !t.archivedAt && !t.scratch)) : []
  const filtering = isFiltering(f)
  const shown = filtering ? all.filter((t) => matchesFilter(t, f, { cost: costs.get(t.id) ?? 0, openReview: openReview.has(t.id) })) : all
  const group = boardGroupOf(state)
  const folded = project ? (state.board.collapsed[project.id] ?? []) : []
  const projectName = (id: string): string => state.projects.find((p) => p.id === id)?.name ?? id
  const lanes = project ? lanesOf(shown, group, { projectId: project.id, projectName }) : []
  // The keyboard's moves go over what shows, lane by lane.
  const ordered = filtering || group !== 'none' ? lanes.filter((l) => !folded.includes(l.key)).flatMap((l) => l.tasks.map((t) => t.id)) : null
  const orderKey = ordered ? ordered.join(',') : null
  useEffect(() => {
    setBoardOrder(orderKey === null ? null : orderKey ? orderKey.split(',') : [])
    return () => setBoardOrder(null)
  }, [orderKey])
  if (!project) return null
  const live = all.filter((t) => t.st === 'working' || t.st === 'waiting' || t.st === 'failed')
  // Settings → Board (the project's own, if it has them): which columns, their order, Done's length.
  const bp = prefsFor(state, project.id)
  const cols = visibleColumns(bp)
  const byCol = (tasks: Task[], col: BoardColumn): Task[] => tasks.filter((t) => t.col === col)
  const cards = (tasks: Task[], col: BoardColumn): Task[] => {
    const list = sortColumn(byCol(tasks, col), bp.columnSort)
    // Done: its latest few (the rest are still counted, and in the archive's search once archived).
    return col === 'done' && bp.doneShown > 0 ? [...list].sort((a, b) => inColumnSince(b) - inColumnSince(a)).slice(0, bp.doneShown) : list
  }
  const addCol: BoardColumn = cols.includes(bp.newTaskColumn) ? bp.newTaskColumn : cols.includes('backlog') ? 'backlog' : 'ready'
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: `repeat(${cols.length},minmax(0,1fr))`, gap: 10 }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 56, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', borderBottom: '1px solid var(--bd-1)' }}>
        <span style={{ font: '600 16px var(--font-ui)', marginRight: 4, whiteSpace: 'nowrap' }}>{project.name}</span>
        <span style={{ font: "12px var(--font-mono)", color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 60, flex: '0 1 auto', marginRight: 4 }}>
          {project.repo} · {project.defaultBranch ?? 'main'}
        </span>
        {naming ? <ViewName onDone={() => setNaming(false)} /> : <BoardSearch />}
        <FilterButton costs={costs} onSaveView={() => setNaming(true)} />
        <GroupButton multi={all.some(isMulti)} />
        {filtering ? (
          <span style={{ font: '12px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap' }}>
            {shown.length} of {all.length}{' '}
            <span onClick={() => dispatch({ type: 'SET_BOARD_FILTER', patch: null })} style={{ color: 'var(--c-blue)', cursor: 'pointer' }}>
              clear
            </span>
          </span>
        ) : null}
        <div style={{ flex: 1 }} />
        <span style={{ font: "12px var(--font-mono)", color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1 auto' }}>
          {live.length} active · {plural(all.length, 'task')}
        </span>
        <span style={{ font: "11.5px var(--font-mono)", color: 'var(--t5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 100 auto' }}>{['HJKL move', shortcut('start-task') && `${shortcut('start-task')} start`, '↵ open', 'drag cards'].filter(Boolean).join(' · ')}</span>
        {remote?.github ? <Button onClick={() => dispatch({ type: 'OPEN_ISSUES', projectId: project.id })}>Issues</Button> : null}
        <Button hint={shortcut('project-settings')} onClick={() => dispatch({ type: 'OPEN_SETTINGS', section: `project:${project.id}` })}>
          Settings
        </Button>
        <Button variant="primary" hint={shortcut('new-task')} onClick={() => dispatch({ type: 'BEGIN_ADD_TASK' })}>
          New task
        </Button>
      </div>
      <TrustStrip project={project} />
      <BaseStrip project={project} />
      <OutsideStrip project={project} />
      {group === 'none' ? (
        <div style={{ ...grid, flex: 1, minHeight: 0, padding: '14px 16px' }}>
          {cols.map((col) => (
            <ColumnCell
              key={col}
              col={col}
              tasks={cards(shown, col)}
              costs={costs}
              adding={col === addCol && state.addingTask}
              head={<ColumnHead col={col} all={byCol(all, col)} shown={byCol(shown, col)} filtering={filtering} />}
            />
          ))}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 16px 14px' }}>
          <div style={{ ...grid, position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-app)', padding: '14px 4px 6px' }}>
            {cols.map((col) => (
              <ColumnHead key={col} col={col} all={byCol(all, col)} shown={byCol(shown, col)} filtering={filtering} />
            ))}
          </div>
          {!lanes.length && filtering ? (
            <div style={{ padding: '28px 8px', font: '12.5px var(--font-ui)', color: 'var(--t4)', textAlign: 'center' }}>
              No task matches the search and filters.{' '}
              <span onClick={() => dispatch({ type: 'SET_BOARD_FILTER', patch: null })} style={{ color: 'var(--c-blue)', cursor: 'pointer' }}>
                Clear them
              </span>
            </div>
          ) : null}
          {(lanes.length ? lanes : [{ key: '', label: '', tasks: [] }]).map((lane, i) => {
            const isFolded = folded.includes(lane.key)
            return (
              <div key={lane.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: i ? 10 : 2 }}>
                {lane.label ? <LaneHead lane={lane} folded={isFolded} onToggle={() => dispatch({ type: 'TOGGLE_BOARD_LANE', key: lane.key })} /> : null}
                {isFolded ? null : (
                  <div style={grid}>
                    {cols.map((col) => (
                      <ColumnCell key={col} col={col} tasks={cards(lane.tasks, col)} costs={costs} adding={i === 0 && col === addCol && state.addingTask} lanes />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
