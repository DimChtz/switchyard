import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react'
import { addNotice as recordNotice, loadNotices } from '../lib/notices'
import { startUpdateWatch } from '../lib/updates'
import type { Action, AppState } from './types'
import { initialState, reducer } from './reducer'
import { agentSessionId, killTaskSessions, projectEnv, runCommandSession, setupSessionId, startAgent, testsSessionId } from '../lib/agentControl'
import { tailLines } from '../lib/ptyTail'
import { startPlugins } from '../lib/plugins'
import { busyAgents, hasTools, knowKeyHigh, nextTaskKey, queuedTasks } from '../lib/derive'
import { checksMessage, prSummary } from '@shared/pr'
import type { AgentStatusUpdate, KeybindingsState, Project, SettingsFileError, Task } from '@shared/types'
import { chainCommands, repoCommands, repoDir, taskRoot } from '../lib/multiRepo'
import { saveBoardPrefs } from '../lib/boardFilter'
import { criteriaMessage } from '../lib/criteria'
import { onHeld } from '../lib/team'

/** A worktree (and branch, '' if it was there already) a launch made in one of the task's other repositories. */
interface Made {
  repoPath: string
  path: string
  branch: string
}
import { AGENTS } from '@shared/constants'
import { errText } from '../lib/errors'
import { inParens, setUserBindings } from '../lib/shortcuts'
import { clock, waitingText, wakeAt } from '../lib/status'
import { prefsFor } from '../lib/projectPrefs'
import { discoverPr, finishWithPr } from '../lib/taskActions'
import { closeNoteTabs, renameNoteTabs } from '../lib/wsStore'
import { baseFor, parentFinished } from '@shared/stack'
import { isStarted } from '@shared/scratch'
import { knowTasks } from '../lib/stack'

interface Ctx {
  state: AppState
  dispatch: React.Dispatch<Action>
}

const StoreContext = createContext<Ctx | null>(null)

const RETRY_MESSAGE = 'The previous run exited with an error. Check what went wrong and continue.'

/**
 * Tasks persisted as working/waiting whose agent isn't actually running any
 * more (e.g. the app was restarted) are shown as paused, and running agents
 * get their latest detected status.
 */
async function reconcileTasks(tasks: Task[]): Promise<Task[]> {
  const statuses = await window.api.agents.currentStatus()
  const byTask = new Map(statuses.map((s) => [s.taskId, s]))
  return Promise.all(
    tasks.map(async (t) => {
      if (t.lastTest?.status === 'running' && !(await window.api.pty.exists(testsSessionId(t.id)))) t = { ...t, lastTest: null }
      const live = byTask.get(t.id)
      if (live) return { ...t, st: live.st, ask: live.ask, askKind: live.askKind }
      if (t.st !== 'working' && t.st !== 'waiting') return t
      const running = await window.api.pty.exists(agentSessionId(t.id))
      if (running) return t
      // The app was closed while it worked: count the stretch up to its last activity.
      const workMs = (t.workMs ?? 0) + (t.workingSince ? Math.max(0, t.lastActivityAt - t.workingSince) : 0)
      return { ...t, st: 'paused' as const, ask: null, askKind: null, workMs, workingSince: null }
    })
  )
}

export function AppStoreProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, rawDispatch] = useReducer(reducer, undefined, initialState)
  const hydratedRef = useRef(false)
  // What a launch made in the task's other repositories, to undo when it's cancelled.
  const madeRef = useRef(new Map<string, Made[]>())
  const stateRef = useRef(state)
  stateRef.current = state
  knowTasks(state.tasks)
  knowKeyHigh(state.keyHigh)

  // Actions that talk to a running agent do so here, next to the reducer
  // update, so every caller (buttons, shortcuts, palette) gets the real
  // effect without repeating it.
  const dispatch = useCallback((action: Action) => {
    const s = stateRef.current
    const task = 'taskId' in action ? s.tasks.find((t) => t.id === action.taskId) : undefined
    const project = task ? s.projects.find((p) => p.id === task.projectId) : undefined
    const sessionId = task ? agentSessionId(task.id) : ''

    const restart = (followUp?: string): void => {
      if (!task || !project) return
      startAgent(task, project, prefsFor(s, project.id), 'resume', followUp).catch((err: unknown) =>
        rawDispatch({ type: 'TOAST', text: `Could not start the agent: ${errText(err)}` })
      )
    }

    // The notification center keeps what happened, window in front or not -
    // the kinds chosen in Settings, and nothing from a muted project.
    const muted = !!task && s.prefs.mutedProjects.includes(task.projectId)
    const addNotice = (n: Parameters<typeof recordNotice>[0]): void => {
      if (s.prefs.noticeKinds.includes(n.kind)) recordNotice(n)
    }
    if (task && !muted) {
      const name = AGENTS.find((a) => a.kind === task.agentKind)?.name ?? 'The agent'
      const base = { taskId: task.id, taskKey: task.key, taskTitle: task.title, projectId: task.projectId }
      if (action.type === 'AGENT_STATUS' && task.st === 'working' && task.col !== 'done') {
        const u = action.update
        if (u.st === 'failed') addNotice({ ...base, kind: 'failed', text: `${name} failed`, detail: u.ask ?? null })
        else if (u.st === 'waiting')
          addNotice({ ...base, kind: u.askKind === 'permission' ? 'permission' : 'waiting', text: `${name} ${waitingText(u.askKind, u.ask)}`, detail: u.ask ?? u.activity ?? null })
        else if (u.st === 'done') addNotice({ ...base, kind: 'done', text: `${name} finished - ready for review`, detail: null })
      } else if (action.type === 'TESTS_FINISHED')
        addNotice({ ...base, kind: action.exitCode === 0 ? 'tests-passed' : 'tests-failed', text: action.exitCode === 0 ? 'Tests passed' : `Tests failed (exit ${action.exitCode ?? '?'})`, detail: null })
      else if (action.type === 'FINISH_TASK') addNotice({ ...base, kind: 'finished', text: 'Task finished', detail: action.note ?? null })
      else if (action.type === 'SET_TASK_PR' && action.pr?.state === 'MERGED' && task.pr?.state !== 'MERGED')
        addNotice({ ...base, kind: 'pr-merged', text: `Pull request ${action.pr.number ? `#${action.pr.number} ` : ''}merged`, detail: null })
    }

    // System notifications (Settings → General), only while the window
    // isn't in front - otherwise the toast already says it.
    if (task && !muted && !document.hasFocus()) {
      const name = AGENTS.find((a) => a.kind === task.agentKind)?.name ?? 'The agent'
      if (action.type === 'AGENT_STATUS' && task.st === 'working' && isStarted(task) && task.col !== 'done') {
        const u = action.update
        if (s.prefs.notifyInput && (u.st === 'waiting' || u.st === 'failed')) {
          const what = u.st === 'failed' ? 'failed' : waitingText(u.askKind, u.ask)
          // Answer right from the notification: approve or deny a permission, retry a failure.
          const actions =
            u.st === 'failed'
              ? [{ id: 'retry', label: 'Retry' }]
              : u.askKind === 'permission'
                ? [
                    { id: 'yes', label: 'Approve' },
                    { id: 'no', label: 'Deny' }
                  ]
                : []
          window.api.sys.notify(`${name} ${what}`, `${task.key} · ${task.title}${u.ask ? `
${u.ask}` : ''}`, task.id, actions)
        } else if (s.prefs.notifyDone && u.st === 'done') {
          window.api.sys.notify('Ready for review', `${name} finished ${task.key} · ${task.title}`, task.id)
        }
      } else if (action.type === 'TESTS_FINISHED' && action.exitCode === 0 && s.prefs.notifyDone) {
        window.api.sys.notify('Tests passed', `${task.key} · ${task.title} is ready for review`, task.id)
      }
    }

    // A note's tabs (the Notes screen's and every workspace's) follow it: a new id when its title
    // became a new file name, and they close when it's deleted.
    if (action.type === 'NOTE_SAVED' && action.replaces) renameNoteTabs(action.replaces, action.note.id)
    else if (action.type === 'NOTE_DELETED') closeNoteTabs(action.id)

    // The shortcut lookup reads these outside React (menus, key handling).
    if (action.type === 'KEYBINDINGS_LOADED') setUserBindings(action.bindings)

    if (action.type === 'SET_PREFS') {
      window.api.prefs.set(action.patch).catch((err: unknown) => {
        rawDispatch({ type: 'TOAST', text: `Could not save the setting: ${errText(err)}` })
        // Show what is really in effect again.
        window.api.prefs.get().then((prefs) => rawDispatch({ type: 'PREFS_LOADED', prefs }))
      })
    }

    if (task && action.type === 'PAUSE_TASK') {
      // Esc interrupts the current turn in claude/codex/gemini.
      window.api.pty.write(sessionId, '\x1b')
    } else if (task && action.type === 'RESUME_TASK') {
      window.api.pty.exists(sessionId).then((running) => {
        if (running) window.api.pty.sendText(sessionId, 'Please continue.')
        else restart()
      })
    } else if (task && action.type === 'WAKE_TASK') {
      // The usage limit has reset: on from where it stopped.
      const text = 'Your usage limit has reset - please continue where you left off.'
      window.api.pty.exists(sessionId).then((running) => {
        if (running) window.api.pty.sendText(sessionId, text)
        else restart(text)
      })
    } else if (task && action.type === 'MESSAGE_AGENT') {
      // Several lines stay several lines (sent as a paste - see the pty's sendText).
      const text = action.text.trim()
      window.api.pty.exists(sessionId).then((running) => {
        if (running) window.api.pty.sendText(sessionId, text)
        else restart(text)
      })
    } else if (task && action.type === 'RUN_TESTS') {
      // Each of the task's repositories that has a test command, one after another.
      const steps = repoCommands(task, s.projects, 'testCmd')
      if (!steps.length || !task.worktreePath) {
        rawDispatch({ type: 'TOAST', text: `No test command set for this project - add one in Project settings${inParens('project-settings')}.` })
        return
      }
      const cwd = steps.length > 1 ? (taskRoot(task) ?? task.worktreePath) : steps[0].cwd
      const env = Object.assign({}, ...[...steps].reverse().map((st) => projectEnv(st.project))) as Record<string, string>
      // Mark the run as started only once the new process exists, so the
      // tests tab never attaches to the previous run's output.
      window.api.pty
        .spawn({ id: testsSessionId(task.id), cwd, execCommand: chainCommands(steps, cwd.includes('\\')), env, cols: 120, rows: 30 })
        .then(() => rawDispatch(action))
        .catch((err: unknown) => {
          rawDispatch({ type: 'TOAST', text: `Could not run tests: ${errText(err)}` })
        })
      return
    } else if (action.type === 'CLOSE_START_MODAL' && s.start?.phase === 'launch') {
      // Cancelling a launch (after a step failed) undoes the worktree and
      // branch it created, so nothing half-made is left behind. A branch
      // that was already there is kept.
      const st = s.start
      const t = s.tasks.find((x) => x.id === st.taskId)
      const p = t ? s.projects.find((x) => x.id === t.projectId) : undefined
      window.api.pty.kill(setupSessionId(st.taskId))
      window.api.pty.kill(agentSessionId(st.taskId))
      const newBranch = st.branchInfo && !st.branchInfo.existed ? st.branch : ''
      // (In the project's own checkout nothing was made - and that checkout is never removed.)
      // (Nor a worktree that was already there: the task was only going to take it over.)
      if (p && !st.inPlace && !st.existingWorktree && (st.worktreePath || newBranch)) {
        window.api.git.discardWorktree(p.repoPath, st.worktreePath ?? '', newBranch).catch((err: unknown) =>
          rawDispatch({ type: 'TOAST', text: `Could not remove the worktree: ${errText(err)}` })
        )
      }
      // The other repositories' worktrees and new branches, and the task folder.
      const made = madeRef.current.get(st.taskId) ?? []
      madeRef.current.delete(st.taskId)
      Promise.all(made.filter((m) => m.path || m.branch).map((m) => window.api.git.discardWorktree(m.repoPath, m.path, m.branch)))
        .catch((err: unknown) => rawDispatch({ type: 'TOAST', text: `Could not remove a worktree: ${errText(err)}` }))
        .finally(() => st.taskDir && window.api.git.removeTaskDir(st.taskDir))
    } else if (task && action.type === 'DELETE_TASK') {
      killTaskSessions(task.id)
      window.api.store.clearTaskData([task.id])
    } else if (task && action.type === 'FINISH_TASK') {
      killTaskSessions(task.id)
      window.api.store.clearTaskData([task.id])
    } else if (action.type === 'CLEAR_DONE') {
      window.api.store.clearTaskData(s.tasks.filter((t) => t.projectId === action.projectId && t.col === 'done').map((t) => t.id))
    } else if (action.type === 'REMOVE_PROJECT') {
      // Its agents, shells and dev servers stop; worktrees and branches stay on disk.
      for (const t of s.tasks.filter((x) => x.projectId === action.id)) killTaskSessions(t.id)
    } else if (task && action.type === 'ANSWER_TASK') {
      // The folder-trust question defaults to "No, exit": pick "Yes" first.
      if (action.answer === 'yes' && task.ask?.startsWith('Trust this folder')) {
        window.api.pty.write(sessionId, '\x1b[B')
        setTimeout(() => window.api.pty.write(sessionId, '\r'), 150)
      } else if (action.answer === 'yes') window.api.pty.write(sessionId, '\r')
      else if (action.answer === 'no') window.api.pty.write(sessionId, '\x1b')
      else
        window.api.pty.exists(sessionId).then((running) => {
          if (running) window.api.pty.sendText(sessionId, RETRY_MESSAGE)
          else restart(RETRY_MESSAGE)
        })
    }
    rawDispatch(action)
  }, [])

  // The notification center's history.
  useEffect(loadNotices, [])

  // What agents ask Switchyard through its tools (MCP): cards, questions, test results.
  useEffect(
    () =>
      window.api.agents.onToolRequest((id, req) => {
        const s = stateRef.current
        const task = s.tasks.find((t) => t.id === req.taskId)
        const reply = (result: unknown, error?: string): void => {
          if (id) window.api.agents.toolReply(id, result, error)
        }
        if (!task) return reply(null, 'This task is no longer on the board.')
        const name = AGENTS.find((a) => a.kind === task.agentKind)?.name ?? 'The agent'
        if (req.kind === 'tests-finished') return dispatch({ type: 'TESTS_FINISHED', taskId: task.id, exitCode: req.exitCode ?? -1 })
        if (req.kind === 'note') return rawDispatch({ type: 'TOAST', text: `${task.key}: ${req.text}` })
        if (req.kind === 'verify-criterion') {
          if (!task.criteria?.[req.index]) return reply(null, 'That criterion is gone.')
          dispatch({ type: 'VERIFY_CRITERION', taskId: task.id, index: req.index, passed: req.passed, note: req.note, image: req.image })
          return reply(true)
        }
        if (req.kind === 'create-task') {
          const project = s.projects.find((p) => p.id === task.projectId)
          if (!project) return reply(null, 'The project is gone.')
          const key = nextTaskKey(s.tasks, project, s.keyHigh)
          dispatch({
            type: 'AGENT_ADD_TASK',
            key,
            projectId: project.id,
            title: req.title,
            desc: req.description,
            col: req.ready ? 'ready' : 'backlog',
            buildsOn: req.buildsOn ? task.id : null,
            toast: `${name} added ${key} to the board${req.buildsOn ? `, building on ${task.key}` : ''}: ${req.title}`
          })
          return reply(key)
        }
        if (req.kind === 'ask-user') {
          const muted = s.prefs.mutedProjects.includes(task.projectId)
          rawDispatch({ type: 'TOAST', text: `${task.key}: ${name} asks - ${req.question}`, tone: 'waiting' })
          if (!muted && s.prefs.noticeKinds.includes('agent-question'))
            recordNotice({ kind: 'agent-question', taskId: task.id, taskKey: task.key, taskTitle: task.title, projectId: task.projectId, text: `${name} asks`, detail: req.question })
          if (!muted && !document.hasFocus()) window.api.sys.notify(`${name} asks`, `${task.key} · ${req.question}`, task.id)
          return reply(true)
        }
      }),
    [dispatch]
  )

  // Two agents kept messaging each other: the rest waits for you (Team).
  useEffect(
    () =>
      onHeld((m) => {
        const s = stateRef.current
        const a = s.tasks.find((t) => t.id === m.from)
        const b = s.tasks.find((t) => t.id === m.to)
        const text = `${a?.key ?? m.from} and ${b?.key ?? m.to} keep messaging each other - the next is held`
        rawDispatch({ type: 'TOAST', text: `${text} (Team).`, tone: 'waiting' })
        if (s.prefs.noticeKinds.includes('team')) recordNotice({ kind: 'team', taskId: m.to, taskKey: b?.key ?? '', taskTitle: b?.title ?? '', projectId: b?.projectId ?? '', text, detail: m.text.slice(0, 200) })
      }),
    []
  )

  // An agent answered review comments (Claude Code: after its turn).
  useEffect(
    () =>
      window.api.store.onCommentsChanged(({ taskId, replies }) => {
        const s = stateRef.current
        const task = s.tasks.find((t) => t.id === taskId)
        if (!task || !replies) return
        const name = AGENTS.find((a) => a.kind === task.agentKind)?.name ?? 'The agent'
        const text = `${name} answered ${replies} review comment${replies === 1 ? '' : 's'}`
        rawDispatch({ type: 'TOAST', text: `${task.key}: ${text}` })
        if (s.prefs.noticeKinds.includes('review-reply') && !s.prefs.mutedProjects.includes(task.projectId))
          recordNotice({ kind: 'review-reply', taskId: task.id, taskKey: task.key, taskTitle: task.title, projectId: task.projectId, text, detail: null })
      }),
    []
  )

  useEffect(() => {
    let cancelled = false
    async function hydrate(): Promise<void> {
      const [projects, tasks, prefs, high] = await Promise.all([window.api.store.getProjects(), window.api.store.getTasks(), window.api.prefs.get(), window.api.store.keyHigh()])
      const reconciled = await reconcileTasks(tasks)
      if (!cancelled) dispatch({ type: 'HYDRATE', projects, tasks: reconciled, prefs, keyHigh: high })
      hydratedRef.current = true
    }
    hydrate()
    return () => {
      cancelled = true
    }
  }, [dispatch])

  useEffect(() => window.api.agents.onStatus((update: AgentStatusUpdate) => dispatch({ type: 'AGENT_STATUS', update })), [dispatch])

  // Settings files edited outside the app: settings.json applies at once (or
  // says what's wrong with it); a repository's .switchyard files reload the projects.
  useEffect(() => {
    const showError = (err: SettingsFileError): void =>
      dispatch({ type: 'TOAST', text: `${err.file.split(/[\\/]/).pop()} has an error (${err.message}) - what it had before stays in use.` })
    window.api.settings.userError().then((err) => err && showError(err))
    // keybindings.json: an error keeps the last good shortcuts; skipped entries are named once.
    const loadKeys = (k: KeybindingsState): void => {
      if (k.error) showError({ file: 'keybindings.json', message: k.error })
      else dispatch({ type: 'KEYBINDINGS_LOADED', bindings: k.bindings })
      if (k.problems.length) dispatch({ type: 'TOAST', text: `keybindings.json: ${k.problems.join(' · ')} - skipped.` })
    }
    window.api.keybindings.get().then(loadKeys)
    const offKeys = window.api.keybindings.onChanged(loadKeys)
    const offPrefs = window.api.prefs.onChanged((prefs) => dispatch({ type: 'PREFS_LOADED', prefs }))
    const offError = window.api.settings.onError(showError)
    const offProjects = window.api.projects.onChanged(() => window.api.store.getProjects().then((projects) => dispatch({ type: 'PROJECTS_LOADED', projects })))
    return () => {
      offPrefs()
      offKeys()
      offError()
      offProjects()
    }
  }, [dispatch])

  // Automatic worktree cleanup (Settings → Git) ran in the background.
  useEffect(
    () =>
      window.api.git.onPruned((pruned) =>
        dispatch({ type: 'TOAST', text: `Cleaned up ${pruned.length} stale worktree${pruned.length > 1 ? 's' : ''}: ${pruned.join(', ')}` })
      ),
    [dispatch]
  )

  // Notes: loaded from the notes folder, again when files change there
  // (another editor, a sync client) or the folder itself is changed.
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      window.api.notes
        .list()
        .then((notes) => !cancelled && dispatch({ type: 'NOTES_LOADED', notes }))
        .catch(() => {})
    }
    load()
    const off = window.api.notes.onChanged(load)
    return () => {
      cancelled = true
      off()
    }
  }, [dispatch, state.prefs.notesDir])

  // Plugins: their agents and commands, and what they ask for.
  useEffect(() => startPlugins(dispatch, () => stateRef.current), [dispatch])

  // Clicking a system notification opens its task.
  useEffect(() => window.api.sys.onOpenTask((taskId) => dispatch({ type: 'OPEN_TASK', taskId })), [dispatch])
  // Its Approve / Deny / Retry buttons answer the agent - if it's still asking.
  useEffect(
    () =>
      window.api.sys.onNotifyAction((taskId, actionId) => {
        const task = stateRef.current.tasks.find((t) => t.id === taskId)
        if (!task) return
        const asking = actionId === 'retry' ? task.st === 'failed' : task.st === 'waiting' && task.askKind === 'permission'
        if (!asking) return
        dispatch({ type: 'ANSWER_TASK', taskId, answer: actionId as 'yes' | 'no' | 'retry' })
      }),
    [dispatch]
  )

  // Test runs finish whether or not their terminal tab is open.
  useEffect(
    () =>
      window.api.pty.onExit((id, exitCode) => {
        if (id.startsWith('tests-')) dispatch({ type: 'TESTS_FINISHED', taskId: id.slice('tests-'.length), exitCode })
      }),
    [dispatch]
  )

  useEffect(() => {
    if (!hydratedRef.current) return
    const t = setTimeout(() => {
      window.api.store.setTasks(state.tasks)
    }, 300)
    return () => clearTimeout(t)
  }, [state.tasks])

  // Closing the window right after a change: the last 300 ms aren't lost.
  useEffect(() => {
    const flush = (): void => {
      if (hydratedRef.current) window.api.store.setTasksNow(stateRef.current.tasks)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // Keeping main current: each project's base branch against origin.
  useEffect(() => {
    window.api.base.list().then((statuses) => dispatch({ type: 'BASE_STATUS', statuses }))
    return window.api.base.onChanged((statuses) => dispatch({ type: 'BASE_STATUS', statuses }))
  }, [dispatch])

  // A new version (the installed app): the status bar, the bell and - in the background - the system say so.
  useEffect(() => startUpdateWatch(), [])

  // The pull request loop: open PRs' checks and reviews, every two minutes,
  // for every task that has one (not only the one on screen) - a merge,
  // failing checks and requested changes reach the board and the bell.
  useEffect(() => {
    let stopped = false
    const poll = async (): Promise<void> => {
      // Pull requests opened elsewhere (by the agent, on github.com) for a task's branch: found first.
      for (const t of stateRef.current.tasks.filter((x) => !x.pr && x.worktreePath && x.branch && x.col !== 'done' && !x.archivedAt)) {
        if (stopped) return
        await discoverPr(t, dispatch)
      }
      const s = stateRef.current
      for (const t of s.tasks.filter((x) => x.pr && x.worktreePath && x.col !== 'done' && !x.archivedAt && x.pr.state !== 'MERGED' && x.pr.state !== 'CLOSED')) {
        if (stopped) return
        const d = await window.api.git.prDetails(t.worktreePath!, t.pr!.url).catch(() => null)
        if (!d || stopped) continue
        const was = stateRef.current.tasks.find((x) => x.id === t.id)
        const before = was?.prDetails ?? null
        dispatch({ type: 'SET_PR_DETAILS', taskId: t.id, details: d })
        if (d.state === 'MERGED' && was?.pr?.state !== 'MERGED') dispatch({ type: 'SET_TASK_PR', taskId: t.id, pr: { url: d.url, number: d.number, state: 'MERGED' } })
        const muted = stateRef.current.prefs.mutedProjects.includes(t.projectId)
        if (muted || !stateRef.current.prefs.noticeKinds.includes('pr')) continue
        const base = { taskId: t.id, taskKey: t.key, taskTitle: t.title, projectId: t.projectId }
        const failingNow = d.checks.filter((c) => c.state === 'fail').map((c) => c.name).sort().join('|')
        const failingBefore = (before?.checks ?? []).filter((c) => c.state === 'fail').map((c) => c.name).sort().join('|')
        if (failingNow && failingNow !== failingBefore) {
          recordNotice({ ...base, kind: 'pr', text: `#${d.number}: ${prSummary(d).text}`, detail: checksMessage(d) })
          if (!document.hasFocus()) window.api.sys.notify(`Checks failed on #${d.number}`, `${t.key} · ${t.title}`, t.id)
        }
        const newComments = d.comments.filter((c) => c.at > (before?.at ?? 0) && before !== null)
        if ((d.reviewDecision === 'CHANGES_REQUESTED' && before?.reviewDecision !== 'CHANGES_REQUESTED') || newComments.length) {
          recordNotice({ ...base, kind: 'pr', text: d.reviewDecision === 'CHANGES_REQUESTED' ? `#${d.number}: changes requested` : `#${d.number}: ${newComments.length} new review comment${newComments.length > 1 ? 's' : ''}`, detail: newComments.map((c) => `${c.author}: ${c.body.slice(0, 160)}`).join('\n') || null })
        }
      }
    }
    // Coming back to the window (from merging on GitHub, say): a look right away.
    let lastPoll = 0
    const timed = (): void => {
      lastPoll = Date.now()
      poll()
    }
    const onFocus = (): void => {
      if (Date.now() - lastPoll > 15_000) timed()
    }
    window.addEventListener('focus', onFocus)
    const first = setTimeout(timed, 8000)
    const every = setInterval(timed, 120_000)
    return () => {
      stopped = true
      window.removeEventListener('focus', onFocus)
      clearTimeout(first)
      clearInterval(every)
    }
  }, [dispatch])

  // The board's filters, lanes and views, kept for the next start.
  const boardLoaded = useRef(state.board)
  useEffect(() => {
    if (state.board === boardLoaded.current) return
    const t = setTimeout(() => saveBoardPrefs(state.board), 300)
    return () => clearTimeout(t)
  }, [state.board])

  useEffect(() => {
    if (!state.toast) return
    const id = state.toast.id
    const t = setTimeout(() => dispatch({ type: 'DISMISS_TOAST', id }), 3200)
    return () => clearTimeout(t)
  }, [state.toast, dispatch])

  // An agent hit a usage limit: the task sleeps until it resets.
  useEffect(
    () =>
      window.api.agents.onLimit((l) => {
        const s = stateRef.current
        const task = s.tasks.find((t) => t.id === l.taskId)
        if (!task || task.col === 'done') return
        dispatch({ type: 'AGENT_LIMIT', taskId: l.taskId, until: l.resetAt, reason: l.text })
        const name = AGENTS.find((a) => a.kind === task.agentKind)?.name ?? 'The agent'
        const when = l.resetAt ? `resumes at ${clock(l.resetAt)}` : 'tries again in an hour'
        if (s.prefs.mutedProjects.includes(task.projectId)) return
        if (s.prefs.noticeKinds.includes('limit')) recordNotice({ kind: 'limit', taskId: task.id, taskKey: task.key, taskTitle: task.title, projectId: task.projectId, text: `${name} hit a usage limit - ${when}`, detail: l.text })
        if (!document.hasFocus()) window.api.sys.notify(`${name} hit a usage limit`, `${task.key} · ${task.title} - ${when}`, task.id)
      }),
    [dispatch]
  )

  // Sleeping tasks wake when their limit resets (kept with the task, so a restart doesn't lose it).
  const sleepKey = state.tasks
    .filter((t) => t.sleeping)
    .map((t) => `${t.id}:${wakeAt(t.sleeping!)}`)
    .join('|')
  useEffect(() => {
    const timers = stateRef.current.tasks
      .filter((t) => t.sleeping)
      .map((t) => setTimeout(() => dispatch({ type: 'WAKE_TASK', taskId: t.id }), Math.min(2 ** 31 - 1, Math.max(0, wakeAt(t.sleeping!) - Date.now()))))
    return () => timers.forEach(clearTimeout)
  }, [sleepKey, dispatch])

  // A task's pull request merged on GitHub (seen by the PR check): the task goes to Done by itself -
  // Settings → Git, "Finish tasks when their pull request is merged". Not while its agent is working
  // (that's said instead), and finishWithPr refuses anything that would lose work.
  const prBefore = useRef<Map<string, string | null> | null>(null)
  useEffect(() => {
    const prev = prBefore.current
    prBefore.current = new Map(state.tasks.map((t) => [t.id, t.pr?.state ?? null]))
    if (!prev || !hydratedRef.current) return
    const s = stateRef.current
    for (const t of state.tasks) {
      if (t.pr?.state !== 'MERGED' || !prev.has(t.id) || prev.get(t.id) === 'MERGED') continue
      if (t.col === 'done' || !t.worktreePath) continue
      const project = s.projects.find((p) => p.id === t.projectId)
      if (!project || !prefsFor(s, project.id).finishOnPrMerge) continue
      if (t.st === 'working') {
        dispatch({ type: 'TOAST', text: `PR #${t.pr.number ?? ''} of ${t.key} is merged - it goes to Done once its agent stops (or finish it now).` })
        continue
      }
      finishWithPr(t, project, dispatch, s.projects).catch(() => {})
    }
  }, [state.tasks, dispatch])

  // The activity log (the daily summary): moves to Review, failures, finishes.
  const before = useRef<Task[] | null>(null)
  useEffect(() => {
    const prev = before.current
    before.current = state.tasks
    if (!prev || !hydratedRef.current) return
    const was = new Map(prev.map((t) => [t.id, t]))
    for (const t of state.tasks) {
      const b = was.get(t.id)
      if (!b) continue
      const base = { at: Date.now(), taskId: t.id, taskKey: t.key, title: t.title, projectId: t.projectId, agentKind: b.agentKind ?? t.agentKind }
      if (t.col === 'review' && b.col !== 'review') window.api.activity.add({ ...base, kind: 'review' }).catch(() => {})
      if (t.col === 'done' && b.col !== 'done') window.api.activity.add({ ...base, kind: 'finished', note: t.doneNote }).catch(() => {})
      if (t.st === 'failed' && b.st !== 'failed') window.api.activity.add({ ...base, kind: 'failed', note: t.ask }).catch(() => {})
    }
  }, [state.tasks])

  // The queue: when a slot frees up (and no other launch is under way), the
  // longest-waiting task starts in the background - not with an agent
  // that's out of its usage until the limit resets.
  useEffect(() => {
    if (!hydratedRef.current || state.start) return
    const limited = new Set(state.tasks.filter((t) => t.sleeping && t.agentKind).map((t) => t.agentKind))
    // A task building on another waits until that one's agent is done (Review).
    const next = queuedTasks(state.tasks).find((t) => !limited.has(t.queued!.agentKind) && parentFinished(t, state.tasks))
    if (!next) return
    const max = state.prefs.maxAgents
    if (max > 0 && busyAgents(state.tasks) >= max) return
    dispatch({ type: 'START_QUEUED', taskId: next.id })
  }, [state.tasks, state.start, state.prefs.maxAgents, dispatch])

  // The launch flow: every step does its real work and the next one starts
  // when it's done. A failing step holds (LAUNCH_FAILED) until Retry or
  // Cancel; a failing setup command has its own "Launch anyway".
  const launchRan = useRef<string | null>(null)
  useEffect(() => {
    const start = state.start
    if (!start || start.phase !== 'launch' || start.error) return
    const task = state.tasks.find((t) => t.id === start.taskId)
    const project = task ? state.projects.find((p) => p.id === task.projectId) : undefined
    if (!task || !project) return

    // Each step's work runs once (the effect re-runs on unrelated updates).
    const key = `${start.taskId}:${start.launchedAt}:${start.step}`
    const once = (work: () => Promise<void>): void => {
      if (launchRan.current === key) return
      launchRan.current = key
      work().catch((err: unknown) => {
        launchRan.current = null
        dispatch({ type: 'LAUNCH_FAILED', message: errText(err) })
      })
    }
    const next = (): void => dispatch({ type: 'ADVANCE_LAUNCH_STEP' })
    // The other repositories the task works in (Start modal → Repos).
    const extras = start.repos.map((id) => state.projects.find((p) => p.id === id)).filter((p): p is Project => !!p?.repoPath)

    // In the project's own checkout, or a worktree that's already there: nothing is created or set
    // up (that folder is as you left it) - straight to the agent there.
    const given = start.inPlace ? project.repoPath : start.existingWorktree
    if (given && start.step < 3) {
      return once(async () => {
        if (start.step === 1) {
          if (!start.inPlace && !(await window.api.git.isCheckout(given))) throw new Error(`${given} isn't a git worktree any more.`)
          dispatch({ type: 'SET_START_WORKTREE_PATH', path: given })
        }
        next()
      })
    }

    switch (start.step) {
      case 0: // Create branch - from the project's base branch, or the branch of the task it builds on (in each of the task's repositories).
        return once(async () => {
          const info = await window.api.git.createBranch(project.repoPath, start.branch, baseFor(task, project, state.tasks))
          dispatch({ type: 'SET_START_BRANCH_INFO', info })
          const made: Made[] = []
          for (const extra of extras) {
            const r = await window.api.git.createBranch(extra.repoPath, start.branch, baseFor(task, extra, state.tasks))
            made.push({ repoPath: extra.repoPath, path: '', branch: r.existed ? '' : start.branch })
          }
          madeRef.current.set(start.taskId, made)
          next()
        })
      case 1: // Add worktree, and copy in the untracked files it needs (.env, keys).
        return once(async () => {
          const copyInto = async (p: Project, path: string, prefix: string): Promise<string[]> =>
            p.copyFiles?.length
              ? (
                  await window.api.git.copyIntoWorktree(p.repoPath, path, p.copyFiles).catch((err: unknown) => {
                    dispatch({ type: 'TOAST', text: `Could not copy files into the worktree: ${errText(err)}` })
                    return [] as string[]
                  })
                ).map((f) => prefix + f)
              : []
          if (!extras.length) {
            const path = await window.api.git.suggestWorktreePath(project.repoPath, start.branch)
            await window.api.git.addWorktree(project.repoPath, path, start.branch)
            dispatch({ type: 'SET_START_WORKTREE_PATH', path, copied: await copyInto(project, path, '') })
            return next()
          }
          // Several repositories: one folder for the task, a worktree of each inside it.
          const taskDir = await window.api.git.suggestTaskDir(project.repoPath, task.key)
          const sep = taskDir.includes('\\') ? '\\' : '/'
          const homePath = `${taskDir}${sep}${repoDir(project)}`
          await window.api.git.addWorktree(project.repoPath, homePath, start.branch)
          const copied = await copyInto(project, homePath, `${repoDir(project)}/`)
          const made = madeRef.current.get(start.taskId) ?? []
          for (const [i, extra] of extras.entries()) {
            const path = `${taskDir}${sep}${repoDir(extra)}`
            await window.api.git.addWorktree(extra.repoPath, path, start.branch)
            if (made[i]) made[i].path = path
            copied.push(...(await copyInto(extra, path, `${repoDir(extra)}/`)))
          }
          dispatch({ type: 'SET_START_TASK_DIR', dir: taskDir })
          dispatch({ type: 'SET_START_WORKTREE_PATH', path: homePath, copied })
          next()
        })
      case 2: {
        // Run setup (each repository's, in its worktree), and wait for it.
        const setup = start.setup
        const sep = start.taskDir?.includes('\\') ? '\\' : '/'
        const steps = [project, ...extras]
          .filter((p) => p.setupCmd)
          .map((p) => ({ project: p, cwd: p === project || !start.taskDir ? start.worktreePath! : `${start.taskDir}${sep}${repoDir(p)}` }))
        if (!steps.length || setup?.status === 'ok' || setup?.status === 'ignored') return once(async () => next())
        if (setup || !start.worktreePath) return
        return once(async () => {
          let acc = ''
          let flush: ReturnType<typeof setTimeout> | null = null
          // Show the latest complete output line, at most every 250ms.
          const lastLine = (): string | null => tailLines(acc.slice(0, acc.lastIndexOf('\n') + 1), 1)[0] ?? null
          dispatch({ type: 'SETUP_UPDATE', patch: { status: 'running', line: null, exitCode: null } })
          try {
            let exitCode: number | null = 0
            for (const step of steps) {
              exitCode = await runCommandSession(setupSessionId(start.taskId), step.cwd, step.project.setupCmd!, projectEnv(step.project), (data) => {
                acc = (acc + data).slice(-4000)
                if (flush) return
                flush = setTimeout(() => {
                  flush = null
                  dispatch({ type: 'SETUP_UPDATE', patch: { line: lastLine() } })
                }, 250)
              })
              if (exitCode !== 0) break
            }
            if (flush) clearTimeout(flush)
            dispatch({ type: 'SETUP_UPDATE', patch: { status: exitCode === 0 ? 'ok' : 'failed', exitCode, line: tailLines(acc, 1)[0] ?? null } })
          } catch (err) {
            dispatch({ type: 'SETUP_UPDATE', patch: { status: 'failed', exitCode: null, line: errText(err) } })
          }
          // The step re-runs its check once the status is in.
          launchRan.current = null
        })
      }
      case 3: // Launch the agent - before the workspace opens, so it opens onto a running session.
        if (!start.worktreePath) return
        return once(async () => {
          // The task's notes go along as context: where they are, for the agent to read.
          const notes = state.notes.filter((n) => n.taskId === task.id)
          const withNotes = notes.length ? `${start.message} Notes for this task (Markdown files, read them first): ${notes.map((n) => n.file).join(', ')}` : start.message
          const prefs = prefsFor(state, project.id)
          const criteria = criteriaMessage(task, prefs.agentTools && hasTools(start.agentKind))
          // Images pasted or attached in the Start modal: their paths, for the agent to open.
          const images = start.images.length ? `\n\nImages for this task (open and look at them): ${start.images.join(', ')}` : ''
          const message = (criteria ? `${withNotes} ${criteria}` : withNotes) + images
          const launching: Task = {
            ...task,
            agentKind: start.agentKind,
            worktreePath: start.worktreePath,
            taskDir: start.taskDir,
            repos: start.repos,
            firstMessage: message,
            model: start.model.trim() || null,
            planFirst: start.planFirst
          }
          await startAgent(launching, project, prefsFor(state, project.id), 'fresh')
          next()
        })
      default: // Open the workspace.
        return once(async () => dispatch({ type: 'FINISH_START' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.start?.phase, state.start?.step, state.start?.worktreePath, state.start?.setup?.status, state.start?.error])

  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>
}

export function useAppStore(): Ctx {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useAppStore must be used within AppStoreProvider')
  return ctx
}
