import type { Prefs, Project, Task } from '@shared/types'
import type { Action } from '../store/types'
import { agentSessionId, killTaskSessions, projectEnv, runCommandSession, setupSessionId, startAgent } from './agentControl'
import { checkoutsOf, repoDir, taskRoot } from './multiRepo'
import { errText } from './errors'
import { confirm, type MenuItem } from '../components/ui'
import { baseOf, unmergedParent } from './stack'

type Dispatch = (action: Action) => void

/** Commit message for "commit everything" on a task's behalf. */
export function commitMessageFor(task: Task): string {
  return `${task.key}: ${task.title}`
}

/** The task's worktrees: each of its repositories' (home first), for acting on all of them. */
function worktreesOf(task: Task, projects: Project[]): { project: Project; path: string }[] {
  return checkoutsOf(task, projects).flatMap((c) => (c.path ? [{ project: c.project, path: c.path }] : []))
}

/** Uncommitted changes across all the task's worktrees. */
export async function taskDirty(task: Task, projects: Project[]): Promise<number> {
  const counts = await Promise.all(worktreesOf(task, projects).map((w) => window.api.git.worktreeStatus(w.path, baseOf(task, w.project)).then((s) => s.dirty).catch(() => 0)))
  return counts.reduce((a, b) => a + b, 0)
}

/** Commits what's uncommitted in each of the task's worktrees (the ones with nothing to commit are skipped). */
async function commitEverywhere(task: Task, projects: Project[]): Promise<void> {
  for (const w of worktreesOf(task, projects)) {
    const { dirty } = await window.api.git.worktreeStatus(w.path, baseOf(task, w.project))
    if (dirty > 0) await window.api.git.commitAll(w.path, commitMessageFor(task))
  }
}

/**
 * Merge & finish: merges the task branch into the base branch (after
 * committing leftover changes when `commitFirst`), prunes per Settings, and
 * moves the task to Done. Resolves false (with a toast) when it didn't.
 */
export async function mergeTask(task: Task, project: Project, prefs: Prefs, dispatch: Dispatch, commitFirst = false, projects: Project[] = [project]): Promise<boolean> {
  if (!task.worktreePath || !task.branch) {
    dispatch({ type: 'TOAST', text: 'This task has no worktree to merge.' })
    return false
  }
  // Its branch has the changes of the task it builds on: that one is merged first.
  const parent = unmergedParent(task)
  if (parent) {
    dispatch({ type: 'TOAST', text: `Merge ${parent.key} first - ${task.key} builds on it, so this would bring ${parent.key}'s changes along.` })
    return false
  }
  const base = baseOf(task, project)
  // In several repositories: the others first, the home repository last (it may build on them).
  const all = worktreesOf(task, projects)
  const order = [...all.slice(1), all[0]].filter(Boolean)
  const merged: string[] = []
  try {
    if (commitFirst) await commitEverywhere(task, projects)
    const prune = prefs.pruneAfterMerge
    // Processes running in the worktree would lock the folder being removed.
    if (prune) await killTaskSessions(task.id)
    else await window.api.pty.kill(agentSessionId(task.id))
    // "closes #N" in a merge commit closes the issue once it's pushed to GitHub.
    const message = task.issue ? `Merge ${task.key}: ${task.title} (closes #${task.issue.number})` : undefined
    for (const w of order) {
      await window.api.git.mergeAndPrune(w.project.repoPath, w.path, task.branch, baseOf(task, w.project), prune, w.project.id === project.id ? message : undefined)
      merged.push(w.project.name)
    }
    if (prune && task.taskDir) await window.api.git.removeTaskDir(task.taskDir)
    const where = order.length > 1 ? ` in ${order.length} repos (${merged.join(' → ')})` : ''
    dispatch({
      type: 'FINISH_TASK',
      taskId: task.id,
      note: `Merged into ${base}${where}${task.issue ? ` · closes #${task.issue.number} on push` : ''} · ${prune ? 'worktree pruned' : 'worktree kept'}`,
      toast: task.issue ? `Merged into ${base}${where} - issue #${task.issue.number} closes when ${base} is pushed.` : `Merged ${task.branch} into ${base}${where}.`
    })
    return true
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not merge${merged.length ? ` (merged so far: ${merged.join(', ')})` : ''}: ${errText(err)}` })
    return false
  }
}

/**
 * Pushes the task branch and opens a pull request for it. With the GitHub
 * CLI it's created right away and remembered on the task; without it,
 * GitHub's compare page opens in the browser to finish it there.
 */
export async function openPullRequest(task: Task, project: Project, dispatch: Dispatch, commitFirst = false, projects: Project[] = [project]): Promise<boolean> {
  if (!task.worktreePath || !task.branch) return false
  // Building on a task that isn't merged: its pull request goes on top of that one's (stacked).
  const parent = unmergedParent(task)
  if (parent && !parent.pr) {
    dispatch({ type: 'TOAST', text: `Open ${parent.key}'s pull request first - ${task.key}'s goes on top of it.` })
    return false
  }
  const base = baseOf(task, project)
  const all = worktreesOf(task, projects)
  try {
    if (commitFirst) await commitEverywhere(task, projects)
    const body = [
      parent?.pr ? `Builds on ${parent.pr.number ? `#${parent.pr.number}` : parent.pr.url} (${parent.key}) - merge that one first.` : null,
      task.issue ? `Closes #${task.issue.number}` : null,
      task.desc?.trim(),
      all.length > 1 ? `One of ${all.length} linked pull requests (${all.map((w) => w.project.name).join(', ')}), branch ${task.branch}.` : null,
      `Task ${task.key}, made with ${task.agentKind ?? 'an agent'} in Switchyard.`
    ]
      .filter(Boolean)
      .join('\n\n')
    // The other repositories' pull requests first (each is remembered, to follow and to finish with).
    for (const w of all.slice(1)) {
      await window.api.git.push(w.path, task.branch)
      const other = await window.api.git.createPr(w.path, w.project.repoPath, task.branch, baseOf(task, w.project), task.title, body)
      if (other.number == null) await window.api.sys.openExternal(other.url)
      else dispatch({ type: 'SET_TASK_REPO_PR', taskId: task.id, repoId: w.project.id, pr: { url: other.url, number: other.number, state: other.state } })
    }
    await window.api.git.push(task.worktreePath, task.branch)
    const pr = await window.api.git.createPr(task.worktreePath, project.repoPath, task.branch, base, task.title, body)
    if (pr.number == null) {
      await window.api.sys.openExternal(pr.url)
      dispatch({ type: 'TOAST', text: `Pushed ${task.branch} - finish the pull request in your browser.` })
      return true
    }
    dispatch({ type: 'SET_TASK_PR', taskId: task.id, pr: { url: pr.url, number: pr.number, state: pr.state } })
    dispatch({ type: 'TOAST', text: pr.created ? `Opened pull request #${pr.number}.` : `Pushed - pull request #${pr.number} is updated.`, tone: 'done' })
    return true
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not open the pull request: ${errText(err)}` })
    return false
  }
}

/** Pushes new commits to the task's open pull request. */
export async function pushTask(task: Task, dispatch: Dispatch, commitFirst = false, projects: Project[] = []): Promise<void> {
  if (!task.worktreePath || !task.branch) return
  try {
    const all = worktreesOf(task, projects)
    if (commitFirst) {
      if (all.length) await commitEverywhere(task, projects)
      else await window.api.git.commitAll(task.worktreePath, commitMessageFor(task))
    }
    for (const w of all.length ? all : [{ path: task.worktreePath }]) await window.api.git.push(w.path, task.branch)
    dispatch({ type: 'TOAST', text: `Pushed ${task.branch}${all.length > 1 ? ` in ${all.length} repos` : ''}.` })
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not push: ${errText(err)}` })
  }
}

/**
 * Finishes a task whose work went out as a pull request: the worktree goes
 * (only when everything is committed and pushed), and once the PR is merged
 * the local branch too.
 */
export async function finishWithPr(task: Task, project: Project, dispatch: Dispatch, projects: Project[] = [project]): Promise<boolean> {
  if (!task.worktreePath || !task.branch || !task.pr) return false
  const merged = task.pr.state === 'MERGED'
  const others = worktreesOf(task, projects).slice(1)
  try {
    // Nothing is stopped or removed until every worktree can go without losing work.
    for (const w of [...others, { project, path: task.worktreePath }]) {
      const pr = w.project.id === project.id ? task.pr : task.repoPrs?.[w.project.id]
      const refused = await window.api.git.closeCheck(w.path, task.branch, baseOf(task, w.project), pr?.url)
      if (refused) throw new Error(others.length ? `${w.project.name}: ${refused}` : refused)
    }
    await killTaskSessions(task.id)
    // The other repositories' worktrees go too; a branch goes once its own pull request is merged
    // (one still open, or not known, keeps its branch).
    for (const w of others)
      await window.api.git.closeWithPr(w.project.repoPath, w.path, task.branch, baseOf(task, w.project), task.repoPrs?.[w.project.id]?.state === 'MERGED', task.repoPrs?.[w.project.id]?.url)
    await window.api.git.closeWithPr(project.repoPath, task.worktreePath, task.branch, baseOf(task, project), merged, task.pr.url)
    if (task.taskDir) await window.api.git.removeTaskDir(task.taskDir)
    const n = task.pr.number ? `#${task.pr.number}` : ''
    dispatch({
      type: 'FINISH_TASK',
      taskId: task.id,
      note: merged ? `PR ${n} merged · worktree pruned` : `PR ${n} open · worktree removed, branch kept`,
      toast: merged ? `Finished - PR ${n} is merged.` : `Worktree removed - PR ${n} stays open.`
    })
    return true
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not finish: ${errText(err)}` })
    return false
  }
}

/**
 * The task's pull request as GitHub has it now (merged or closed on the
 * website since the last check, say); the task is updated when it changed.
 * The last known state when GitHub can't be asked.
 */
export async function freshPr(task: Task, dispatch: Dispatch): Promise<Task['pr']> {
  if (!task.pr || !task.worktreePath) return task.pr ?? null
  const now = await window.api.git.prStatus(task.worktreePath, task.pr.url).catch(() => null)
  if (!now) return task.pr
  const pr = { url: now.url, number: now.number, state: now.state }
  if (now.state !== task.pr.state) dispatch({ type: 'SET_TASK_PR', taskId: task.id, pr })
  return pr
}

/**
 * Done, for a started task (dropped on Done, or the workspace's finish): a
 * pull request merged on GitHub - checked right now, not as of the last
 * look - closes it out; an open one stays; without one the branch is merged
 * here. Leftover changes need a decision first.
 */
export async function finishTask(task: Task, project: Project, prefs: Prefs, dispatch: Dispatch, projects: Project[] = [project]): Promise<boolean> {
  const pr = await freshPr(task, dispatch)
  if (pr?.state === 'MERGED') return finishWithPr({ ...task, pr }, project, dispatch, projects)
  if (pr) {
    dispatch({ type: 'OPEN_TASK', taskId: task.id })
    dispatch({
      type: 'TOAST',
      text: pr.state === 'CLOSED' ? `PR #${pr.number ?? ''} was closed without merging - reopen it, or delete the task.` : `PR #${pr.number ?? ''} is still open - merge it on GitHub, or Merge & finish here.`
    })
    return false
  }
  const dirty = await taskDirty(task, projects)
  if (dirty > 0) {
    dispatch({ type: 'OPEN_TASK', taskId: task.id, tab: 'changes' })
    dispatch({ type: 'TOAST', text: `${task.key} has ${dirty} uncommitted change${dirty > 1 ? 's' : ''} - commit or discard them, then Merge & finish.` })
    return false
  }
  return mergeTask(task, project, prefs, dispatch, false, projects)
}

/**
 * Done, for a task whose worktree folder was deleted outside Switchyard:
 * through its pull request when it has one (merged: the branch goes too);
 * otherwise git forgets the worktree and the branch stays - nothing of the
 * work that's committed is lost.
 */
export async function finishGone(task: Task, project: Project, dispatch: Dispatch, projects: Project[] = [project]): Promise<boolean> {
  const pr = await freshPr(task, dispatch)
  if (pr) return finishWithPr({ ...task, pr }, project, dispatch, projects)
  try {
    await killTaskSessions(task.id)
    for (const c of checkoutsOf(task, projects)) await window.api.git.pruneWorktrees(c.project.repoPath)
    if (task.taskDir) await window.api.git.removeTaskDir(task.taskDir).catch(() => {})
    dispatch({
      type: 'FINISH_TASK',
      taskId: task.id,
      note: `Worktree was gone · branch ${task.branch ?? ''} kept`,
      toast: `${task.key} is done - its branch ${task.branch ?? ''} is kept.`
    })
    return true
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not finish: ${errText(err)}` })
    return false
  }
}

/** Checks the task's branch out again where its worktree was (from the base branch when the branch is gone too). */
export async function recreateWorktree(task: Task, project: Project, dispatch: Dispatch): Promise<boolean> {
  if (!task.worktreePath || !task.branch) return false
  try {
    await window.api.git.pruneWorktrees(project.repoPath)
    await window.api.git.addWorktree(project.repoPath, task.worktreePath, task.branch, baseOf(task, project))
    if (project.copyFiles?.length) await window.api.git.copyIntoWorktree(project.repoPath, task.worktreePath, project.copyFiles).catch(() => [])
    dispatch({ type: 'TOAST', text: `Recreated ${task.key}'s worktree on ${task.branch}.`, tone: 'done' })
    return true
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not recreate the worktree: ${errText(err)}` })
    return false
  }
}

/**
 * Deletes a task. Its terminals stop; with `removeWorktree` its worktree and
 * branch go too (uncommitted work included), otherwise they stay on disk and
 * show up under Worktrees.
 */
export async function deleteTask(task: Task, project: Project, dispatch: Dispatch, removeWorktree: boolean, projects: Project[] = [project]): Promise<void> {
  await killTaskSessions(task.id)
  if (removeWorktree && task.worktreePath && task.branch) {
    try {
      for (const w of worktreesOf(task, projects).slice(1)) await window.api.git.discardWorktree(w.project.repoPath, w.path, task.branch)
      await window.api.git.discardWorktree(project.repoPath, task.worktreePath, task.branch)
      if (task.taskDir) await window.api.git.removeTaskDir(task.taskDir)
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not remove the worktree: ${errText(err)}` })
      return
    }
  }
  const kept = !removeWorktree && task.worktreePath
  dispatch({ type: 'DELETE_TASK', taskId: task.id, toast: kept ? `Deleted ${task.key} - its worktree is kept (see Worktrees).` : `Deleted ${task.key}.` })
}

/**
 * Removes a project from Switchyard, after asking: its tasks leave the
 * board and its agents stop. The repository, branches and worktrees stay.
 */
export async function removeProject(project: Project, tasks: Task[], dispatch: Dispatch): Promise<boolean> {
  const own = tasks.filter((t) => t.projectId === project.id)
  const live = own.filter((t) => t.agentKind && t.col !== 'done')
  const ok = await confirm({
    title: `Remove ${project.name} from Switchyard?`,
    body: `Its ${own.length} task${own.length === 1 ? '' : 's'} leave the board${live.length ? ` and ${live.length} running agent${live.length > 1 ? 's are' : ' is'} stopped` : ''}. The repository, its branches and worktrees stay on disk.`,
    detail: project.repoPath,
    confirmLabel: 'Remove project',
    danger: true
  })
  if (!ok) return false
  await Promise.all(live.map((t) => killTaskSessions(t.id)))
  await window.api.store.removeProject(project.id)
  dispatch({ type: 'REMOVE_PROJECT', id: project.id })
  return true
}

/** The task menus' two Delete items: asks first, saying what goes and what stays. */
export function deleteTaskItems(task: Task, project: Project | undefined, dispatch: Dispatch, projects: Project[] = project ? [project] : []): MenuItem[] {
  const repoNames = checkoutsOf(task, projects).map((c) => c.project.name)
  const ask = async (removeWorktree: boolean): Promise<void> => {
    if (!project) return
    const ok = await confirm({
      title: `Delete ${task.key} “${task.title}”?`,
      body: !task.worktreePath
        ? 'The task is removed from the board.'
        : removeWorktree
          ? `Its ${repoNames.length > 1 ? `worktrees in ${repoNames.join(' and ')}` : 'worktree'} and branch ${task.branch ?? ''} are removed too - uncommitted work included. This can't be undone.`
          : `Its ${repoNames.length > 1 ? 'worktrees' : 'worktree'} and branch stay on disk; you find them under Worktrees.`,
      detail: removeWorktree ? (taskRoot(task) ?? undefined) : undefined,
      confirmLabel: removeWorktree ? 'Delete task and worktree' : 'Delete task',
      danger: true
    })
    if (ok) await deleteTask(task, project, dispatch, removeWorktree, projects)
  }
  return [
    { label: task.worktreePath ? 'Delete task, keep worktree…' : 'Delete task…', danger: true, separatorBefore: true, onClick: () => ask(false) },
    ...(task.worktreePath ? [{ label: 'Delete task and worktree…', danger: true, onClick: () => ask(true) }] : [])
  ]
}

/**
 * Attaches another project's repository to a task: the same branch, a
 * worktree next to the task's own in its folder. Before the task starts it
 * only joins the list. A task with one worktree first moves it into a task
 * folder - its processes stop for that (a running process keeps a folder
 * locked), and its agent restarts there.
 */
export async function attachRepo(task: Task, repo: Project, projects: Project[], prefs: Prefs, dispatch: Dispatch): Promise<void> {
  const home = projects.find((p) => p.id === task.projectId)
  if (!home) return
  const repos = [...(task.repos ?? []).filter((r) => r !== repo.id), repo.id]
  if (!task.worktreePath || !task.branch) {
    dispatch({ type: 'SET_TASK_REPOS', taskId: task.id, repos })
    dispatch({ type: 'TOAST', text: `Added ${repo.name} to ${task.key} - it gets a worktree when the task starts.` })
    return
  }
  const branch = task.branch
  let taskDir = task.taskDir ?? null
  let homePath = task.worktreePath
  let restart = false
  try {
    if (!taskDir) {
      const running = await window.api.pty.exists(agentSessionId(task.id))
      const ok = await confirm({
        title: `Attach ${repo.name} to ${task.key}?`,
        body: `${task.key}'s worktree moves into a task folder, with ${repo.name}'s next to it on ${branch}. Its terminals stop${running ? ', and the agent restarts in the new folder' : ''}.`,
        detail: `${home.name} + ${repo.name}`,
        confirmLabel: 'Attach'
      })
      if (!ok) return
      await killTaskSessions(task.id)
      taskDir = await window.api.git.suggestTaskDir(home.repoPath, task.key)
      homePath = joinPath(taskDir, repoDir(home))
      await retry(() => window.api.git.moveWorktree(home.repoPath, task.worktreePath!, homePath))
      restart = running
    }
    await window.api.git.createBranch(repo.repoPath, branch, baseOf(task, repo))
    const path = joinPath(taskDir, repoDir(repo))
    await window.api.git.addWorktree(repo.repoPath, path, branch)
    if (repo.copyFiles?.length) await window.api.git.copyIntoWorktree(repo.repoPath, path, repo.copyFiles).catch(() => [])
    dispatch({ type: 'SET_TASK_REPOS', taskId: task.id, repos, taskDir, worktreePath: homePath })

    const tell = `I attached ${repo.name} at ./${repoDir(repo)}, on ${branch} too${restart ? `, and moved ${home.name} to ./${repoDir(home)}` : ''}. Change it if the task needs it.`
    if (restart) await startAgent({ ...task, repos, taskDir, worktreePath: homePath }, home, prefs, 'resume', tell)
    else if (await window.api.pty.exists(agentSessionId(task.id))) window.api.pty.sendText(agentSessionId(task.id), tell)
    dispatch({ type: 'TOAST', text: `Attached ${repo.name} to ${task.key} · ${repos.length + 1} repos on ${branch}` })

    // Its setup runs in the background; say how it went.
    if (repo.setupCmd) {
      runCommandSession(`${setupSessionId(task.id)}-${repo.id}`, path, repo.setupCmd, projectEnv(repo), () => {})
        .then((code) => dispatch({ type: 'TOAST', text: code === 0 ? `${repo.name}: setup done.` : `${repo.name}: setup failed (exit ${code}) - run it in a terminal.` }))
        .catch(() => {})
    }
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not attach ${repo.name}: ${errText(err)}` })
  }
}

/** A folder's child, with the folder's own separator. */
function joinPath(dir: string, name: string): string {
  return `${dir}${dir.includes('\\') ? '\\' : '/'}${name}`
}

/** A process that just stopped can hold its folder a moment longer (Windows). */
async function retry(work: () => Promise<void>, times = 5): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      return await work()
    } catch (err) {
      if (i >= times) throw err
      await new Promise((r) => setTimeout(r, 400 * i))
    }
  }
}

/**
 * Before a task goes to Review: its acceptance criteria. Not all verified -
 * asks whether to move it anyway.
 */
export async function reviewReady(task: Task): Promise<boolean> {
  const list = task.criteria ?? []
  const open = list.filter((c) => c.status !== 'passed')
  if (!open.length) return true
  return confirm({
    title: `${open.length} of ${list.length} acceptance criteri${list.length === 1 ? 'on isn’t' : 'a aren’t'} verified`,
    body: 'Its agent can still verify them (Ask to verify, next to the terminal).',
    detail: open.map((c) => `${c.status === 'failed' ? '✕' : '○'} ${c.text}`).join('\n'),
    confirmLabel: 'Move to Review anyway'
  })
}
