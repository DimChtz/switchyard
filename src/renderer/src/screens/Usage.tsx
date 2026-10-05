import React, { useMemo, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { useUsage } from '../lib/usage'
import { useHover } from '../lib/useHover'
import { dayOf, formatCost, formatTokens, periodStart, sumUsage, totalTokens, usageCsv, type UsageSum } from '@shared/usage'
import { Button, TipRows, TipTitle, Tooltip } from '../components/ui'
import { errText } from '../lib/errors'

type Range = '7' | '30' | 'all'

const MONO = 'var(--font-mono)'

/**
 * What the agents used: tokens and their cost at API prices, over time, by
 * project, task and model. From Claude Code's transcripts and Codex's session logs.
 */
export function Usage(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const entries = useUsage()
  const [range, setRange] = useState<Range>('30')
  const prices = state.prefs.modelPrices
  const today = dayOf(Date.now())
  const since = range === 'all' ? undefined : dayOf(Date.now() - (Number(range) - 1) * 86_400_000)

  const { total, todaySum, byDay, byProject, byTask, taskCount, byModel } = useMemo(() => {
    const opts = { since, prices }
    const tasks = sumUsage(entries, { ...opts, by: 'task' })
    return {
      taskCount: tasks.size,
      total: sumUsage(entries, opts).get('') ?? null,
      todaySum: sumUsage(entries, { since: today, prices }).get('') ?? null,
      byDay: sumUsage(entries, { ...opts, by: 'day' }),
      byProject: [...sumUsage(entries, { ...opts, by: 'project' })].sort((a, b) => rank(b[1]) - rank(a[1])),
      byTask: [...tasks].sort((a, b) => rank(b[1]) - rank(a[1])).slice(0, 12),
      byModel: [...sumUsage(entries, { ...opts, by: 'model' })].sort((a, b) => totalTokens(b[1].tokens) - totalTokens(a[1].tokens))
    }
  }, [entries, since, today, prices])

  // The chart: every day of the range (the last 60 for "all").
  const days = useMemo(() => {
    const n = range === 'all' ? 60 : Number(range)
    return Array.from({ length: n }, (_, i) => dayOf(Date.now() - (n - 1 - i) * 86_400_000))
  }, [range])
  const priced = (total?.cost ?? 0) > 0
  const value = (s: UsageSum | undefined): number => (s ? (priced ? s.cost : totalTokens(s.tokens)) : 0)
  const max = Math.max(...days.map((d) => value(byDay.get(d))), 0)
  const taskOf = (id: string) => entries.find((e) => e.taskId === id)
  const projectName = (id: string): string => state.projects.find((p) => p.id === id)?.name ?? (id || 'No project')
  const unpricedModels = byModel.filter(([, s]) => s.unpriced > 0)
  // Each project's budget, against its cost this month.
  const budgets = Object.entries(state.prefs.projectBudgets).filter(([id, v]) => v > 0 && state.projects.some((p) => p.id === id))
  const monthCost = useMemo(() => sumUsage(entries, { since: periodStart('month', Date.now()), prices, by: 'project' }), [entries, prices])
  const exportCsv = async (): Promise<void> => {
    try {
      const path = await window.api.dialog.saveText(`switchyard-usage-${range === 'all' ? 'all' : `${range}d`}-${today}.csv`, usageCsv(entries, prices, projectName, since), { name: 'CSV', extensions: ['csv'] })
      if (path) dispatch({ type: 'TOAST', text: `Saved ${path}`, tone: 'done' })
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not export: ${errText(err)}` })
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ height: 56, display: 'flex', alignItems: 'center', gap: 14, padding: '0 24px', borderBottom: '1px solid var(--bd-1)' }}>
        <span style={{ font: '600 16px var(--font-ui)' }}>Usage</span>
        <span style={{ font: `12px ${MONO}`, color: 'var(--t3)' }}>Claude Code and Codex sessions · cost at API prices</span>
        <div style={{ flex: 1 }} />
        {entries.length ? (
          <Button onClick={exportCsv} title="Every session's tokens and cost, a row per day and model">
            Export CSV
          </Button>
        ) : null}
        <div style={{ display: 'flex', padding: 2, gap: 2, background: 'var(--bg-input)', border: '1px solid var(--bd-2)', borderRadius: 5 }}>
          {(
            [
              ['7', '7 days'],
              ['30', '30 days'],
              ['all', 'All time']
            ] as [Range, string][]
          ).map(([k, l]) => (
            <span
              key={k}
              onClick={() => setRange(k)}
              style={{ height: 22, padding: '0 10px', borderRadius: 3, display: 'flex', alignItems: 'center', font: '12px var(--font-ui)', cursor: 'pointer', color: range === k ? 'var(--t1)' : 'var(--t3)', background: range === k ? 'var(--bd-2)' : 'transparent' }}
            >
              {l}
            </span>
          ))}
        </div>
      </div>

      {!entries.length ? (
        <div style={{ padding: '60px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <div style={{ font: '500 15px var(--font-ui)', color: 'var(--t1)' }}>No usage recorded yet</div>
          <div style={{ font: '13px/1.55 var(--font-ui)', color: 'var(--t3)', maxWidth: 440 }}>
            Tokens are read from Claude Code&apos;s transcripts and Codex&apos;s session logs as they work - start a task with either and they show up here. Gemini and the others don&apos;t record theirs.
          </div>
        </div>
      ) : (
        <div style={{ padding: '22px 24px 40px', display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1100 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            <Card label={range === 'all' ? 'Cost, all time' : `Cost, last ${range} days`} value={formatCost(total?.cost ?? 0)} note={total?.unpriced ? `+ ${formatTokens(total.unpriced)} tokens without a price` : 'estimated at API prices'} />
            <Card label="Today" value={formatCost(todaySum?.cost ?? 0)} note={`${formatTokens(totalTokens(todaySum?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }))} tokens`} />
            <Card
              label="Tokens"
              value={formatTokens(totalTokens(total?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }))}
              note={total ? `${formatTokens(total.tokens.input + total.tokens.cacheWrite)} in · ${formatTokens(total.tokens.output)} out · ${formatTokens(total.tokens.cacheRead)} cached` : ''}
            />
            <Card label="Sessions" value={String(total?.sessions ?? 0)} note={`${taskCount} task${taskCount === 1 ? '' : 's'}`} />
          </div>

          <Section title={priced ? 'Cost per day' : 'Tokens per day'}>
            <div style={{ height: 150, display: 'flex', alignItems: 'flex-end', gap: 3, padding: '12px 14px 8px' }}>
              {days.map((d) => {
                const s = byDay.get(d)
                const v = value(s)
                return (
                  <Tooltip
                    key={d}
                    content={
                      <>
                        <TipTitle>{d === today ? `Today · ${d}` : d}</TipTitle>
                        {s ? (
                          <TipRows
                            rows={[
                              ['Cost', formatCost(s.cost)],
                              ['Input', formatTokens(s.tokens.input + s.tokens.cacheWrite)],
                              ['Output', formatTokens(s.tokens.output)],
                              ['Cached', formatTokens(s.tokens.cacheRead)],
                              ['Sessions', String(s.sessions)]
                            ]}
                          />
                        ) : (
                          <span style={{ color: 'var(--t3)' }}>No agent work</span>
                        )}
                      </>
                    }
                  >
                    <div style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                      <div style={{ width: '100%', height: `${max ? Math.max(v ? 3 : 1, (v / max) * 100) : 1}%`, borderRadius: 2, background: d === today ? 'var(--c-blue)' : v ? 'color-mix(in srgb, var(--c-blue) 55%, transparent)' : 'var(--bd-2)' }} />
                    </div>
                  </Tooltip>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 14px 10px', font: `11px ${MONO}`, color: 'var(--t4)' }}>
              <span>{days[0]}</span>
              <span>{priced ? `max ${formatCost(max)}` : `max ${formatTokens(max)}`}</span>
              <span>today</span>
            </div>
          </Section>

          {budgets.length ? (
            <Section title="Budgets this month">
              {budgets.map(([id, limit]) => (
                <BudgetRow key={id} label={projectName(id)} cost={monthCost.get(id)?.cost ?? 0} limit={limit} onClick={() => dispatch({ type: 'OPEN_SETTINGS', section: 'agents' })} />
              ))}
            </Section>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 22 }}>
            <Section title="By project">
              {byProject.map(([id, s]) => (
                <BarRow key={id} label={projectName(id)} sub={`${s.sessions} session${s.sessions === 1 ? '' : 's'}`} s={s} share={shareOf(s, total)} />
              ))}
            </Section>
            <Section title="By model">
              {byModel.map(([model, s]) => (
                <BarRow key={model} label={model.replace(/^claude-/, '')} sub={s.unpriced ? 'no price set' : ''} s={s} share={shareOf(s, total)} warn={s.unpriced > 0} />
              ))}
            </Section>
          </div>

          <Section title="Tasks that used the most">
            {byTask.map(([id, s]) => {
              const e = taskOf(id)
              const live = state.tasks.find((t) => t.id === id)
              return (
                <BarRow
                  key={id}
                  label={`${e?.taskKey ?? id}  ${e?.title ?? ''}`}
                  sub={projectName(e?.projectId ?? '')}
                  s={s}
                  share={shareOf(s, total)}
                  onClick={live ? () => (live.worktreePath ? dispatch({ type: 'OPEN_TASK', taskId: id }) : dispatch({ type: 'NAV', view: 'board', projectId: live.projectId })) : undefined}
                />
              )
            })}
          </Section>

          <div style={{ font: '12px/1.6 var(--font-ui)', color: 'var(--t4)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>
              Costs are what the same tokens cost through the API; a Claude or ChatGPT subscription isn&apos;t billed per token. Gemini and the other agents aren&apos;t tracked (they
              don&apos;t record their usage).
            </span>
            {unpricedModels.length ? (
              <span>
                No price for {unpricedModels.map(([m]) => m).join(', ')} - set one in{' '}
                <span onClick={() => dispatch({ type: 'OPEN_SETTINGS', section: 'agents' })} style={{ color: 'var(--c-blue)', cursor: 'pointer' }}>
                  Settings → Agents
                </span>
                .
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function rank(s: UsageSum): number {
  return s.cost * 1e9 + totalTokens(s.tokens)
}

function shareOf(s: UsageSum, total: UsageSum | null): number {
  if (!total) return 0
  return total.cost > 0 ? s.cost / total.cost : totalTokens(s.tokens) / Math.max(1, totalTokens(total.tokens))
}

function Card({ label, value, note }: { label: string; value: string; note: string }): React.JSX.Element {
  return (
    <div style={{ border: '1px solid var(--bd-2)', borderRadius: 8, background: 'var(--bg-panel-2)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ font: `500 11px ${MONO}`, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--t4)' }}>{label}</span>
      <span style={{ font: '600 22px var(--font-ui)', color: 'var(--t1)', letterSpacing: '-0.01em' }}>{value}</span>
      <span style={{ font: `11.5px ${MONO}`, color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span style={{ font: `500 11px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)' }}>{title}</span>
      <div style={{ border: '1px solid var(--bd-2)', borderRadius: 8, background: 'var(--bg-panel-2)', display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  )
}

/** A project's month so far against its budget: amber from 80%, red once it's reached. */
function BudgetRow({ label, cost, limit, onClick }: { label: string; cost: number; limit: number; onClick: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const share = cost / limit
  const color = share >= 1 ? 'var(--c-red)' : share >= 0.8 ? 'var(--c-amber)' : 'var(--c-green)'
  return (
    <div
      onClick={onClick}
      {...hoverProps}
      title="Change it in Settings → Agents → Project budgets"
      style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 170px', alignItems: 'center', gap: 12, padding: '8px 14px', borderTop: '1px solid var(--bd-1)', cursor: 'pointer', background: hover ? 'var(--bg-hover)' : 'transparent' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
        <span style={{ font: '13px var(--font-ui)', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <div style={{ height: 4, borderRadius: 2, background: 'var(--bd-1)' }}>
          <div style={{ height: '100%', width: `${Math.min(100, Math.max(1, share * 100))}%`, borderRadius: 2, background: color }} />
        </div>
      </div>
      <span style={{ font: `12.5px ${MONO}`, color: 'var(--t1)', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {formatCost(cost)} <span style={{ color: 'var(--t4)' }}>of {formatCost(limit)}</span> <span style={{ color }}>{Math.round(share * 100)}%</span>
      </span>
    </div>
  )
}

function BarRow({ label, sub, s, share, warn, onClick }: { label: string; sub: string; s: UsageSum; share: number; warn?: boolean; onClick?: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      onClick={onClick}
      {...hoverProps}
      style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px 80px', alignItems: 'center', gap: 12, padding: '8px 14px', borderTop: '1px solid var(--bd-1)', cursor: onClick ? 'pointer' : 'default', background: hover && onClick ? 'var(--bg-hover)' : 'transparent' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
          <span style={{ font: '13px var(--font-ui)', color: 'var(--t1)', whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
          {sub ? <span style={{ font: `11px ${MONO}`, color: warn ? 'var(--c-amber)' : 'var(--t4)', whiteSpace: 'nowrap' }}>{sub}</span> : null}
        </div>
        <div style={{ height: 3, borderRadius: 2, background: 'var(--bd-1)' }}>
          <div style={{ height: '100%', width: `${Math.max(1, share * 100)}%`, borderRadius: 2, background: 'color-mix(in srgb, var(--c-blue) 70%, transparent)' }} />
        </div>
      </div>
      <span style={{ font: `12px ${MONO}`, color: 'var(--t3)', textAlign: 'right' }}>{formatTokens(totalTokens(s.tokens))}</span>
      <span style={{ font: `12.5px ${MONO}`, color: s.unpriced && !s.cost ? 'var(--t4)' : 'var(--t1)', textAlign: 'right' }}>{s.unpriced && !s.cost ? '-' : formatCost(s.cost)}</span>
    </div>
  )
}
