import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { useUsage } from '../lib/usage'
import { useActivity } from '../lib/activity'
import { useConflicts } from '../lib/conflicts'
import { agentName, buildSummary, lines, periodRange, plural, summaryMarkdown, when, type SummaryPeriod } from '../lib/summary'
import { COLUMN_LABEL } from '@shared/constants'
import { formatCost } from '@shared/usage'
import { Button, Menu, type MenuAnchor } from '../components/ui'
import type { Task } from '@shared/types'

const MONO = 'var(--font-mono)'

/**
 * The daily summary: what the agents did (since you last looked, today,
 * yesterday or this week), what waits for you now, and what's next - and
 * the same as Markdown, for a standup.
 */
export function Summary(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const log = useActivity()
  const usage = useUsage()
  const conflicts = useConflicts()
  const [now, setNow] = useState(() => Date.now())
  // When it was last looked at, as it was on coming here (leaving moves it on).
  const [seenAt, setSeenAt] = useState<number | null>(null)
  const [period, setPeriod] = useState<SummaryPeriod | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)

  useEffect(() => {
    if (!log || seenAt !== null) return
    setSeenAt(log.seenAt)
    const age = Date.now() - log.seenAt
    setPeriod(!log.seenAt || age < 30 * 60_000 ? 'today' : age > 7 * 86_400_000 ? 'week' : 'since')
  }, [log, seenAt])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => {
      clearInterval(t)
      window.api.activity.seen(Date.now()).catch(() => {})
    }
  }, [])

  const p = period ?? 'today'
  const range = periodRange(p, now, seenAt ?? 0)
  const summary = useMemo(
    () => buildSummary({ tasks: state.tasks, events: log?.events ?? [], usage, prices: state.prefs.modelPrices, conflicts, from: range.from, to: range.to, now, projectId }),
    [state.tasks, log, usage, state.prefs.modelPrices, conflicts, range.from, range.to, now, projectId]
  )
  const projectName = (id: string): string => state.projects.find((x) => x.id === id)?.name ?? id
  const project = state.projects.find((x) => x.id === projectId)
  const t = summary.totals
  const many = !projectId && new Set([...summary.finished, ...summary.worked].map((r) => r.projectId)).size > 1
  const open = (task: Task | undefined): void => {
    if (!task) return
    if (task.worktreePath && task.col !== 'done') dispatch({ type: 'OPEN_TASK', taskId: task.id })
    else {
      dispatch({ type: 'NAV', view: 'board', projectId: task.projectId })
      dispatch({ type: 'SET_BOARD_FOCUS', id: task.id })
    }
  }
  const copy = (): void => {
    window.api.sys.copy(summaryMarkdown(summary, `${range.label}${project ? ` · ${project.name}` : ''}`, projectName, now))
    dispatch({ type: 'TOAST', text: 'Copied the summary as Markdown', tone: 'done' })
  }

  const headline = [t.finished ? `${plural(t.finished, 'task')} finished` : null, t.turns ? `${plural(t.turns, 'agent turn')} on ${plural(t.tasks, 'task')}` : null].filter(Boolean).join(', ')
  const nothing = !t.turns && !t.finished && !summary.worked.length

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ height: 56, display: 'flex', alignItems: 'center', gap: 14, padding: '0 24px', borderBottom: '1px solid var(--bd-1)', position: 'sticky', top: 0, background: 'var(--bg-app)', zIndex: 1 }}>
        <span style={{ font: '600 16px var(--font-ui)' }}>Summary</span>
        <span style={{ font: `12px ${MONO}`, color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          {p === 'since' ? `${range.label} → now` : `${range.label} · ${when(range.from, now)} → ${p === 'yesterday' ? 'midnight' : 'now'}`}
        </span>
        <div style={{ flex: 1 }} />
        <Button
          onClick={(e) => {
            const el = e.currentTarget
            setMenu((m) => (m ? null : { el, align: 'end' }))
          }}
        >
          {project ? project.name : 'All projects'} ▾
        </Button>
        <Button onClick={copy} title="The summary as Markdown - for a standup, a channel or a note">
          Copy as Markdown
        </Button>
        <div style={{ display: 'flex', padding: 2, gap: 2, background: 'var(--bg-input)', border: '1px solid var(--bd-2)', borderRadius: 5, flex: 'none' }}>
          {(
            [
              ['since', 'Since last look', seenAt ? `Since you last looked here, ${when(seenAt, now)}` : 'Since you last looked here'],
              ['today', 'Today', 'Since midnight'],
              ['yesterday', 'Yesterday', 'All of yesterday'],
              ['week', '7 days', 'The last 7 days']
            ] as [SummaryPeriod, string, string][]
          ).map(([k, l, tip]) => (
            <span
              key={k}
              onClick={() => setPeriod(k)}
              title={tip}
              style={{ height: 22, padding: '0 10px', borderRadius: 3, display: 'flex', alignItems: 'center', font: '12px var(--font-ui)', cursor: 'pointer', whiteSpace: 'nowrap', color: p === k ? 'var(--t1)' : 'var(--t3)', background: p === k ? 'var(--bd-2)' : 'transparent' }}
            >
              {l}
            </span>
          ))}
        </div>
      </div>

      <div style={{ padding: '26px 32px 48px', display: 'flex', flexDirection: 'column', gap: 26, maxWidth: 880 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ font: '600 21px/1.3 var(--font-ui)', letterSpacing: '-0.01em', color: 'var(--t1)', textWrap: 'pretty' } as React.CSSProperties}>
            {nothing ? 'A quiet stretch - no agent worked in this period.' : `${headline}.`}
          </div>
          <div style={{ font: `12.5px ${MONO}`, color: 'var(--t3)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {t.files ? <span>{plural(t.files, 'file')} changed <span style={{ color: 'var(--t2)' }}>{lines(t.added, t.deleted)}</span></span> : null}
            {t.review ? <span>{plural(t.review, 'task')} to Review</span> : null}
            {t.cost ? <span title="At API prices, for the days the period touches">{formatCost(t.cost)} spent</span> : null}
            {summary.costByProject.length > 1 ? <span style={{ color: 'var(--t4)' }}>{summary.costByProject.map((c) => `${projectName(c.projectId)} ${formatCost(c.cost)}`).join(' · ')}</span> : null}
          </div>
        </div>

        {summary.attention.length ? (
          <Section title="Needs you" count={summary.attention.length}>
            {summary.attention.map((a, i) => (
              <Row key={`${a.task.id}-${i}`} dot={a.tone === 'red' ? 'var(--c-red)' : a.tone === 'blue' ? 'var(--c-blue)' : 'var(--c-amber)'} k={a.task.key} title={a.task.title} meta={a.since ? `since ${when(a.since, now)}` : undefined} sub={a.why} onClick={() => open(a.task)} />
            ))}
          </Section>
        ) : null}

        {summary.finished.length ? (
          <Section title="Finished" count={summary.finished.length}>
            {summary.finished.map((r) => (
              <Row
                key={r.taskId}
                dot="var(--c-green)"
                k={r.key}
                title={r.title}
                chip={many ? projectName(r.projectId) : undefined}
                meta={[r.turns ? plural(r.turns, 'turn') : null, r.cost ? formatCost(r.cost) : null, when(r.finished!.at, now)].filter(Boolean).join(' · ')}
                sub={`${r.finished!.note ?? 'Done'}${r.agentKind ? ` · ${agentName(r.agentKind)}` : ''}`}
                onClick={r.task ? () => open(r.task) : undefined}
              />
            ))}
          </Section>
        ) : null}

        {summary.worked.length ? (
          <Section title="Worked on" count={summary.worked.length}>
            {summary.worked.map((r) => (
              <Row
                key={r.taskId}
                dot={r.failed ? 'var(--c-red)' : r.toReview ? 'var(--c-green)' : 'var(--c-blue)'}
                k={r.key}
                title={r.title}
                chip={many ? projectName(r.projectId) : undefined}
                meta={[plural(r.turns, 'turn'), r.files ? `${plural(r.files, 'file')} ${lines(r.added, r.deleted)}` : null, r.cost ? formatCost(r.cost) : null].filter(Boolean).join(' · ')}
                sub={`${agentName(r.agentKind)} · ${r.task ? (r.task.col === 'done' ? 'Done' : COLUMN_LABEL[r.task.col]) : 'deleted'}${r.toReview ? ' · moved to Review' : ''}${r.failed ? ' · failed once' : ''}`}
                quote={r.said}
                onClick={r.task ? () => open(r.task) : undefined}
              />
            ))}
          </Section>
        ) : null}

        {summary.review.length ? (
          <Section title="Ready for your review" count={summary.review.length}>
            {summary.review.map((task) => (
              <Row key={task.id} dot="var(--c-green)" k={task.key} title={task.title} meta={`waiting ${when(task.lastActivityAt, now)}`} sub={`${agentName(task.agentKind)}${task.pr?.number ? ` · PR #${task.pr.number}` : ''}`} onClick={() => open(task)} />
            ))}
          </Section>
        ) : null}

        {summary.next.length ? (
          <Section title="Next up" count={summary.next.length}>
            {summary.next.map((n) => (
              <Row key={n.task.id} dot="var(--t5)" k={n.task.key} title={n.task.title} sub={n.why} onClick={() => open(n.task)} />
            ))}
          </Section>
        ) : null}

        {nothing && !summary.attention.length && !summary.review.length ? (
          <div style={{ font: '13px/1.6 var(--font-ui)', color: 'var(--t3)', maxWidth: 520 }}>
            The summary fills in as agents work: their turns, what they changed and said, what reached Review and what got merged. Try another period above.
          </div>
        ) : null}
      </div>
      {menu ? (
        <Menu
          anchor={menu}
          width={220}
          items={[
            { label: 'All projects', checked: !projectId, onClick: () => setProjectId(null) },
            ...state.projects.map((x) => ({ label: x.name, checked: projectId === x.id, onClick: () => setProjectId(x.id) }))
          ]}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 6, borderBottom: '1px solid var(--bd-1)', marginBottom: 4 }}>
        <span style={{ font: `500 11px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t3)' }}>{title}</span>
        <span style={{ font: `11px ${MONO}`, color: 'var(--t5)' }}>{count}</span>
      </div>
      {children}
    </div>
  )
}

function Row({
  dot,
  k,
  title,
  chip,
  meta,
  sub,
  quote,
  onClick
}: {
  dot: string
  k: string
  title: string
  chip?: string
  meta?: string
  sub?: string
  quote?: string | null
  onClick?: () => void
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      onClick={onClick}
      {...hoverProps}
      style={{ display: 'grid', gridTemplateColumns: '10px 64px minmax(0, 1fr)', columnGap: 10, rowGap: 3, padding: '8px 10px', margin: '0 -10px', borderRadius: 6, cursor: onClick ? 'pointer' : 'default', background: hover && onClick ? 'var(--bg-panel)' : 'transparent' }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, marginTop: 6 }} />
      <span style={{ font: `12px/19px ${MONO}`, color: 'var(--t3)' }}>{k}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        <span style={{ font: '500 13.5px/19px var(--font-ui)', color: 'var(--t1)', flex: '0 1 auto', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        {chip ? <span style={{ font: `11px ${MONO}`, color: 'var(--t-icon)', border: '1px solid var(--bd-2)', borderRadius: 3, padding: '0 5px', flex: 'none' }}>{chip}</span> : null}
        <span style={{ flex: 1 }} />
        {meta ? <span style={{ font: `11.5px ${MONO}`, color: 'var(--t3)', whiteSpace: 'nowrap', flex: 'none' }}>{meta}</span> : null}
      </div>
      {sub ? (
        <>
          <span />
          <span />
          <span style={{ font: '12.5px/1.45 var(--font-ui)', color: 'var(--t2)', overflowWrap: 'anywhere' }}>{sub}</span>
        </>
      ) : null}
      {quote ? (
        <>
          <span />
          <span />
          <span style={{ font: '12.5px/1.5 var(--font-ui)', color: 'var(--t3)', borderLeft: '2px solid var(--bd-3)', paddingLeft: 10, marginTop: 2, textWrap: 'pretty', overflowWrap: 'anywhere' } as React.CSSProperties}>{quote}</span>
        </>
      ) : null}
    </div>
  )
}
