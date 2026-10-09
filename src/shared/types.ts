import type { KeyBinding } from './keybindings'

export type AgentStatus = 'working' | 'waiting' | 'failed' | 'done' | 'paused' | null

export type ViewName = 'dashboard' | 'board' | 'agents' | 'worktrees' | 'workspace' | 'settings' | 'notes' | 'usage' | 'team' | 'inbox' | 'summary' | 'map' | 'prs'

export type BoardColumn = 'backlog' | 'ready' | 'progress' | 'review' | 'done'

export type BuiltinAgentKind = 'claude' | 'codex' | 'gemini' | 'aider' | 'opencode' | 'cursor' | 'copilot'
/** A built-in agent, or one a plugin adds (its own kind). */
export type AgentKind = BuiltinAgentKind | (string & {})

export interface AgentDef {
  kind: AgentKind
  name: string
  short: string
  bin: string
  note: string
  /** Args that reopen the agent's previous conversation in the same folder. */
  resumeArgs?: string[]
  /** Flag the first message goes after, when a bare argument wouldn't keep the session interactive. */
  promptFlag?: string
  /** No way to start it with a message and stay interactive: the message is typed in once it's ready. */
  typesPrompt?: boolean
  /** How it gets Switchyard's tools (MCP), if it can be given a server at launch. */
  tools?: 'claude' | 'codex' | 'opencode' | 'copilot'
  /** The plugin that adds it (none: built in). */
  plugin?: string
}

export interface Project {
  id: string
  name: string
  repoPath: string
  repo: string
  lang: string
  prefix: string
  defaultBranch?: string
  setupCmd?: string
  testCmd?: string
  devCmd?: string
  /** Agent this project starts tasks with; unset uses the global default. */
  agentKind?: AgentKind
  /** Untracked files (e.g. .env, config/master.key) copied into each new worktree. */
  copyFiles?: string[]
  /** New worktrees get a copy of the checkout's installed dependencies (when their lockfile matches); unset installs (the setup command). */
  shareDeps?: 'copy'
  /** Which folders those are (patterns; default node_modules). */
  depFolders?: string[]
  /** KEY=value lines, set for every process run in the project's worktrees. */
  env?: string
  /** The Start modal's first message; {key} {title} {desc} {branch}. */
  messageTemplate?: string
  /**
   * Settings that came from the repository's own files instead of
   * Switchyard's storage: .switchyard/settings.json (shared, committed) or
   * .switchyard/settings.local.json (this checkout only). Not stored.
   */
  sources?: Partial<Record<ProjectSettingKey | keyof Prefs, 'shared' | 'local'>>
  /**
   * What the repository's shared settings file asks for that runs things or
   * widens what agents may do (commands, environment, permissions, shell) -
   * held back until you trust it. Null/absent: nothing waiting.
   */
  untrusted?: { hash: string; values: Record<string, unknown> } | null
  /**
   * Preferences the repository's files set for this project (e.g.
   * "editorTabSize": 4), over this machine's settings.json. Not stored.
   */
  prefs?: Partial<Prefs>
  /** A settings file that couldn't be read ("settings.json: … at line 4"). Not stored. */
  settingsError?: string
}

/** Project settings a repository can carry in .switchyard/settings.json. */
export type ProjectSettingKey = 'prefix' | 'defaultBranch' | 'lang' | 'agentKind' | 'setupCmd' | 'testCmd' | 'devCmd' | 'copyFiles' | 'shareDeps' | 'depFolders' | 'messageTemplate' | 'env'

/** Where a project setting is kept: Switchyard on this machine, or the repo's shared file. */
export type ProjectSettingScope = 'machine' | 'shared'

/** keybindings.json as it applies: its usable entries, and what's wrong with the file or the rest. */
export interface KeybindingsState {
  bindings: KeyBinding[]
  /** The file can't be read at all; the last good shortcuts stay in use. */
  error: string | null
  /** Entries that were skipped, and why. */
  problems: string[]
}

/** A settings file that has an error; the last good values stay in use. */
export interface SettingsFileError {
  file: string
  message: string
}

export interface Worktree {
  id: string
  projectId: string
  branch: string
  path: string
  headSha: string
  ahead: number
  behind: number
  dirtyCount: number
  createdAt: number
  taskId?: string
}

export interface Task {
  id: string
  key: string
  projectId: string
  title: string
  desc?: string
  col: BoardColumn
  agentKind: AgentKind | null
  st: AgentStatus
  worktreeId: string | null
  /** The home repository's worktree (for a task in several repos, inside taskDir). */
  worktreePath: string | null
  /**
   * Other projects' repositories the task works in too: the same branch, a
   * worktree in each. Its card shows on their boards as well.
   */
  repos?: string[]
  /**
   * A task in several repos: the folder holding one worktree per repository
   * (named after the repository's folder). Its agent works here and sees
   * them as sibling folders.
   */
  taskDir?: string | null
  branch: string | null
  ask: string | null
  /** What a waiting agent wants: a yes/no approval, or its next message. */
  askKind?: AskKind | null
  doneNote: string | null
  firstMessage: string | null
  /** Latest run of the project's test command in this task's worktree. */
  lastTest?: TestRun | null
  createdAt: number
  startedAt: number | null
  lastActivityAt: number
  /** Time the agent has spent working (ms), not counting the current stretch. */
  workMs?: number
  /** When the current working stretch began; null while not working. */
  workingSince?: number | null
  /** Pull request opened for the task branch. */
  pr?: { url: string; number: number | null; state: PullRequest['state'] } | null
  /** In several repositories: the other repositories' pull requests, by project id. */
  repoPrs?: Record<string, { url: string; number: number | null; state: PullRequest['state'] }> | null
  /** What the agent is doing right now (Claude Code only). */
  activity?: string | null
  /** The agent's Claude Code session, to resume exactly it and read its transcript. */
  session?: AgentSession | null
  /** The GitHub issue it came from; merging closes it. */
  issue?: { number: number; url: string } | null
  /** Waiting for a free agent slot (Settings → Agents: max working at once). */
  queued?: { agentKind: AgentKind; branch: string; message: string; at: number; model?: string | null; planFirst?: boolean; images?: string[]; inPlace?: boolean; existingWorktree?: string | null; baseBranch?: string | null } | null
  /** What done means: checked by the agent (verify_criterion) or you, with evidence. */
  criteria?: Criterion[]
  /** Its agent hit a usage limit: resumed on its own at `until` (unknown: tried again in an hour). */
  sleeping?: { until: number | null; reason: string; since: number } | null
  /** The outside work it was brought in from (an OutsideItem's id: a worktree, branch or conversation). */
  outside?: string | null
  /** The branch it starts from, compares against and merges into, in its home repository (picked at Start); unset: the project's default. */
  baseBranch?: string | null
  /** The task it builds on: its branch starts from that one's, and compares against it until it's merged (see shared/stack). */
  buildsOn?: string | null
  /** Chosen in the Start modal: the agent's model (empty: its default), and whether it plans first. */
  model?: string | null
  planFirst?: boolean
  /** Its pull request's checks and reviews, as last read. */
  prDetails?: PrDetails | null
  /** Put away from the board (finished tasks); still searchable in the archive. */
  archivedAt?: number | null
  /** Kept at the top of its column (when it was pinned: the latest goes first). */
  pinnedAt?: number | null
  /** When it came into its column (the board: how long it's been there, stale cards, auto-archive). */
  colAt?: number
  /**
   * Works in the project's own checkout, on whatever is checked out there -
   * no branch or worktree of its own (an exploration, an investigation).
   * Nothing is merged or removed when it's done; `branch` stays null.
   */
  inPlace?: boolean
  /** The project's scratchpad: always there, in its own checkout, off the board (see shared/scratch). */
  scratch?: boolean
}

/**
 * What happened to a task, kept for the daily summary (a task's own history
 * goes when it's finished): an agent's turn, a move to Review, a failure,
 * the finish.
 */
export interface ActivityEvent {
  at: number
  kind: 'turn' | 'review' | 'failed' | 'finished'
  taskId: string
  taskKey: string
  title: string
  projectId: string
  agentKind?: AgentKind | null
  /** A turn: the files it changed and their lines, and its last words. */
  files?: string[]
  added?: number
  deleted?: number
  said?: string | null
  /** Finished: how (merged, its pull request); failed: why. */
  note?: string | null
}

/** A project's files on its default branch, for the repository map. */
export interface MapTree {
  projectId: string
  ref: string
  files: { path: string; size: number }[]
  /** Only the first 30 000 files. */
  truncated: boolean
}

/** Where a task works in a project: the files it changed (paths in the repository), and the one its agent is on. */
export interface MapActivity {
  taskId: string
  files: string[]
  now: string | null
  nowAt: number
  /** The tool it was using there (Claude Code), e.g. "Edit". */
  tool: string | null
}

/** An agent conversation found on disk (Claude Code's or Codex's), started outside Switchyard. */
export interface OutsideSession {
  agentKind: 'claude' | 'codex'
  id: string
  /** Its transcript file. */
  path: string
  cwd: string
  /** Its last activity. */
  at: number
  /** What it was first asked, and its last answer (short). */
  first: string | null
  last: string | null
  branch?: string | null
}

/**
 * Work in a project that no task holds: a worktree, a branch with its own
 * commits, or a conversation in the main checkout - to bring in as a task.
 */
export interface OutsideItem {
  /** Stable: 'wt:<path>', 'br:<project>:<branch>', 'cs:<session id>'. */
  id: string
  kind: 'worktree' | 'branch' | 'session'
  projectId: string
  branch?: string
  path?: string
  /** Commits of its own (vs the default branch), changes not committed, its last commit. */
  ahead?: number
  dirty?: number
  lastCommitAt?: number
  subject?: string
  /** Agent conversations in it (newest first); a 'session' item is that one. */
  sessions: OutsideSession[]
  /** Its latest activity. */
  at: number
}

/** The activity log, and when its summary was last looked at and last announced (a day, YYYY-MM-DD). */
export interface ActivityLog {
  events: ActivityEvent[]
  seenAt: number
  announced: string
}

/** An agent's terminal said it hit a usage limit. */
export interface AgentLimit {
  taskId: string
  /** When it resets, if it said. */
  resetAt: number | null
  text: string
}

/** A message on the Team channel: between tasks' agents, from you, or from Switchyard. */
export interface TeamMessage {
  id: string
  at: number
  /** A task id, 'user' or 'switchyard'. */
  from: string
  /** The task whose agent it's for. */
  to: string
  text: string
  /**
   * queued: waiting for the agent to finish its turn; delivered: typed into
   * its session; read: it fetched it (read_messages); held: the loop guard
   * stopped it until you let it through.
   */
  state: 'queued' | 'delivered' | 'read' | 'held'
}

/** An acceptance criterion: what "done" means for a task, and the proof it's met. */
export interface Criterion {
  id: string
  text: string
  status: 'open' | 'passed' | 'failed'
  /** How it was checked (the agent's words, or yours). */
  note?: string | null
  /** A screenshot kept as evidence (a file in Switchyard's data folder). */
  image?: string | null
  by?: 'agent' | 'you' | null
  at?: number | null
}

export interface ReviewComment {
  id: string
  taskId: string
  path: string
  /** Row in the diff when written - only used by comments from older versions. */
  line: number
  /** The file line it's about (new side), or for a removed line the old side. */
  newLine?: number | null
  oldLine?: number | null
  /** The line's text when written, to tell when the code has changed since. */
  code?: string
  /** A comment on several lines: the last one's file line (new side). */
  toLine?: number | null
  text: string
  createdAt: number
  /** Part of a review still being written - sent with the rest. (Older comments went at once.) */
  pending?: boolean
  /** Dealt with: shown folded away. */
  resolved?: boolean
  /** When it went to the agent. */
  sentAt?: number | null
  /** Its number for the agent ("[3]"), from when it was sent - the agent answers by it. */
  ref?: number | null
  /** Sent (or replied to) and the agent's answer not in yet. */
  awaiting?: boolean
  /** The conversation on it after it was sent: your follow-ups and the agent's answers. */
  thread?: CommentReply[]
}

export interface CommentReply {
  from: 'you' | 'agent'
  text: string
  at: number
}

/**
 * A snapshot of a task's files, taken as its agent's session starts and
 * after each turn (and before a rewind): a commit kept under
 * refs/switchyard/cp/, apart from the branch - nothing on the branch or in
 * the index changes. Rewinding puts the files back as they were in one.
 */
export interface Checkpoint {
  id: string
  taskId: string
  at: number
  kind: 'start' | 'turn' | 'rewind'
  /** For a turn: its number in the task (1, 2, …). */
  turn: number | null
  /** For a rewind: the checkpoint it went back to (what was there before is this one). */
  rewoundTo?: string | null
  /** Each of the task's checkouts: its folder in the task ('' for a single-repo task), the snapshot, and HEAD then. */
  snaps: CheckpointSnap[]
  /** What it was asked, and what it said (as far as known). */
  prompt: string | null
  said: string | null
  /** The files that changed since the checkpoint before it. */
  files: { path: string; status: 'added' | 'modified' | 'deleted'; added: number; deleted: number }[]
  /** Tokens the turn used, by model (Claude Code sessions). */
  tokens: Record<string, import('./usage').UsageTokens> | null
}

export interface CheckpointSnap {
  dir: string
  path: string
  /** The repository's git folder (its refs outlive the worktree). */
  gitDir: string
  sha: string
  head: string
}

/** What a rewind did. */
export interface RewindResult {
  checkpoint: Checkpoint
  restored: number
  removed: number
  /** Repositories whose branch has commits made after the checkpoint (they stay; the files go back). */
  headMoved: string[]
}

/**
 * Tasks whose changes collide: two tasks changing the same files in one
 * repository (their edits may still merge cleanly), or a task whose
 * changes won't merge with its base branch any more. Uncommitted work counts.
 */
export interface ConflictPair {
  repoId: string
  a: string
  /** The other task - null for the base branch. */
  b: string | null
  /** Files both changed. */
  files: string[]
  /** Of those, the ones that won't merge cleanly. */
  conflicts: string[]
}

export interface ConflictReport {
  at: number
  pairs: ConflictPair[]
  mergeCheck: boolean
  /** The files each running task changes (a multi-repo task's start with the repository's name and a colon). */
  touched?: Record<string, string[]>
}

/** Something an agent asked Switchyard (its MCP tools) that the window does. */
export type AgentToolRequest =
  | { kind: 'create-task'; taskId: string; title: string; description: string; ready: boolean; buildsOn?: boolean }
  | { kind: 'ask-user'; taskId: string; question: string }
  | { kind: 'tests-finished'; taskId: string; exitCode: number | null }
  | { kind: 'verify-criterion'; taskId: string; index: number; passed: boolean; note: string; image: string | null }
  | { kind: 'note'; taskId: string; text: string }
  /** The task's shell tabs, with their names (the agent reads and types into them). */
  | { kind: 'list-terminals'; taskId: string }
  /** A shell the agent opened (already running): it becomes one of the task's tabs. */
  | { kind: 'terminal-opened'; taskId: string; id: string; name: string }
  | { kind: 'write-note'; taskId: string; title: string; body: string; id: string | null }
  | { kind: 'ready-for-review'; taskId: string; summary: string }

/** A task asked for from the command line (`switchyard new …`) or a switchyard:// link. */
export interface CliRequest {
  title: string
  desc: string
  /** An agent kind (claude, codex…): the Start dialog opens with it. */
  agent: string | null
  /** Start it straight away (in the background). */
  start: boolean
  /** The project named, or the one the command ran in; null: the one open in the window. */
  projectId: string | null
}

/** Review comments changed outside the window: a task's agent answered some. */
export interface CommentsChange {
  taskId: string
  replies: number
}

export interface TestRun {
  status: 'running' | 'passed' | 'failed'
  exitCode: number | null
  at: number
}

export type AskKind = 'permission' | 'input'

export interface AgentStatusUpdate {
  taskId: string
  st: 'working' | 'waiting' | 'failed' | 'done'
  askKind: AskKind | null
  ask: string | null
  exitCode: number | null
  /** What it's doing right now ("Editing user.rb") - from Claude Code's hooks. */
  activity?: string | null
  /** The Claude Code session (id and transcript file) - from its hooks. */
  session?: AgentSession | null
}

export interface AgentSession {
  id: string
  transcript: string
}

/** What a Claude Code session's transcript says it did. */
export interface TranscriptSummary {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  /** Messages the user (or Switchyard) sent. */
  prompts: number
  /** Tool calls, oldest first (the most recent ones). */
  tools: { name: string; what: string; at: number }[]
  toolCount: number
  model: string | null
}

/** A note: a Markdown file in the notes folder. */
export interface Note {
  /** The file name without .md. */
  id: string
  /** Its first heading (or first line). */
  title: string
  /** Markdown, without the front matter. */
  body: string
  projectId: string | null
  taskId: string | null
  pinned: boolean
  createdAt: number
  /** The file's modification time. */
  updatedAt: number
  file: string
}

/** What a save writes; no id makes a new note. */
export interface NoteDraft {
  id?: string
  body: string
  projectId: string | null
  taskId: string | null
  pinned: boolean
  /** A note still named "note.md" (made before it had a title) takes its title's name. */
  nameFromTitle?: boolean
}

/** The themes (built-in and the user's), and what's wrong in the user's files. */
export interface ThemesState {
  themes: import('./themes').Theme[]
  problems: string[]
  /** The themes folder. */
  dir: string
}

export type NoticeKind = 'waiting' | 'permission' | 'failed' | 'done' | 'tests-passed' | 'tests-failed' | 'finished' | 'pr-merged' | 'spend' | 'review-reply' | 'agent-question' | 'team' | 'limit' | 'pr' | 'update'

/** A new version of Switchyard: downloaded and ready to install, or out (to download by hand - a Mac build that can't install it itself). */
export interface UpdateState {
  kind: 'ready' | 'available'
  version: string
  /** Its release page. */
  url: string
}

/** Something that happened that you'd want to know about: the notification center's entries. */
export interface Notice {
  id: string
  at: number
  kind: NoticeKind
  taskId: string
  taskKey: string
  taskTitle: string
  projectId: string
  /** What happened, e.g. "Claude Code needs your approval". */
  text: string
  /** Its details (what it asks, a note). */
  detail?: string | null
  read: boolean
}

/** What an import of notes did. */
export interface NoteImportResult {
  /** The notes made, in file order. */
  ids: string[]
  /** Already here (the same title and text). */
  skipped: number
  /** Files that couldn't be read or saved. */
  failed: string[]
  /** Markdown and text files found. */
  found: number
  /** Stopped at the limit of files per import. */
  truncated: boolean
  /** Images copied into the notes folder's attachments. */
  images: number
}

/** A checkout's files for Go to file (worktree-relative, "/"-separated). */
export interface CheckoutFiles {
  files: string[]
  /** Files with uncommitted changes. */
  changed: string[]
  /** More files than are listed. */
  truncated: boolean
}

/** An open GitHub issue, for importing as a task. */
export interface Issue {
  number: number
  title: string
  body: string
  url: string
  labels: string[]
}

export interface PtyInfo {
  running: boolean
  exitCode: number | null
}

export interface PtySpawnOptions {
  id: string
  cwd: string
  cmd?: string
  args?: string[]
  execCommand?: string
  /** Extra environment variables on top of the app's own. */
  env?: Record<string, string>
  cols?: number
  rows?: number
}

export interface FileEntry {
  path: string
  isDir: boolean
  status: 'added' | 'modified' | 'unchanged' | 'deleted'
  /** git ignores it (shown dimmed, like .env). */
  ignored?: boolean
}

export interface DiffLine {
  kind: '@' | '+' | '-' | ' '
  text: string
  oldLine: number | null
  newLine: number | null
  /** The file ends on this line without a newline ("\ No newline at end of file"). */
  noEol?: true
}

export interface GitWorktreeInfo {
  path: string
  branch: string
  headSha: string
  isMain: boolean
  locked: boolean
  prunable: boolean
}

export interface RepoInfo {
  repo: string
  defaultBranch: string
  root: string
}

export interface WorktreeStatus {
  ahead: number
  behind: number
  dirty: number
  /** Time of the checked-out commit (ms), 0 when unknown. */
  lastCommitAt: number
}

export interface DiffStat {
  files: number
  added: number
  deleted: number
}

export interface ProjectMeta {
  lang: string
  devCmd?: string
  testCmd?: string
  setupCmd?: string
  /** The file each value was read from ("Gemfile", "package.json › scripts.dev"). */
  src: { lang?: string; setupCmd?: string; testCmd?: string; devCmd?: string }
}

/** What a scan of a folder finds, for the New project flow and Re-scan. */
export interface RepoScan {
  path: string
  isGit: boolean
  repo: string
  defaultBranch: string
  branchSrc: string
  meta: ProjectMeta
}

/** One row of the New project folder browser. */
export interface BrowseEntry {
  name: string
  path: string
  isDir: boolean
  /** Checked-out branch when the folder is a git repository. */
  git: string | null
  /** Number of entries inside (folders only; null when unreadable). */
  items: number | null
}

export interface BrowsePlace {
  label: string
  path: string
}

/** Global preferences (per-project settings live on Project). */
export interface Prefs {
  defaultAgent: AgentKind
  openAfterStart: boolean
  notifyInput: boolean
  notifyDone: boolean
  sound: boolean
  confirmQuit: boolean
  agentsOff: AgentKind[]
  /** Agents working at once; more starts wait in the queue. 0: no limit. */
  maxAgents: number
  agentArgs: Partial<Record<AgentKind, string>>
  editPerm: 'agent' | 'ask' | 'auto'
  shellPerm: 'agent' | 'ask' | 'allowlist' | 'auto'
  allowlist: string
  /** Empty: a .worktrees folder inside each repository. */
  worktreeRoot: string
  branchPattern: string
  pruneAfterMerge: boolean
  /** Done deletes the task's local branch once its work is in the base branch (merged here, or its PR merged). Off: it's kept. */
  deleteBranchOnFinish: boolean
  // ── The board (Settings → Board; a project can have its own) ──
  /** Columns not shown (In Progress always is). */
  boardHidden: BoardColumn[]
  /** Columns' own names ("Todo", "Shipped"); unset: the usual ones. */
  boardNames: Partial<Record<BoardColumn, string>>
  /** At most this many cards in a column (0 or unset: no limit). */
  wipLimits: Partial<Record<BoardColumn, number>>
  /** Over a limit: refuse the move (else only warn). */
  wipBlock: boolean
  /** Done cards go to the archive after this many days (0: never). */
  autoArchiveDays: number
  /** Done shows its latest this many (0: all). */
  doneShown: number
  cardDensity: 'detailed' | 'compact'
  /** What a detailed card shows. */
  cardShow: { branch: boolean; diff: boolean; cost: boolean; pr: boolean; activity: boolean; age: boolean }
  /** A card that hasn't moved in this many days is marked (0: never). */
  boardStaleDays: number
  /** The order in a column: as dragged, or by something (pinned ones stay first). */
  columnSort: 'manual' | 'newest' | 'activity' | 'needs'
  /** A card dropped on In Progress: the Start dialog, or started straight away with the defaults. */
  dropToProgress: 'dialog' | 'start'
  confirmDone: boolean
  /** A task in Review with an open pull request goes to Done only once the PR is approved. */
  reviewNeedsApproval: boolean
  newTaskColumn: 'backlog' | 'ready'
  /** Lanes on a board you haven't picked them for. */
  defaultLanes: 'none' | 'agent' | 'repo'
  /** A task whose pull request is merged (on GitHub) goes to Done by itself. */
  finishOnPrMerge: boolean
  /** How Switchyard merges a pull request on GitHub (Done asks first; the repository may allow fewer). */
  prMergeMethod: 'squash' | 'merge' | 'rebase'
  confirmRemove: boolean
  syncMode: 'rebase' | 'merge'
  warnBehind: boolean
  /** Where Git URLs are cloned. Empty: next to the existing projects. */
  cloneDir: string
  /** Shell for terminal tabs. Empty: the system default. */
  shell: string
  termFontSize: number
  /** Empty: Geist Mono. */
  termFont: string
  termScrollback: number
  termCursor: 'block' | 'bar' | 'underline'
  termCursorBlink: boolean
  termCopyOnSelect: boolean
  /** Worktrees with no task and no commits for this long count as stale. */
  staleDays: number
  /** Remove stale worktrees on their own (never ones with uncommitted changes). */
  autoPrune: boolean
  /** Where notes are kept. Empty: "Switchyard Notes" in Documents. */
  notesDir: string
  /** Command of the external editor. Empty: the first one found. */
  editor: string
  /** File editor (workspace Files tab). Empty font: Geist Mono. */
  editorFont: string
  editorFontSize: number
  editorLineHeight: number
  editorLigatures: boolean
  editorTabSize: number
  editorUseTabs: boolean
  editorWordWrap: boolean
  /** The Changes diffs: one column, or old and new side by side. */
  diffLayout: 'unified' | 'split'
  /** Long lines in diffs wrap (else they scroll sideways). */
  diffWrap: boolean
  /** Whitespace-only changes left out of diffs. */
  diffIgnoreSpace: boolean
  /** What a task's Changes shows when it opens: its pending work (not pushed / not committed), or the whole branch vs its base. */
  changesScope: 'unpushed' | 'uncommitted' | 'branch'
  editorLineNumbers: boolean
  editorActiveLine: boolean
  /** A theme's id, or "system": light or dark as the OS is. */
  theme: string
  /** Prices per million tokens by model id (or its start), over the built-in ones - for the Usage costs. */
  modelPrices: Record<string, import('./usage').ModelPrice>
  /** What the notification center keeps (the bell). */
  noticeKinds: NoticeKind[]
  /** Notifications to a phone or chat: where (empty: off), through which service, which kinds, and only while you're away. */
  pushUrl: string
  pushService: 'ntfy' | 'slack' | 'discord' | 'webhook'
  pushKinds: NoticeKind[]
  pushWhenAway: boolean
  /** Projects whose events raise no notifications - neither the bell nor the system's. */
  mutedProjects: string[]
  /** A notice once a day's agent cost (at API prices) reaches this many dollars; 0: never. */
  spendAlert: number
  /** The same for a week (from Monday) and a month. */
  /** Give Claude Code and Codex Switchyard's tools (MCP): preview screenshots, tests, conflicts, review, tasks. */
  agentTools: boolean
  /** When the conflict radar finds two running tasks whose changes clash, introduce their agents on the Team channel. */
  teamIntroduce: boolean
  /** The daily summary: say it's ready each day at `summaryAt` ("HH:MM"). */
  dailySummary: boolean
  summaryAt: string
  spendAlertWeek: number
  spendAlertMonth: number
  /** Monthly budgets by project id, in dollars: a notice once a project's agent cost reaches its budget. */
  projectBudgets: Record<string, number>
  editorWhitespace: boolean
  editorBracketMatching: boolean
  editorTrimOnSave: boolean
  editorFinalNewline: boolean
  editorAutoSave: 'off' | 'delay' | 'blur'
  /** Follow .editorconfig files (indentation, line endings, final newline, trimming) in the file editor. */
  editorConfig: boolean
  /** Fetch every project's origin this often (minutes) to say when its base branch is behind; 0: never. */
  fetchMinutes: number
  /** After a fetch, fast-forward a base branch that's behind (only when that's all it needs and its checkout is clean). */
  autoPullBase: boolean
  /** Download updates of the installed app in the background (installed on quit). */
  autoUpdate: boolean
  /** The plugins turned on (by id; Settings → Plugins). */
  plugins: string[]
  /** Plugins being written, loaded from these folders (Settings → Plugins → Load from folder). */
  pluginFolders: string[]
  /** The terminal draws with the GPU (WebGL) - faster with lots of output. */
  termGpu: boolean
}

/** A button on a system notification: `id` comes back to the page when it's clicked. */
export interface NotifyAction {
  id: string
  label: string
}

/** A kind of terminal tab (VS Code's terminal profiles): a shell, with arguments. */
export interface ShellOption {
  /** Stable id ("pwsh", "wsl:Ubuntu"). */
  id?: string
  label: string
  path: string
  args?: string[]
}

/** A project's base branch against origin (Keeping main current). */
export interface BaseStatus {
  projectId: string
  base: string
  hasRemote: boolean
  /** Commits origin has that the local base doesn't, and the other way round. */
  behind: number
  ahead: number
  /** When origin was last fetched (ms), 0 if never. */
  fetchedAt: number
  /** The checkout that has the base branch out, if any. */
  checkedOutAt: string | null
  /** The last fetch's error. */
  error: string | null
}

/** A CI check of a pull request. */
export interface PrCheck {
  name: string
  /** pass / fail / pending / skipped */
  state: 'pass' | 'fail' | 'pending' | 'skipped'
  url: string | null
}

/** A review comment on a pull request (on a line, or the review's own text). */
export interface PrComment {
  id: string
  author: string
  body: string
  path: string | null
  line: number | null
  at: number
  url: string | null
}

/** A pull request as GitHub has it now: state, checks, reviews. */
export interface PrDetails extends PullRequest {
  checks: PrCheck[]
  /** APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED, or null. */
  reviewDecision: string | null
  comments: PrComment[]
  /** When this was read. */
  at: number
}

/** A file as the editor opens it. */
export interface FileDoc {
  /** text: editable; binary or large: shown, not edited. */
  kind: 'text' | 'binary' | 'large'
  text: string
  /** Its line endings and byte-order mark, kept when it's saved. */
  eol: '\n' | '\r\n'
  bom: boolean
  size: number
  /** Modified time (ms): a save checks the file wasn't changed meanwhile. */
  mtime: number
}

/** What .editorconfig files say for one file (only what's set). */
export interface EditorConfigProps {
  indent_style?: 'tab' | 'space'
  indent_size?: number
  tab_width?: number
  end_of_line?: 'lf' | 'crlf' | 'cr'
  charset?: string
  trim_trailing_whitespace?: boolean
  insert_final_newline?: boolean
  max_line_length?: number
}

export interface EditorOption {
  label: string
  bin: string
}

/** One top-level menu, as the title bar and the macOS menu bar show it. */
export interface MenuModel {
  label: string
  items: MenuEntry[]
}

export type MenuEntry =
  | { type: 'separator' }
  | {
      type?: 'item'
      id: string
      label: string
      /** Shortcut in macOS glyphs ("⇧⌘N"); shown per platform. */
      key?: string
      enabled?: boolean
      /** Built-in editing/window action carried out by the main process. */
      role?: MenuRole
    }

export type MenuRole =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'togglefullscreen'
  | 'reload'
  | 'toggleDevTools'
  | 'about'
  | 'quit'

export interface FileDiff {
  path: string
  status: 'added' | 'modified' | 'deleted'
  added: number
  deleted: number
  lines: DiffLine[]
  /** Has changes not committed yet (these can be committed or discarded). */
  uncommitted: boolean
  /** `lines` holds only the start of a very long diff (`added`/`deleted` still count all of it). */
  truncated?: boolean
  /** Moved here from this path. */
  oldPath?: string
  /** Git can't show it as text (an image, an archive…). */
  binary?: boolean
}

/**
 * What the Changes tab compares the worktree with: everything since the branch left its base
 * (like the pull request), what isn't on origin's copy of the branch yet, or just what isn't committed.
 * A commit's id: only what that commit changed.
 */
export type DiffScope = 'branch' | 'unpushed' | 'uncommitted' | { commit: string }

/** An open pull request of a project's repository (the PR dashboard). */
export interface OpenPr {
  number: number
  title: string
  url: string
  branch: string
  base: string
  author: string
  draft: boolean
  review: 'approved' | 'changes' | 'required' | null
  checks: { total: number; failed: number; pending: number; state: 'pass' | 'fail' | 'pending' | 'none' }
  /** GitHub says it doesn't merge cleanly. */
  conflicts: boolean
  updatedAt: number
  additions: number
  deletions: number
}

/** What a new worktree got of the main checkout's installed dependencies. */
export interface DepShare {
  folder: string
  how: 'copied' | 'skipped'
  /** Why it was skipped. */
  why?: string
}

/** Changes put aside with git stash. */
export interface StashEntry {
  /** "stash@{0}": which one, for applying or dropping it (it shifts as stashes come and go). */
  ref: string
  /** The branch it was made on. */
  branch: string
  message: string
  at: number
  files: string[]
}

/** A commit in a file's history. */
export interface FileCommit {
  hash: string
  author: string
  /** When it was written (ms). */
  at: number
  subject: string
}

/** Who last changed each line of a file. */
export interface Blame {
  commits: Record<string, { author: string; at: number; subject: string }>
  /** Per line (the first is line 1): its commit's id - all zeros when not committed yet. */
  lines: string[]
}

/** A merge, rebase or cherry-pick git stopped on conflicts, half-way. */
export interface SyncState {
  op: 'merge' | 'rebase' | 'cherry-pick'
  /** What's being merged in / rebased onto ("develop"), when known. */
  onto: string
  /** A rebase's commit it's at, of how many. */
  step: [number, number] | null
  /** The commit a rebase stopped at ("abc1234 Its message"). */
  commit: string
  /**
   * The files to resolve. "ours" is git's HEAD side: in a rebase that's the base (and the commits
   * replayed so far), in a merge this branch.
   */
  files: { path: string; kind: 'both' | 'deleted-ours' | 'deleted-theirs' | 'both-deleted' }[]
}

/** How a diff is read: whitespace-only changes left out or not. */
export interface DiffOptions {
  ignoreSpace?: boolean
}

/** What the launch flow's "Create branch" step did. */
/** A branch to start a task on (Start → Branch): local, or only on origin. */
export interface BranchInfo {
  name: string
  /** There's a local branch (else only origin/<name>: starting on it checks that out). */
  local: boolean
  remote: boolean
  /** Its last commit: when (ms) and its subject. */
  at: number
  subject: string
  /** Where it's checked out (a worktree, or the main checkout), if anywhere. */
  worktree: string | null
  mainCheckout: boolean
}

export interface BranchResult {
  /** The branch was already there and is reused. */
  existed: boolean
  /** Made from origin's branch of that name (it was only there). */
  fromOrigin?: boolean
  /** What it was created from. */
  base: string
  sha: string
  /** Commits origin has on the base branch that the local one doesn't. */
  behindRemote: number
}

export interface RemoteInfo {
  url: string
  /** https://github.com/owner/repo when origin is on GitHub. */
  github: string | null
}

export interface PullRequest {
  url: string
  number: number | null
  /** From the GitHub CLI; null when it isn't available. */
  state: 'OPEN' | 'MERGED' | 'CLOSED' | null
  /** This call opened it (vs. found an existing one). */
  created: boolean
}

/** Application menu items the renderer carries out. */
export type MenuCommand =
  | 'new-task'
  | 'add-project'
  | 'preferences'
  | 'palette'
  | 'nav-dashboard'
  | 'nav-agents'
  | 'nav-worktrees'
  | 'next-blocked'
