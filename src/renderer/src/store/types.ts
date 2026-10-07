import type { AgentKind, AgentStatusUpdate, BaseStatus, BoardColumn, BranchResult, Issue, Note, PrDetails, Prefs, Project, Task, ViewName } from '@shared/types'
import type { BoardFilter, BoardGroup, BoardPrefs } from '../lib/boardFilter'
import type { Criterion } from '@shared/types'
import type { KeyBinding } from '@shared/keybindings'
import type { NavHistory } from './history'

export type WorkspaceTab = 'terminal' | 'files' | 'changes' | 'timeline' | 'preview' | 'notes'

export interface StartModalState {
  taskId: string
  agentKind: AgentKind
  branch: string
  message: string
  /** Other projects whose repositories the task gets a worktree in too. */
  repos: string[]
  /** The shared folder of a task in several repos, once made. */
  taskDir: string | null
  phase: 'config' | 'launch'
  step: number
  background: boolean
  worktreePath: string | null
  launchedAt: number | null
  setup: SetupState | null
  /** Untracked files copied into the new worktree (Project settings). */
  copied: string[]
  /** What "Create branch" did, once it has. */
  branchInfo: BranchResult | null
  /** Why the current step failed; the launch waits for Retry or Cancel. */
  error: string | null
  /** The agent's model for this task ('' its default), plan first, and images that go with the first message. */
  model: string
  planFirst: boolean
  images: string[]
  /** No branch or worktree: it works in the project's own checkout, as it is (Task.inPlace). */
  inPlace: boolean
}

/** The launch flow's "Run setup" step, running the project's setup command. */
export interface SetupState {
  status: 'running' | 'ok' | 'failed' | 'ignored'
  line: string | null
  exitCode: number | null
}

/** Where Go to file searches: a task's worktree, or (taskId null) the project's main checkout. */
export interface FileScope {
  projectId: string
  taskId: string | null
}

export interface PaletteState {
  query: string
  index: number
  /** Commands (Ctrl+K) or Go to file (Ctrl+P). */
  mode: 'commands' | 'files'
  /** Go to file's checkout. */
  scope: FileScope | null
}

/** A file of a project's main checkout, shown read-only (Go to file outside a task). */
export interface FilePreviewState {
  projectId: string
  path: string
}

export interface ToastState {
  id: number
  text: string
  tone: 'plain' | 'waiting' | 'done'
}

export interface AppState {
  projects: Project[]
  tasks: Task[]

  view: ViewName
  projectId: string | null
  taskId: string | null
  /** Asked of the workspace (show its changes, its files…) - done once per `n`, on top of its layout. */
  wsIntent: { tab: WorkspaceTab; n: number } | null

  boardFocus: string | null
  /** The board's search and filters. */
  /** Each project's board filters and lanes, and the saved views (kept; see boardFilter). */
  board: BoardPrefs
  addingTask: boolean
  newTaskTitle: string
  /** The task the one being added builds on. */
  newTaskAfter: string | null

  agentFilter: 'all' | 'needs' | 'working' | 'done'

  wtSelected: string | null

  start: StartModalState | null
  palette: PaletteState | null
  filePreview: FilePreviewState | null
  toast: ToastState | null
  addProjectOpen: boolean

  prefs: Prefs
  /** keybindings.json: the user's own shortcuts, over the defaults. */
  keybindings: KeyBinding[]
  /** 'general' | 'agents' | 'git' | 'terminal' | 'project:<id>' */
  settingsSection: string
  /** The task open in the task sheet (its title, description and criteria, to edit). */
  taskSheet: string | null
  /** The project whose outside work (worktrees, branches, conversations no task holds) is open to bring in. */
  outsideFor: string | null
  /** The project whose GitHub issues are being picked for import. */
  issuesFor: string | null
  /** Notes (Markdown files in the notes folder), newest first. */
  notes: Note[]
  /** The note open in the Notes screen. */
  noteId: string | null
  /** Bumped by each OPEN_NOTE with a note: the Notes screen opens its tab (again, after it was closed). */
  noteSeq: number
  /** Each project's base branch against origin (fetched in the background). */
  base: Record<string, BaseStatus>
  /** The archive of finished tasks, open for this project. */
  archiveFor: string | null
  /** The highest task number each project has given out (keys are never given out twice). */
  keyHigh: Record<string, number>
  /** The places visited before (and after, once gone back): the title bar's ‹ › buttons. */
  nav: NavHistory
  /** Zen mode: only the terminal or editor shows (the sidebar, headers and side panels hide). */
  zen: boolean
}

export type Action =
  | { type: 'NAV'; view: ViewName; projectId?: string | null; taskId?: string | null }
  | { type: 'OPEN_TASK'; taskId: string; tab?: WorkspaceTab }
  | { type: 'SET_BOARD_FOCUS'; id: string | null }
  /** `before`: the card it goes in front of (null: the column's end); left out, it keeps its place. */
  | { type: 'MOVE_TASK'; id: string; col: BoardColumn; before?: string | null }
  /** `after`: the new task builds on that one. */
  | { type: 'BEGIN_ADD_TASK'; after?: string }
  | { type: 'CANCEL_ADD_TASK' }
  | { type: 'SET_NEW_TASK_TITLE'; title: string }
  /** `describe`: open the new task's sheet, to write its description. */
  | { type: 'COMMIT_ADD_TASK'; describe?: boolean }
  | { type: 'SET_TASK_DESC'; id: string; desc: string }
  | { type: 'SET_AGENT_FILTER'; filter: AppState['agentFilter'] }
  | { type: 'SELECT_WORKTREE'; id: string | null }
  | { type: 'OPEN_START_MODAL'; taskId: string }
  | { type: 'CLOSE_START_MODAL' }
  | { type: 'SET_START_AGENT'; agentKind: AgentKind }
  | { type: 'SET_START_BRANCH'; branch: string }
  | { type: 'SET_START_MESSAGE'; message: string }
  | { type: 'LAUNCH_START' }
  | { type: 'SET_START_WORKTREE_PATH'; path: string; copied?: string[] }
  | { type: 'ADVANCE_LAUNCH_STEP' }
  | { type: 'SET_START_BRANCH_INFO'; info: BranchResult }
  | { type: 'LAUNCH_FAILED'; message: string }
  | { type: 'LAUNCH_RETRY' }
  | { type: 'BACKGROUND_START' }
  | { type: 'FINISH_START' }
  | { type: 'AGENT_STATUS'; update: AgentStatusUpdate }
  | { type: 'SETUP_UPDATE'; patch: Partial<SetupState> }
  | { type: 'LAUNCH_ANYWAY' }
  | { type: 'RUN_TESTS'; taskId: string }
  | { type: 'TESTS_FINISHED'; taskId: string; exitCode: number }
  /** Types a message into the task's agent (restarting it if it isn't running). */
  | { type: 'MESSAGE_AGENT'; taskId: string; text: string; toast: string }
  | { type: 'ANSWER_TASK'; taskId: string; answer: 'yes' | 'no' | 'retry' }
  | { type: 'PAUSE_TASK'; taskId: string }
  | { type: 'RESUME_TASK'; taskId: string }
  | { type: 'PRIMARY_ACTION'; taskId: string }
  | { type: 'TOGGLE_PALETTE' }
  | { type: 'SET_START_REPOS'; repos: string[] }
  | { type: 'SET_START_TASK_DIR'; dir: string | null }
  /** A task's repositories changed (attached one); with its new folder and worktree when they moved. */
  | { type: 'SET_TASK_REPOS'; taskId: string; repos: string[]; taskDir?: string | null; worktreePath?: string | null }
  /** Go to file in this checkout; closes it when it's already open. */
  | { type: 'OPEN_FILE_SEARCH'; scope: FileScope }
  | { type: 'SET_PALETTE_MODE'; mode: 'commands' | 'files'; query?: string }
  | { type: 'SET_PALETTE_SCOPE'; scope: FileScope }
  | { type: 'OPEN_FILE_PREVIEW'; projectId: string; path: string }
  | { type: 'CLOSE_FILE_PREVIEW' }
  | { type: 'CLOSE_PALETTE' }
  | { type: 'SET_PALETTE_QUERY'; query: string }
  | { type: 'SET_PALETTE_INDEX'; index: number }
  /** A task's work was merged or handed to its pull request - into Done. */
  | { type: 'FINISH_TASK'; taskId: string; note: string; toast: string }
  | { type: 'SET_TASK_PR'; taskId: string; pr: Task['pr'] }
  | { type: 'SET_BOARD_FILTER'; patch: Partial<BoardFilter> | null }
  | { type: 'SET_BOARD_GROUP'; group: BoardGroup }
  | { type: 'SET_CRITERIA'; taskId: string; criteria: Criterion[] }
  | { type: 'AGENT_LIMIT'; taskId: string; until: number | null; reason: string }
  | { type: 'WAKE_TASK'; taskId: string }
  | { type: 'CANCEL_SLEEP'; taskId: string }
  | { type: 'VERIFY_CRITERION'; taskId: string; index: number; passed: boolean; note: string; image: string | null }
  | { type: 'AGENT_ADD_TASK'; key: string; projectId: string; title: string; desc: string; col: 'backlog' | 'ready'; buildsOn?: string | null; toast?: string }
  /** The task it builds on (null: none - it branches from the project's default branch). */
  | { type: 'SET_BUILDS_ON'; taskId: string; parentId: string | null }
  | { type: 'TOGGLE_BOARD_LANE'; key: string }
  | { type: 'SAVE_BOARD_VIEW'; name: string }
  | { type: 'DELETE_BOARD_VIEW'; id: string }
  | { type: 'SET_TASK_REPO_PR'; taskId: string; repoId: string; pr: NonNullable<Task['repoPrs']>[string] }
  | { type: 'RENAME_TASK'; taskId: string; title: string }
  | { type: 'DELETE_TASK'; taskId: string; toast: string }
  | { type: 'CLEAR_DONE'; projectId: string; count: number }
  /** The task's worktree was removed - it goes back to Ready (its branch stays, so starting again picks it up). */
  | { type: 'DETACH_WORKTREE'; taskId: string }
  /** Queue tasks with their default agent, branch and message (Settings → Agents: max working at once). */
  | { type: 'QUEUE_TASKS'; taskIds: string[] }
  | { type: 'UNQUEUE_TASK'; taskId: string }
  /** A slot is free: launch the queued task in the background. */
  | { type: 'START_QUEUED'; taskId: string }
  | { type: 'OPEN_ISSUES'; projectId: string | null }
  | { type: 'ADD_TASK'; task: Task }
  | { type: 'NOTES_LOADED'; notes: Note[] }
  | { type: 'NOTE_SAVED'; note: Note; replaces?: string }
  | { type: 'NOTE_DELETED'; id: string; quiet?: boolean }
  /** Show a note in the Notes screen (null: just the screen). */
  | { type: 'OPEN_NOTE'; id: string | null }
  | { type: 'IMPORT_ISSUES'; projectId: string; issues: Issue[] }
  | { type: 'TOAST'; text: string; tone?: ToastState['tone'] }
  | { type: 'DISMISS_TOAST'; id: number }
  | { type: 'HYDRATE'; projects: Project[]; tasks: Task[]; prefs: Prefs; keyHigh?: Record<string, number> }
  | { type: 'OPEN_ADD_PROJECT' }
  | { type: 'CLOSE_ADD_PROJECT' }
  | { type: 'PROJECT_ADDED'; project: Project }
  | { type: 'OPEN_SETTINGS'; section: string }
  | { type: 'SET_PREFS'; patch: Partial<Prefs> }
  /** settings.json changed on disk - taken as it is, not saved back. */
  | { type: 'PREFS_LOADED'; prefs: Prefs }
  /** Projects reloaded (a .switchyard settings file changed). */
  | { type: 'PROJECTS_LOADED'; projects: Project[] }
  | { type: 'KEYBINDINGS_LOADED'; bindings: KeyBinding[] }
  | { type: 'OPEN_PALETTE'; query: string }
  | { type: 'OPEN_TASK_SHEET'; taskId: string | null }
  | { type: 'OPEN_OUTSIDE'; projectId: string | null }
  | { type: 'UPDATE_PROJECT'; id: string; patch: Partial<Project> }
  | { type: 'REMOVE_PROJECT'; id: string }
  | { type: 'SET_START_OPTIONS'; patch: Partial<Pick<StartModalState, 'model' | 'planFirst' | 'images' | 'inPlace'>> }
  /** The project's scratchpad in the workspace (made the first time). */
  | { type: 'OPEN_SCRATCH'; projectId: string }
  /** An agent starts in the scratchpad (or another task without one): it becomes the task's. */
  | { type: 'SET_TASK_AGENT'; taskId: string; agentKind: AgentKind }
  | { type: 'BASE_STATUS'; statuses: BaseStatus[] }
  /** Its pull request's checks and reviews, as just read. */
  | { type: 'SET_PR_DETAILS'; taskId: string; details: PrDetails }
  /** Finished tasks off the board, into the archive (or back). */
  | { type: 'ARCHIVE_TASKS'; taskIds: string[] }
  | { type: 'UNARCHIVE_TASK'; taskId: string }
  | { type: 'OPEN_ARCHIVE'; projectId: string | null }
  /** Keep it at the top of its column (or not). */
  | { type: 'PIN_TASK'; taskId: string; pinned: boolean }
  | { type: 'SET_ZEN'; on: boolean }
  /** Back to the place before (-1), or forward again (1). */
  | { type: 'GO'; dir: -1 | 1 }
