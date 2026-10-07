import type { Note, Task } from '@shared/types'
import { NO_FILTER, boardFilterOf, loadBoardPrefs } from '../lib/boardFilter'
import type { Action, AppState } from './types'
import { AGENTS, COLUMN_ORDER, DEFAULT_PREFS, branchFor, firstMessage } from '@shared/constants'
import { agentShort, busyAgents, nextTaskKey, raiseKeyHigh } from '../lib/derive'
import { clock, waitingText } from '../lib/status'
import { prefsFor } from '../lib/projectPrefs'
import { waitsFor, wouldLoop } from '@shared/stack'
import { remember, travel } from './history'

let toastSeq = 0
const LAUNCH_STEP_COUNT = 5

export function initialState(): AppState {
  return {
    projects: [],
    tasks: [],
    view: 'dashboard',
    projectId: null,
    taskId: null,
    wsIntent: null,
    boardFocus: null,
    board: loadBoardPrefs(),
    addingTask: false,
    newTaskTitle: '',
    newTaskAfter: null,
    agentFilter: 'all',
    wtSelected: null,
    start: null,
    palette: null,
    filePreview: null,
    toast: null,
    addProjectOpen: false,
    prefs: DEFAULT_PREFS,
    keybindings: [],
    settingsSection: 'general',
    taskSheet: null,
    outsideFor: null,
    issuesFor: null,
    notes: [],
    noteId: null,
    noteSeq: 0,
    base: {},
    archiveFor: null,
    keyHigh: {},
    nav: { back: [], forward: [] },
    zen: false
  }
}

/** Pinned first, then most recently changed. */
function sortNotes(notes: Note[]): Note[] {
  return notes.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

function mapTask(state: AppState, id: string, fn: (t: Task) => Task): Task[] {
  return state.tasks.map((t) => (t.id === id ? fn(t) : t))
}

function withToast(state: AppState, text: string, tone: 'plain' | 'waiting' | 'done' = 'plain'): AppState {
  toastSeq += 1
  return { ...state, toast: { id: toastSeq, text, tone } }
}

/**
 * The reducer, plus bookkeeping of how long each agent actually works:
 * whenever a task enters or leaves "working", its stretch is started or
 * added to `workMs`.
 */
export function reducer(state: AppState, action: Action): AppState {
  if (action.type === 'GO') return travel(state, action.dir)
  const next = bookkeep(state, action)
  return action.type === 'HYDRATE' ? next : remember(state, next)
}

function bookkeep(state: AppState, action: Action): AppState {
  const reduced = reduce(state, action)
  if (reduced.tasks === state.tasks) return reduced
  // A key, once given, stays used - even after its task is deleted.
  const high = raiseKeyHigh(reduced.keyHigh, reduced.tasks)
  const next = high === reduced.keyHigh ? reduced : { ...reduced, keyHigh: high }
  if (action.type === 'HYDRATE') return next
  const before = new Map(state.tasks.map((t) => [t.id, t.st]))
  const now = Date.now()
  let changed = false
  const tasks = next.tasks.map((t) => {
    const was = before.get(t.id)
    if (was === undefined || (was === 'working') === (t.st === 'working')) return t
    changed = true
    return t.st === 'working'
      ? { ...t, workingSince: now }
      : { ...t, workMs: (t.workMs ?? 0) + (t.workingSince ? now - t.workingSince : 0), workingSince: null }
  })
  return changed ? { ...next, tasks } : next
}

function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'NAV':
      return {
        ...state,
        view: action.view,
        projectId: action.projectId !== undefined ? action.projectId : state.projectId,
        taskId: action.taskId !== undefined ? action.taskId : state.taskId
      }

    case 'OPEN_TASK': {
      const task = state.tasks.find((t) => t.id === action.taskId)
      if (!task) return state
      return {
        ...state,
        view: 'workspace',
        projectId: task.projectId,
        taskId: task.id,
        // Something to show there (its changes, its files): the workspace does it once, on top of its layout.
        wsIntent: action.tab ? { tab: action.tab, n: (state.wsIntent?.n ?? 0) + 1 } : state.wsIntent
      }
    }

    case 'SET_BOARD_FOCUS':
      return { ...state, boardFocus: action.id }

    case 'MOVE_TASK': {
      const task = state.tasks.find((t) => t.id === action.id)
      if (!task) return state

      // Within its column: only its place changes.
      if (action.col === task.col) return action.before === undefined ? state : { ...state, tasks: placeTask(state.tasks, task.id, action.before) }

      if (action.col === 'progress' && !(task.agentKind && task.branch)) {
        // Caller is expected to dispatch OPEN_START_MODAL instead in this case.
        return state
      }

      if (action.col === 'review' && !task.agentKind) {
        return withToast(state, 'Only tasks with an agent can move to Review.', 'plain')
      }
      // A task with a worktree gets to Done by really merging it (or through
      // its pull request) - see finishTask. Callers do that instead.
      if (action.col === 'done' && task.worktreePath) return state

      const fromIdx = COLUMN_ORDER.indexOf(task.col)
      const toIdx = COLUMN_ORDER.indexOf(action.col)
      const movingBackward = toIdx < fromIdx

      let next: Task = { ...task, col: action.col, lastActivityAt: Date.now() }

      if (action.col === 'review') {
        next = { ...next, st: 'done' }
      }
      if (action.col === 'done') {
        next = { ...next, agentKind: null, st: null, branch: null, worktreeId: null, worktreePath: null, doneNote: 'Closed without an agent' }
      }
      if (movingBackward && next.st === 'working') {
        next = { ...next, st: 'paused' }
      }

      const tasks = mapTask(state, task.id, () => next)
      return { ...state, tasks: action.before === undefined ? tasks : placeTask(tasks, task.id, action.before) }
    }

    case 'BEGIN_ADD_TASK':
      return { ...state, addingTask: true, newTaskTitle: '', newTaskAfter: action.after ?? null }

    case 'CANCEL_ADD_TASK':
      return { ...state, addingTask: false, newTaskTitle: '', newTaskAfter: null }

    case 'SET_NEW_TASK_TITLE':
      return { ...state, newTaskTitle: action.title }

    case 'COMMIT_ADD_TASK': {
      const title = state.newTaskTitle.trim()
      if (!title || !state.projectId) return { ...state, addingTask: false, newTaskTitle: '', newTaskAfter: null }
      const project = state.projects.find((p) => p.id === state.projectId)!
      const key = nextTaskKey(state.tasks, project, state.keyHigh)
      const after = state.tasks.find((t) => t.id === state.newTaskAfter && t.col !== 'done')
      const task: Task = {
        id: key,
        key,
        projectId: project.id,
        title,
        buildsOn: after?.id ?? null,
        col: 'backlog',
        agentKind: null,
        st: null,
        worktreeId: null,
        worktreePath: null,
        branch: null,
        ask: null,
        doneNote: null,
        firstMessage: null,
        createdAt: Date.now(),
        startedAt: null,
        lastActivityAt: Date.now()
      }
      // Focus the new card so its "+ Add description" affordance shows (or open its sheet, to write one).
      return { ...state, tasks: [task, ...state.tasks], addingTask: false, newTaskTitle: '', newTaskAfter: null, boardFocus: key, taskSheet: action.describe ? key : state.taskSheet }
    }

    case 'AGENT_LIMIT': {
      const task = state.tasks.find((t) => t.id === action.taskId)
      if (!task || task.col === 'done') return state
      return withToast(
        { ...state, tasks: mapTask(state, task.id, (t) => ({ ...t, sleeping: { until: action.until, reason: action.reason, since: Date.now() } })) },
        `${task.key}: ${agentShort(task.agentKind) || 'the agent'} hit a usage limit - ${action.until ? `resumes at ${clock(action.until)}` : 'trying again in an hour'}.`,
        'waiting'
      )
    }

    case 'WAKE_TASK':
      return withToast(
        { ...state, tasks: mapTask(state, action.taskId, (t) => ({ ...t, sleeping: null, st: 'working', ask: null, askKind: null })) },
        `Woke ${state.tasks.find((t) => t.id === action.taskId)?.key ?? 'the task'}: its agent carries on.`
      )

    case 'CANCEL_SLEEP':
      return { ...state, tasks: mapTask(state, action.taskId, (t) => ({ ...t, sleeping: null })) }

    case 'SET_BUILDS_ON': {
      const task = state.tasks.find((t) => t.id === action.taskId)
      if (!task || (task.buildsOn ?? null) === action.parentId) return state
      // Its branch is made from the parent's when it starts: fixed after that.
      if (task.branch) return withToast(state, `${task.key} has started - its branch already has its base.`)
      if (action.parentId && wouldLoop(task.id, action.parentId, state.tasks)) return withToast(state, 'That task builds on this one already.')
      const parent = state.tasks.find((t) => t.id === action.parentId)
      return withToast(
        { ...state, tasks: mapTask(state, task.id, (t) => ({ ...t, buildsOn: action.parentId })) },
        parent ? `${task.key} builds on ${parent.key} - its branch starts from ${parent.branch ?? `${parent.key}'s`}.` : `${task.key} starts from the default branch.`
      )
    }

    case 'SET_CRITERIA':
      return { ...state, tasks: mapTask(state, action.taskId, (t) => ({ ...t, criteria: action.criteria })) }

    case 'VERIFY_CRITERION': {
      // The agent's verify_criterion: the result, how it checked, its screenshot.
      const task = state.tasks.find((t) => t.id === action.taskId)
      const c = task?.criteria?.[action.index]
      if (!task || !c) return state
      const criteria = task.criteria!.map((x, i) => (i === action.index ? { ...x, status: action.passed ? ('passed' as const) : ('failed' as const), note: action.note || null, image: action.image ?? x.image ?? null, by: 'agent' as const, at: Date.now() } : x))
      const left = criteria.filter((x) => x.status !== 'passed').length
      return withToast(
        { ...state, tasks: mapTask(state, task.id, (t) => ({ ...t, criteria })) },
        `${task.key}: ${action.passed ? 'verified' : 'failed'} “${c.text}”${left ? ` · ${left} to go` : ' · all verified'}`,
        action.passed ? 'done' : 'waiting'
      )
    }

    case 'AGENT_ADD_TASK': {
      // A card made for you (an agent's create_task): at the top of its column.
      if (state.tasks.some((t) => t.id === action.key)) return state
      const task: Task = {
        id: action.key,
        key: action.key,
        projectId: action.projectId,
        title: action.title,
        desc: action.desc || undefined,
        buildsOn: action.buildsOn ?? null,
        col: action.col,
        agentKind: null,
        st: null,
        worktreeId: null,
        worktreePath: null,
        branch: null,
        ask: null,
        doneNote: null,
        firstMessage: null,
        createdAt: Date.now(),
        startedAt: null,
        lastActivityAt: Date.now()
      }
      const next = { ...state, tasks: [task, ...state.tasks] }
      return action.toast ? withToast(next, action.toast) : next
    }

    case 'SET_TASK_DESC': {
      const task = state.tasks.find((t) => t.id === action.id)
      const desc = action.desc.trim()
      if (!task || (task.desc ?? '') === desc) return state
      return withToast(
        { ...state, tasks: mapTask(state, task.id, (t) => ({ ...t, desc })) },
        desc ? 'Description saved' : 'Description cleared'
      )
    }

    case 'SET_AGENT_FILTER':
      return { ...state, agentFilter: action.filter }

    case 'SELECT_WORKTREE':
      return { ...state, wtSelected: action.id }

    case 'OPEN_START_MODAL': {
      const task = state.tasks.find((t) => t.id === action.taskId)
      if (!task) return state
      // The task's own agent, else the project's, else the global default -
      // skipping agents turned off in Settings.
      const project = state.projects.find((p) => p.id === task.projectId)
      const enabled = AGENTS.filter((a) => !state.prefs.agentsOff.includes(a.kind)).map((a) => a.kind)
      const wanted = [task.agentKind, project?.agentKind, state.prefs.defaultAgent]
      const defaultAgent = wanted.find((k): k is NonNullable<typeof k> => !!k && enabled.includes(k)) ?? enabled[0] ?? AGENTS[0].kind
      return {
        ...state,
        start: {
          taskId: task.id,
          agentKind: defaultAgent,
          branch: task.branch ?? branchFor(prefsFor(state, task.projectId).branchPattern, task.title, task.key),
          message: firstMessage(project?.messageTemplate, task, task.branch ?? branchFor(prefsFor(state, task.projectId).branchPattern, task.title, task.key)),
          phase: 'config',
          step: 0,
          background: false,
          worktreePath: null,
          launchedAt: null,
          setup: null,
          copied: [],
          branchInfo: null,
          error: null,
          repos: (task.repos ?? []).filter((r) => r !== task.projectId && state.projects.some((p) => p.id === r)),
          taskDir: null,
          model: task.model ?? '',
          planFirst: task.planFirst ?? false,
          images: []
        }
      }
    }

    case 'SET_START_BRANCH_INFO':
      return state.start ? { ...state, start: { ...state.start, branchInfo: action.info } } : state

    // A failed step needs a decision - bring a backgrounded launch back up.
    case 'LAUNCH_FAILED':
      return state.start ? { ...state, start: { ...state.start, error: action.message, background: false } } : state

    case 'LAUNCH_RETRY':
      return state.start ? { ...state, start: { ...state.start, error: null } } : state

    case 'CLOSE_START_MODAL':
      return { ...state, start: null }

    case 'SET_START_AGENT':
      return state.start ? { ...state, start: { ...state.start, agentKind: action.agentKind } } : state

    case 'SET_START_BRANCH':
      return state.start ? { ...state, start: { ...state.start, branch: action.branch.replace(/\s/g, '-') } } : state

    case 'SET_START_REPOS':
      return state.start ? { ...state, start: { ...state.start, repos: action.repos } } : state

    case 'SET_START_TASK_DIR':
      return state.start ? { ...state, start: { ...state.start, taskDir: action.dir } } : state

    case 'SET_TASK_REPOS':
      return { ...state, tasks: mapTask(state, action.taskId, (t) => ({ ...t, repos: action.repos, ...(action.taskDir !== undefined ? { taskDir: action.taskDir } : {}), ...(action.worktreePath !== undefined ? { worktreePath: action.worktreePath } : {}) })) }

    case 'SET_START_MESSAGE':
      return state.start ? { ...state, start: { ...state.start, message: action.message } } : state

    case 'LAUNCH_START': {
      if (!state.start || state.start.phase !== 'config') return state
      // All slots taken (Settings → Agents), or the task it builds on hasn't started: it waits in the queue.
      const max = state.prefs.maxAgents
      const busy = busyAgents(state.tasks)
      const task = state.tasks.find((t) => t.id === state.start!.taskId)
      const waiting = task ? waitsFor(task, state.tasks) : undefined
      if ((max > 0 && busy >= max) || waiting) {
        const { taskId, agentKind, branch, message, repos, model, planFirst, images } = state.start
        return withToast(
          { ...state, start: null, tasks: mapTask(state, taskId, (t) => ({ ...t, repos, queued: { agentKind, branch, message, at: Date.now(), model, planFirst, images } })) },
          waiting ? `Queued - starts from ${waiting.key}'s branch once ${waiting.key} is in Review.` : `Queued - ${busy} agent${busy > 1 ? 's are' : ' is'} working (limit ${max}).`
        )
      }
      return { ...state, start: { ...state.start, phase: 'launch', step: 0, launchedAt: Date.now() } }
    }

    case 'QUEUE_TASKS': {
      let next = state
      let n = 0
      for (const id of action.taskIds) {
        const task = next.tasks.find((t) => t.id === id)
        if (!task || task.queued || task.worktreePath || (task.col !== 'backlog' && task.col !== 'ready')) continue
        // The Start modal's defaults: agent, branch and first message.
        const s = reduce({ ...next, start: null }, { type: 'OPEN_START_MODAL', taskId: id }).start
        if (!s) continue
        const queued = { agentKind: s.agentKind, branch: s.branch, message: s.message, at: Date.now() + n++, model: s.model, planFirst: s.planFirst }
        next = { ...next, tasks: mapTask(next, id, (t) => ({ ...t, queued })) }
      }
      return n ? withToast(next, `Queued ${n} task${n > 1 ? 's' : ''}.`) : state
    }

    case 'UNQUEUE_TASK':
      return withToast({ ...state, tasks: mapTask(state, action.taskId, (t) => ({ ...t, queued: null })) }, 'Removed from the queue.')

    case 'START_QUEUED': {
      const task = state.tasks.find((t) => t.id === action.taskId)
      if (!task?.queued || state.start) return state
      const q = task.queued
      const opened = reduce(state, { type: 'OPEN_START_MODAL', taskId: task.id })
      if (!opened.start) return state
      return {
        ...opened,
        tasks: mapTask(opened, task.id, (t) => ({ ...t, queued: null })),
        start: { ...opened.start, agentKind: q.agentKind, branch: q.branch, message: q.message, model: q.model ?? '', planFirst: q.planFirst ?? false, images: q.images ?? [], phase: 'launch', step: 0, background: true, launchedAt: Date.now() }
      }
    }

    case 'ADD_TASK':
      return { ...state, tasks: [action.task, ...state.tasks] }

    case 'NOTES_LOADED':
      return { ...state, notes: sortNotes(action.notes) }

    case 'NOTE_SAVED': {
      const gone = new Set([action.note.id, action.replaces])
      return {
        ...state,
        notes: sortNotes([action.note, ...state.notes.filter((n) => !gone.has(n.id))]),
        noteId: action.replaces && state.noteId === action.replaces ? action.note.id : state.noteId
      }
    }

    case 'NOTE_DELETED': {
      const next = { ...state, notes: state.notes.filter((n) => n.id !== action.id), noteId: state.noteId === action.id ? null : state.noteId }
      return action.quiet ? next : withToast(next, 'Note moved to the trash.')
    }

    case 'OPEN_NOTE':
      return { ...state, view: 'notes', noteId: action.id ?? state.noteId, noteSeq: action.id ? state.noteSeq + 1 : state.noteSeq, palette: null }

    case 'OPEN_ISSUES':
      return { ...state, issuesFor: action.projectId }

    case 'IMPORT_ISSUES': {
      const project = state.projects.find((p) => p.id === action.projectId)
      if (!project) return state
      const have = new Set(state.tasks.filter((t) => t.projectId === project.id && t.issue).map((t) => t.issue!.number))
      const now = Date.now()
      let known = state.tasks
      const created: Task[] = action.issues
        .filter((i) => !have.has(i.number))
        .map((i) => {
          const key = nextTaskKey(known, project, state.keyHigh)
          known = [...known, { id: key, key, projectId: project.id } as Task]
          return {
            id: key,
            key,
            projectId: project.id,
            title: i.title,
            desc: i.body.trim().slice(0, 4000),
            col: 'backlog',
            agentKind: null,
            st: null,
            worktreeId: null,
            worktreePath: null,
            branch: null,
            ask: null,
            doneNote: null,
            firstMessage: null,
            issue: { number: i.number, url: i.url },
            createdAt: now,
            startedAt: null,
            lastActivityAt: now
          }
        })
      return withToast(
        { ...state, tasks: [...created, ...state.tasks], issuesFor: null },
        `Imported ${created.length} issue${created.length === 1 ? '' : 's'} into the backlog.`,
        'done'
      )
    }

    case 'ADVANCE_LAUNCH_STEP': {
      if (!state.start) return state
      const nextStep = state.start.step + 1
      if (nextStep >= LAUNCH_STEP_COUNT) {
        return state
      }
      return { ...state, start: { ...state.start, step: nextStep } }
    }

    case 'SET_START_WORKTREE_PATH':
      return state.start ? { ...state, start: { ...state.start, worktreePath: action.path, copied: action.copied ?? [] } } : state

    case 'BACKGROUND_START':
      return state.start ? { ...state, start: { ...state.start, background: true } } : state

    case 'FINISH_START': {
      if (!state.start) return state
      const { taskId, agentKind, branch, background, worktreePath, message, repos, taskDir, model, planFirst } = state.start
      const task = state.tasks.find((t) => t.id === taskId)
      if (!task) return { ...state, start: null }
      const worktreeId = `wt-${taskId.toLowerCase()}`
      const nextTasks = mapTask(state, taskId, (t) => ({
        ...t,
        col: 'progress',
        agentKind,
        branch,
        worktreeId,
        worktreePath,
        repos,
        taskDir,
        firstMessage: message,
        model: model.trim() || null,
        planFirst,
        st: 'working',
        activity: null,
        session: null,
        queued: null,
        startedAt: Date.now(),
        lastActivityAt: Date.now()
      }))
      const goWorkspace = !background && prefsFor(state, task.projectId).openAfterStart
      return {
        ...state,
        tasks: nextTasks,
        start: null,
        view: goWorkspace ? 'workspace' : state.view,
        projectId: goWorkspace ? task.projectId : state.projectId,
        taskId: goWorkspace ? task.id : state.taskId,
        wsIntent: goWorkspace ? { tab: 'terminal', n: (state.wsIntent?.n ?? 0) + 1 } : state.wsIntent
      }
    }

    case 'SETUP_UPDATE': {
      if (!state.start) return state
      const setup = { status: 'running' as const, line: null, exitCode: null, ...state.start.setup, ...action.patch }
      // A failed setup needs a decision - bring a backgrounded launch back up.
      const background = setup.status === 'failed' ? false : state.start.background
      return { ...state, start: { ...state.start, setup, background } }
    }

    case 'LAUNCH_ANYWAY':
      return state.start?.setup
        ? { ...state, start: { ...state.start, setup: { ...state.start.setup, status: 'ignored' } } }
        : state

    case 'RUN_TESTS':
      return {
        ...state,
        tasks: mapTask(state, action.taskId, (t) => ({ ...t, lastTest: { status: 'running', exitCode: null, at: Date.now() } }))
      }

    case 'TESTS_FINISHED': {
      const task = state.tasks.find((t) => t.id === action.taskId)
      if (!task) return state
      const passed = action.exitCode === 0
      const next = {
        ...state,
        tasks: mapTask(state, task.id, (t) => ({
          ...t,
          lastTest: { status: passed ? ('passed' as const) : ('failed' as const), exitCode: action.exitCode, at: t.lastTest?.at ?? Date.now() }
        }))
      }
      return withToast(next, passed ? `Tests passed · ${task.title}` : `Tests failed (exit ${action.exitCode}) · ${task.title}`, passed ? 'done' : 'waiting')
    }

    case 'MESSAGE_AGENT':
      return withToast(state, action.toast)

    case 'AGENT_STATUS': {
      const { update } = action
      const task = state.tasks.find((t) => t.id === update.taskId)
      // Ignore sessions for tasks that aren't (or are no longer) started.
      if (!task || !task.agentKind || !task.branch || task.col === 'done') return state
      // A paused agent was interrupted on purpose - it going idle is expected.
      if (task.st === 'paused' && update.st === 'waiting') return state
      const activity = update.activity !== undefined ? update.activity : task.activity ?? null
      const session = update.session ?? task.session ?? null
      if (
        task.st === update.st &&
        task.ask === update.ask &&
        (task.askKind ?? null) === update.askKind &&
        (task.activity ?? null) === activity &&
        task.session?.id === session?.id
      )
        return state
      const next = mapTask(state, task.id, (t) => ({
        ...t,
        st: update.st,
        ask: update.ask,
        askKind: update.askKind,
        activity,
        session,
        lastActivityAt: Date.now()
      }))
      const becameBlocked = (update.st === 'waiting' || update.st === 'failed') && task.st === 'working'
      const looking = state.view === 'workspace' && state.taskId === task.id
      if (!becameBlocked || looking) return { ...state, tasks: next }
      const name = agentShort(task.agentKind)
      return withToast(
        { ...state, tasks: next },
        update.st === 'failed'
          ? `${name} failed on ${task.title}`
          : `${name} ${waitingText(update.askKind, update.ask)} on ${task.title}`,
        'waiting'
      )
    }

    case 'ANSWER_TASK': {
      const task = state.tasks.find((t) => t.id === action.taskId)
      if (!task) return state
      if (action.answer === 'retry') {
        return withToast(
          { ...state, tasks: mapTask(state, task.id, (t) => ({ ...t, st: 'working', ask: null, askKind: null })) },
          'Sent failure back to agent.'
        )
      }
      return withToast(
        {
          ...state,
          tasks: mapTask(state, task.id, (t) => ({ ...t, st: 'working', ask: null, askKind: null }))
        },
        action.answer === 'yes' ? 'Approved.' : 'Declined.'
      )
    }

    case 'PAUSE_TASK':
      return withToast(
        { ...state, tasks: mapTask(state, action.taskId, (t) => ({ ...t, st: 'paused' })) },
        'Agent paused.'
      )

    case 'RESUME_TASK':
      return withToast(
        { ...state, tasks: mapTask(state, action.taskId, (t) => ({ ...t, st: 'working', ask: null, askKind: null, sleeping: null })) },
        'Agent resumed.'
      )

    case 'PRIMARY_ACTION': {
      const task = state.tasks.find((t) => t.id === action.taskId)
      if (!task) return state
      if (task.col === 'progress') {
        return withToast(
          { ...state, tasks: mapTask(state, task.id, (t) => ({ ...t, col: 'review', st: 'done' })) },
          'Moved to Review.'
        )
      }
      // Not started yet: starting it is how it gets to In Progress.
      if (task.col === 'backlog' || task.col === 'ready') return reducer(state, { type: 'OPEN_START_MODAL', taskId: task.id })
      return state
    }

    case 'FINISH_TASK':
      return withToast(
        {
          ...state,
          tasks: mapTask(state, action.taskId, (t) => ({
            ...t,
            col: 'done',
            agentKind: null,
            st: null,
            ask: null,
            askKind: null,
            branch: null,
            worktreeId: null,
            worktreePath: null,
            doneNote: action.note,
            activity: null,
            session: null,
            queued: null,
            lastActivityAt: Date.now()
          }))
        },
        action.toast,
        'done'
      )

    case 'SET_TASK_PR':
      return { ...state, tasks: mapTask(state, action.taskId, (t) => ({ ...t, pr: action.pr })) }

    case 'SET_BOARD_FILTER': {
      if (!state.projectId) return state
      const filter = action.patch ? { ...boardFilterOf(state), ...action.patch } : NO_FILTER
      return { ...state, board: { ...state.board, filters: { ...state.board.filters, [state.projectId]: filter } } }
    }

    case 'SET_BOARD_GROUP':
      return state.projectId ? { ...state, board: { ...state.board, group: { ...state.board.group, [state.projectId]: action.group } } } : state

    case 'TOGGLE_BOARD_LANE': {
      if (!state.projectId) return state
      const folded = state.board.collapsed[state.projectId] ?? []
      const next = folded.includes(action.key) ? folded.filter((k) => k !== action.key) : [...folded, action.key]
      return { ...state, board: { ...state.board, collapsed: { ...state.board.collapsed, [state.projectId]: next } } }
    }

    case 'SAVE_BOARD_VIEW': {
      const name = action.name.trim()
      if (!name) return state
      const filter = { ...boardFilterOf(state), query: '' }
      // The same name again replaces that view.
      const views = [...state.board.views.filter((v) => v.name.toLowerCase() !== name.toLowerCase()), { id: `v${Date.now().toString(36)}`, name, filter }]
      return withToast({ ...state, board: { ...state.board, views } }, `Saved the view “${name}”`)
    }

    case 'DELETE_BOARD_VIEW':
      return { ...state, board: { ...state.board, views: state.board.views.filter((v) => v.id !== action.id) } }

    case 'SET_TASK_REPO_PR':
      return { ...state, tasks: mapTask(state, action.taskId, (t) => ({ ...t, repoPrs: { ...t.repoPrs, [action.repoId]: action.pr } })) }

    case 'RENAME_TASK': {
      const title = action.title.trim()
      const task = state.tasks.find((t) => t.id === action.taskId)
      if (!task || !title || title === task.title) return state
      return { ...state, tasks: mapTask(state, task.id, (t) => ({ ...t, title })) }
    }

    case 'DELETE_TASK': {
      const task = state.tasks.find((t) => t.id === action.taskId)
      if (!task) return state
      const leaving = state.taskId === task.id && state.view === 'workspace'
      return withToast(
        {
          ...state,
          // Tasks building on it now build on what it built on.
          tasks: state.tasks.filter((t) => t.id !== task.id).map((t) => (t.buildsOn === task.id ? { ...t, buildsOn: task.buildsOn ?? null } : t)),
          boardFocus: state.boardFocus === task.id ? null : state.boardFocus,
          view: leaving ? 'board' : state.view,
          taskId: state.taskId === task.id ? null : state.taskId
        },
        action.toast
      )
    }

    case 'DETACH_WORKTREE':
      return {
        ...state,
        tasks: mapTask(state, action.taskId, (t) =>
          t.col === 'done'
            ? t
            : { ...t, col: 'ready', st: null, ask: null, askKind: null, branch: null, worktreeId: null, worktreePath: null, taskDir: null, pr: null, activity: null, session: null, lastActivityAt: Date.now() }
        )
      }

    case 'CLEAR_DONE': {
      // Into the archive, not gone: still searchable, restorable, their keys kept.
      const at = Date.now()
      return withToast(
        { ...state, tasks: state.tasks.map((t) => (t.projectId === action.projectId && t.col === 'done' && !t.archivedAt ? { ...t, archivedAt: at } : t)) },
        `Archived ${action.count} finished task${action.count === 1 ? '' : 's'} - Archive in the Done column finds them.`
      )
    }

    case 'ARCHIVE_TASKS': {
      const ids = new Set(action.taskIds)
      const at = Date.now()
      return { ...state, tasks: state.tasks.map((t) => (ids.has(t.id) && t.col === 'done' ? { ...t, archivedAt: at } : t)) }
    }

    case 'UNARCHIVE_TASK':
      return withToast({ ...state, tasks: state.tasks.map((t) => (t.id === action.taskId ? { ...t, archivedAt: null } : t)) }, 'Back in Done.')

    case 'SET_ZEN':
      return { ...state, zen: action.on }

    case 'PIN_TASK':
      return { ...state, tasks: mapTask(state, action.taskId, (t) => ({ ...t, pinnedAt: action.pinned ? Date.now() : null })) }

    case 'OPEN_ARCHIVE':
      return { ...state, archiveFor: action.projectId, palette: null }

    case 'SET_START_OPTIONS':
      return state.start ? { ...state, start: { ...state.start, ...action.patch } } : state

    case 'BASE_STATUS': {
      const base = { ...state.base }
      for (const s of action.statuses) base[s.projectId] = s
      return { ...state, base }
    }

    case 'SET_PR_DETAILS': {
      const d = action.details
      return {
        ...state,
        tasks: mapTask(state, action.taskId, (t) => ({ ...t, prDetails: d, pr: t.pr ? { ...t.pr, state: d.state ?? t.pr.state, number: d.number ?? t.pr.number } : t.pr }))
      }
    }

    case 'TOGGLE_PALETTE':
      // From Go to file, Ctrl+K switches to commands.
      if (state.palette?.mode === 'files') return { ...state, palette: { ...state.palette, mode: 'commands', query: '', index: 0 } }
      return { ...state, palette: state.palette ? null : { query: '', index: 0, mode: 'commands', scope: null } }

    case 'OPEN_FILE_SEARCH':
      if (state.palette?.mode === 'files') return { ...state, palette: null }
      // (Over a file's preview, it goes to another file.)
      return { ...state, filePreview: null, palette: { query: '', index: 0, mode: 'files', scope: action.scope } }

    case 'SET_PALETTE_MODE':
      return state.palette ? { ...state, palette: { ...state.palette, mode: action.mode, query: action.query ?? '', index: 0 } } : state

    case 'SET_PALETTE_SCOPE':
      return state.palette ? { ...state, palette: { ...state.palette, scope: action.scope, index: 0 } } : state

    case 'OPEN_FILE_PREVIEW':
      return { ...state, palette: null, filePreview: { projectId: action.projectId, path: action.path } }

    case 'CLOSE_FILE_PREVIEW':
      return { ...state, filePreview: null }

    case 'CLOSE_PALETTE':
      return { ...state, palette: null }

    case 'SET_PALETTE_QUERY':
      return state.palette ? { ...state, palette: { ...state.palette, query: action.query, index: 0 } } : state

    case 'SET_PALETTE_INDEX':
      return state.palette ? { ...state, palette: { ...state.palette, index: Math.max(0, action.index) } } : state

    case 'TOAST':
      return withToast(state, action.text, action.tone)

    case 'DISMISS_TOAST':
      return state.toast && state.toast.id === action.id ? { ...state, toast: null } : state

    case 'HYDRATE':
      return { ...state, projects: action.projects, tasks: action.tasks, prefs: action.prefs, keyHigh: action.keyHigh ?? state.keyHigh }

    case 'OPEN_ADD_PROJECT':
      return { ...state, addProjectOpen: true }

    case 'CLOSE_ADD_PROJECT':
      return { ...state, addProjectOpen: false }

    case 'PROJECT_ADDED':
      return withToast(
        { ...state, projects: [...state.projects, action.project], addProjectOpen: false, view: 'board', projectId: action.project.id, boardFocus: null },
        `Added ${action.project.name}${action.project.lang ? ` · ${action.project.lang}` : ''}`,
        'done'
      )

    case 'OPEN_SETTINGS':
      return { ...state, view: 'settings', settingsSection: action.section, palette: null, addProjectOpen: false }

    case 'SET_PREFS':
      return { ...state, prefs: { ...state.prefs, ...action.patch } }

    case 'PREFS_LOADED':
      return { ...state, prefs: action.prefs }

    case 'PROJECTS_LOADED':
      return { ...state, projects: action.projects }

    case 'KEYBINDINGS_LOADED':
      return { ...state, keybindings: action.bindings }

    case 'OPEN_PALETTE':
      return { ...state, palette: { query: action.query, index: 0, mode: 'commands', scope: null } }

    case 'OPEN_TASK_SHEET':
      return { ...state, taskSheet: action.taskId, palette: null }

    case 'OPEN_OUTSIDE':
      return { ...state, outsideFor: action.projectId, palette: null }

    case 'UPDATE_PROJECT':
      return {
        ...state,
        projects: state.projects.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p))
      }

    case 'REMOVE_PROJECT':
      return withToast(
        {
          ...state,
          projects: state.projects.filter((p) => p.id !== action.id),
          tasks: state.tasks.filter((t) => t.projectId !== action.id),
          projectId: state.projectId === action.id ? null : state.projectId,
          view: state.projectId === action.id && state.view === 'board' ? 'dashboard' : state.view,
          settingsSection: state.settingsSection === `project:${action.id}` ? 'general' : state.settingsSection
        },
        'Project removed.'
      )

    default:
      return state
  }
}

/**
 * Moves a task in the list (a column shows its tasks in list order): in front
 * of `before`, or after the last task of its column (and project) when null.
 */
export function placeTask(tasks: Task[], id: string, before: string | null): Task[] {
  const task = tasks.find((t) => t.id === id)
  if (!task || before === id) return tasks
  const rest = tasks.filter((t) => t.id !== id)
  let at = before ? rest.findIndex((t) => t.id === before) : -1
  if (at < 0) {
    const last = rest.map((t, i) => (t.col === task.col && t.projectId === task.projectId ? i : -1)).reduce((a, b) => Math.max(a, b), -1)
    at = last < 0 ? rest.length : last + 1
  }
  return [...rest.slice(0, at), task, ...rest.slice(at)]
}
