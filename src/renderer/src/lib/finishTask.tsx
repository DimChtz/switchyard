import React, { useState } from 'react'
import type { Prefs, Project, Task } from '@shared/types'
import type { Action } from '../store/types'
import { choose, confirm, Segmented } from '../components/ui'
import { errText } from './errors'
import { baseOf } from './stack'
import { checkoutsOf } from './multiRepo'
import { finishGone, finishInPlace, finishWithPr, freshPr, mergeTask, taskDirty } from './taskActions'
import { killTaskSessions } from './agentControl'

type Dispatch = (action: Action) => void
type Method = Prefs['prMergeMethod']
type Pr = NonNullable<Task['pr']>

const METHOD_LABEL: Record<Method, string> = { squash: 'Squash', merge: 'Merge commit', rebase: 'Rebase' }

/**
 * Done, for a started task (dropped on Done, or the workspace's finish).
 * - Its pull request merged on GitHub (checked now, not as of the last look): it closes out.
 * - Open: asks - merge it on GitHub and finish, or finish and leave it open.
 * - Closed without merging: asks before finishing (the branch stays).
 * - No pull request: the branch is merged here (nothing to merge: no merge commit).
 * Leftover changes need a decision first.
 */
export async function finishTask(task: Task, project: Project, prefs: Prefs, dispatch: Dispatch, projects: Project[] = [project]): Promise<boolean> {
  if (task.inPlace) return finishInPlace(task, dispatch)
  const pr = await freshPr(task, dispatch)
  if (pr?.state === 'MERGED') return finishMerged(task, pr, project, dispatch, projects)
  // Settings → Board: a task in Review waits for its pull request's approval.
  if (prefs.reviewNeedsApproval && task.col === 'review' && pr?.state === 'OPEN' && task.prDetails?.reviewDecision !== 'APPROVED') {
    dispatch({ type: 'TOAST', text: `${task.key} stays in Review until PR #${pr.number ?? ''} is approved (Settings → Board).` })
    return false
  }
  if (pr?.state === 'CLOSED') {
    const ok = await confirm({
      title: `PR #${pr.number ?? ''} was closed without merging`,
      body: `Finish ${task.key} anyway? Its worktree is removed; the branch ${task.branch ?? ''} stays, with its commits.`,
      confirmLabel: 'Finish anyway'
    })
    return ok ? finishWithPr({ ...task, pr }, project, dispatch, projects) : false
  }
  if (pr) return finishOpenPr(task, pr, project, prefs, dispatch, projects)
  // Its worktree folder deleted outside Switchyard: the branch is what's left to finish with.
  if (task.worktreePath && !(await window.api.git.isCheckout(task.worktreePath).catch(() => true))) return finishGone(task, project, prefs, dispatch, projects)
  const dirty = await taskDirty(task, projects)
  if (dirty > 0) {
    dispatch({ type: 'OPEN_TASK', taskId: task.id, tab: 'changes' })
    dispatch({ type: 'TOAST', text: `${task.key} has ${dirty} uncommitted change${dirty > 1 ? 's' : ''} - commit or discard them, then Merge & finish.` })
    return false
  }
  return mergeTask(task, project, prefs, dispatch, false, projects)
}

/**
 * A merged pull request: the task closes out - unless its worktree holds work
 * the pull request doesn't (uncommitted changes, commits never pushed). Then
 * it's asked: finish and keep the worktree and branch as they are (nothing is
 * deleted), or look at the changes first.
 */
async function finishMerged(task: Task, pr: Pr, project: Project, dispatch: Dispatch, projects: Project[]): Promise<boolean> {
  const refused = task.worktreePath && task.branch ? await window.api.git.closeCheck(task.worktreePath, task.branch, baseOf(task, project), pr.url).catch(() => null) : null
  if (!refused) return finishWithPr({ ...task, pr }, project, dispatch, projects)
  const n = pr.number ? `#${pr.number}` : ''
  const answer = await choose({
    title: `PR ${n} is merged - but ${task.key}'s worktree has more`,
    body: `${refused} Finish ${task.key} and keep its worktree and branch as they are (nothing is deleted - remove them from Worktrees later), or open its changes first.`,
    confirmLabel: 'Finish, keep worktree',
    altLabel: 'Open changes'
  })
  if (answer === 'alt') dispatch({ type: 'OPEN_TASK', taskId: task.id, tab: 'changes' })
  if (answer !== 'confirm') return false
  await killTaskSessions(task.id)
  dispatch({
    type: 'FINISH_TASK',
    taskId: task.id,
    note: `PR ${n} merged · worktree and branch kept (they had work the PR doesn't): ${task.worktreePath ?? ''}`,
    toast: `${task.key} is done - its worktree is kept, with what wasn't in PR ${n}.`
  })
  return true
}

/** An open pull request: merge it on GitHub and finish, or finish and leave it open - asked. */
async function finishOpenPr(task: Task, pr: Pr, project: Project, prefs: Prefs, dispatch: Dispatch, projects: Project[]): Promise<boolean> {
  const cwd = task.worktreePath!
  // Work that isn't in the pull request would be left out of the merge (and lost with the worktree): first.
  const refused = await window.api.git.closeCheck(cwd, task.branch!, baseOf(task, project), pr.url).catch((err: unknown) => errText(err))
  if (refused) {
    dispatch({ type: 'OPEN_TASK', taskId: task.id, tab: 'changes' })
    dispatch({ type: 'TOAST', text: `Not finished: ${refused}` })
    return false
  }
  const methods = await window.api.git.prMergeMethods(cwd).catch((): Method[] => ['squash', 'merge', 'rebase'])
  const picked = { method: methods.includes(prefs.prMergeMethod) ? prefs.prMergeMethod : methods[0] }
  // The other repositories' open pull requests (a task in several) are merged with it.
  const others = checkoutsOf(task, projects)
    .slice(1)
    .map((c) => ({ c, pr: task.repoPrs?.[c.project.id] }))
    .filter((x): x is { c: (typeof x)['c']; pr: Pr } => !!x.pr && x.pr.state === 'OPEN' && !!x.c.path)
  const n = pr.number ? `#${pr.number}` : ''
  const answer = await choose({
    title: `Merge PR ${n} and finish ${task.key}?`,
    body: <MergeChoice methods={methods} initial={picked.method} onChange={(m) => (picked.method = m)} others={others.map((o) => `${o.c.project.name} #${o.pr.number ?? ''}`)} />,
    confirmLabel: others.length ? `Merge ${others.length + 1} PRs & finish` : 'Merge PR & finish',
    altLabel: 'Finish, keep PR open'
  })
  if (!answer) return false
  if (answer === 'alt') return finishWithPr({ ...task, pr }, project, dispatch, projects)
  try {
    for (const o of others) {
      await window.api.git.mergePr(o.c.path!, o.pr.url, picked.method)
      dispatch({ type: 'SET_TASK_REPO_PR', taskId: task.id, repoId: o.c.project.id, pr: { ...o.pr, state: 'MERGED' } })
    }
    await window.api.git.mergePr(cwd, pr.url, picked.method)
  } catch (err) {
    dispatch({ type: 'OPEN_TASK', taskId: task.id })
    dispatch({ type: 'TOAST', text: `GitHub didn't merge PR ${n}: ${errText(err)}` })
    return false
  }
  const merged = { ...pr, state: 'MERGED' as const }
  dispatch({ type: 'SET_TASK_PR', taskId: task.id, pr: merged })
  const repoPrs = Object.fromEntries(Object.entries(task.repoPrs ?? {}).map(([id, p]) => [id, others.some((o) => o.c.project.id === id) ? { ...p, state: 'MERGED' as const } : p]))
  return finishWithPr({ ...task, pr: merged, repoPrs }, project, dispatch, projects)
}

function MergeChoice({ methods, initial, onChange, others }: { methods: Method[]; initial: Method; onChange: (m: Method) => void; others: string[] }): React.JSX.Element {
  const [method, setMethod] = useState(initial)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span>
        It&apos;s merged on GitHub{others.length ? ` with ${others.join(', ')}` : ''}, then the task goes to Done and its worktree and branch are removed. Or finish now and leave the pull request open - its branch stays.
      </span>
      {methods.length > 1 ? (
        <Segmented
          value={method}
          options={methods.map((m): [Method, string] => [m, METHOD_LABEL[m]])}
          onChange={(m) => {
            setMethod(m)
            onChange(m)
          }}
        />
      ) : (
        <span style={{ font: '12px var(--font-ui)', color: 'var(--t3)' }}>Merged with: {METHOD_LABEL[method]} (the only way this repository allows)</span>
      )}
    </div>
  )
}
