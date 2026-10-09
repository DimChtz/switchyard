import React, { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { timeAgo } from '../lib/status'
import { errText } from '../lib/errors'
import { plural } from '../lib/summary'
import { prefsFor } from '../lib/projectPrefs'
import { Button, Segmented, confirm } from '../components/ui'
import type { OpenPr, Project, Task } from '@shared/types'

/** A project's open pull requests, or why they can't be read. */
type ProjectPrs = { project: Project; prs: OpenPr[] | null; error: string | null }

type Filter = 'all' | 'tasks' | 'attention'

/** Needs you: checks failed, changes asked for, or it no longer merges. */
const needsAttention = (p: OpenPr): boolean => p.checks.state === 'fail' || p.review === 'changes' || p.conflicts

/** Every open pull request across the projects (GitHub CLI): checks, reviews, the task it's from - and merging. */
export function PullRequests(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [data, setData] = useState<ProjectPrs[]>([])
  const [loading, setLoading] = useState(false)
  const [at, setAt] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const projects = state.projects
  const projectKey = projects.map((p) => p.id).join('|')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all(
      projects.map((project) =>
        window.api.git
          .openPrs(project.repoPath)
          .then((prs): ProjectPrs => ({ project, prs, error: null }))
          .catch((err: unknown): ProjectPrs => ({ project, prs: null, error: errText(err) }))
      )
    ).then((all) => {
      setData(all)
      setLoading(false)
      setAt(Date.now())
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey])
  // Now, and every two minutes while it's open.
  useEffect(() => {
    load()
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
  }, [load])

  const taskOf = (project: Project, pr: OpenPr): Task | undefined =>
    state.tasks.find((t) => (t.projectId === project.id && t.branch === pr.branch) || t.pr?.url === pr.url)

  const merge = async (project: Project, pr: OpenPr): Promise<void> => {
    const method = prefsFor(state, project.id).prMergeMethod
    const task = taskOf(project, pr)
    const ok = await confirm({
      title: `Merge #${pr.number} into ${pr.base}?`,
      body: `${pr.title}\n\nOn GitHub, as a ${method === 'squash' ? 'squash merge' : method === 'rebase' ? 'rebase' : 'merge commit'} (Settings → Git).${task ? ` ${task.key} finishes when Switchyard sees it merged, if its project finishes tasks on merge.` : ''}`,
      confirmLabel: 'Merge on GitHub'
    })
    if (!ok) return
    try {
      await window.api.git.mergePr(project.repoPath, pr.url, method)
      dispatch({ type: 'TOAST', text: `Merged #${pr.number}.`, tone: 'done' })
      if (task) dispatch({ type: 'SET_TASK_PR', taskId: task.id, pr: { url: pr.url, number: pr.number, state: 'MERGED' } })
    } catch (err) {
      dispatch({ type: 'TOAST', text: `GitHub didn't merge #${pr.number}: ${errText(err)}` })
    }
    load()
  }

  const shown = data.map((d) => ({
    ...d,
    prs: d.prs?.filter((p) => (filter === 'tasks' ? !!taskOf(d.project, p) : filter === 'attention' ? needsAttention(p) : true)) ?? null
  }))
  const total = data.reduce((n, d) => n + (d.prs?.length ?? 0), 0)
  const attention = data.reduce((n, d) => n + (d.prs?.filter(needsAttention).length ?? 0), 0)
  const onGithub = data.filter((d) => d.prs)

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '28px 32px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ font: '600 20px var(--font-ui)', color: 'var(--t1)' }}>Pull requests</span>
          <span style={{ font: '12.5px var(--font-ui)', color: 'var(--t3)' }}>
            {loading && !at ? 'Reading them from GitHub…' : `${plural(total, 'open pull request')}${attention ? ` · ${attention} need${attention === 1 ? 's' : ''} attention` : ''} · across ${plural(onGithub.length, 'project')} on GitHub${at ? ` · ${timeAgo(at)} ago` : ''}`}
          </span>
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            ['all', 'All'],
            ['tasks', 'From tasks'],
            ['attention', <span key="a">Needs attention{attention ? ` ${attention}` : ''}</span>]
          ]}
        />
        <Button size="sm" disabled={loading} onClick={load}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {!projects.length ? <Empty text="Add a project to see its pull requests." /> : null}
      {shown.map((d) => (
        <section key={d.project.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '0 4px 4px', borderBottom: '1px solid var(--bd-1)' }}>
            <span style={{ font: '500 13px var(--font-ui)', color: 'var(--t1)' }}>{d.project.name}</span>
            <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t4)' }}>{d.error ? '' : d.prs ? `${d.prs.length} open` : '…'}</span>
          </div>
          {d.error ? <div style={{ padding: '8px 4px', font: '12.5px var(--font-ui)', color: 'var(--t4)' }}>{d.error}</div> : null}
          {d.prs && !d.prs.length ? <div style={{ padding: '8px 4px', font: '12.5px var(--font-ui)', color: 'var(--t4)' }}>{filter === 'all' ? 'No open pull requests.' : 'None here.'}</div> : null}
          {d.prs?.map((pr) => {
            const task = taskOf(d.project, pr)
            return (
              <PrRow
                key={pr.number}
                pr={pr}
                task={task}
                onOpenTask={task ? () => dispatch({ type: 'OPEN_TASK', taskId: task.id }) : undefined}
                onMerge={() => merge(d.project, pr)}
              />
            )
          })}
        </section>
      ))}
    </div>
  )
}

function Empty({ text }: { text: string }): React.JSX.Element {
  return <div style={{ padding: 24, font: '13px var(--font-ui)', color: 'var(--t3)' }}>{text}</div>
}

function Badge({ tone, title, children }: { tone: string; title?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <span title={title} style={{ padding: '1px 7px', borderRadius: 4, font: '11px var(--font-mono)', whiteSpace: 'nowrap', color: tone, background: `color-mix(in srgb, ${tone} 13%, transparent)` }}>
      {children}
    </span>
  )
}

function PrRow({ pr, task, onOpenTask, onMerge }: { pr: OpenPr; task: Task | undefined; onOpenTask?: () => void; onMerge: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const c = pr.checks
  const checks =
    c.state === 'none' ? null : c.state === 'fail' ? (
      <Badge tone="var(--c-red)" title={`${c.failed} of ${c.total} checks failed`}>
        ✕ {c.failed}/{c.total}
      </Badge>
    ) : c.state === 'pending' ? (
      <Badge tone="var(--c-amber)" title={`${c.pending} of ${c.total} checks still running`}>
        ● {c.total - c.pending}/{c.total}
      </Badge>
    ) : (
      <Badge tone="var(--c-green)" title="All checks passed">
        ✓ {c.total}
      </Badge>
    )
  const review =
    pr.review === 'approved' ? (
      <Badge tone="var(--c-green)">approved</Badge>
    ) : pr.review === 'changes' ? (
      <Badge tone="var(--c-red)">changes asked</Badge>
    ) : pr.review === 'required' ? (
      <Badge tone="var(--t3)">review needed</Badge>
    ) : null
  return (
    <div
      {...hoverProps}
      style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) auto', alignItems: 'center', columnGap: 12, padding: '7px 8px', borderRadius: 6, background: hover ? 'var(--bg-menu)' : 'transparent' }}
    >
      <span style={{ font: '12.5px var(--font-mono)', color: 'var(--c-blue)' }}>#{pr.number}</span>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {pr.draft ? <Badge tone="var(--t3)">draft</Badge> : null}
          <span title={pr.title} style={{ font: '13px var(--font-ui)', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {pr.title}
          </span>
          {task ? (
            <span
              onClick={onOpenTask}
              title={`Open ${task.key} · ${task.title}`}
              style={{ padding: '1px 6px', borderRadius: 4, font: '11px var(--font-mono)', color: 'var(--c-blue)', background: 'color-mix(in srgb, var(--c-blue) 14%, transparent)', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {task.key}
            </span>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', font: '11.5px var(--font-mono)', color: 'var(--t4)' }}>
          <span title={`${pr.branch} → ${pr.base}`} style={{ maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            ⎇ {pr.branch} → {pr.base}
          </span>
          {checks}
          {review}
          {pr.conflicts ? <Badge tone="var(--c-red)" title="GitHub says it doesn't merge cleanly">conflicts</Badge> : null}
          <span>
            <span style={{ color: 'var(--c-green)' }}>+{pr.additions}</span> <span style={{ color: 'var(--c-red)' }}>−{pr.deletions}</span>
          </span>
          <span>
            {pr.author} · {timeAgo(pr.updatedAt)} ago
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, opacity: hover ? 1 : 0.6 }}>
        {task ? (
          <Button size="xs" onClick={onOpenTask}>
            Open task
          </Button>
        ) : null}
        <Button size="xs" onClick={() => window.api.sys.openExternal(pr.url)}>
          GitHub ↗
        </Button>
        <Button size="xs" variant={c.state === 'pass' && pr.review !== 'changes' && !pr.conflicts && !pr.draft ? 'primary' : undefined} disabled={pr.draft || pr.conflicts} onClick={onMerge} title={pr.draft ? 'A draft - mark it ready on GitHub first' : pr.conflicts ? 'It has conflicts - update its branch first' : 'Merge it on GitHub'}>
          Merge
        </Button>
      </div>
    </div>
  )
}
