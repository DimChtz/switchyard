import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '@shared/ipc'
import type { TextSearchOptions, TextSearchResult } from '@shared/textSearch'
import type { Theme } from '@shared/themes'
import type { UsageEntry } from '@shared/usage'
import type { PackagePreview, PluginCommandContext, PluginInfo, PluginUiEvent } from '@shared/plugins'
import type {
  ActivityEvent,
  BaseStatus,
  PrDetails,
  FileDoc,
  EditorConfigProps,
  ActivityLog,
  OutsideItem,
  MapActivity,
  MapTree,
  AgentKind,
  AgentStatusUpdate,
  BranchResult,
  Issue,
  Note,
  NoteDraft,
  NoteImportResult,
  Notice,
  ThemesState,
  TranscriptSummary,
  PullRequest,
  RemoteInfo,
  PtyInfo,
  DiffStat,
  FileDiff,
  FileEntry,
  CheckoutFiles,
  BrowseEntry,
  BrowsePlace,
  EditorOption,
  GitWorktreeInfo,
  MenuModel,
  MenuRole,
  Prefs,
  KeybindingsState,
  RepoScan,
  SettingsFileError,
  ShellOption,
  NotifyAction,
  Project,
  ProjectMeta,
  PtySpawnOptions,
  RepoInfo,
  ReviewComment,
  CommentsChange,
  Checkpoint,
  ConflictReport,
  AgentLimit,
  TeamMessage,
  AgentToolRequest,
  RewindResult,
  Task,
  WorktreeStatus
} from '@shared/types'

const api = {
  store: {
    getProjects: (): Promise<Project[]> => ipcRenderer.invoke(IPC.storeGetProjects),
    addProject: (project: Project): Promise<Project[]> => ipcRenderer.invoke(IPC.storeAddProject, project),
    updateProject: (id: string, patch: Partial<Project>): Promise<Project | null> =>
      ipcRenderer.invoke(IPC.storeUpdateProject, id, patch),
    removeProject: (id: string): Promise<Project[]> => ipcRenderer.invoke(IPC.storeRemoveProject, id),
    getTasks: (): Promise<Task[]> => ipcRenderer.invoke(IPC.storeGetTasks),
    addTask: (task: Task): Promise<Task[]> => ipcRenderer.invoke(IPC.storeAddTask, task),
    updateTask: (id: string, patch: Partial<Task>): Promise<Task | null> =>
      ipcRenderer.invoke(IPC.storeUpdateTask, id, patch),
    deleteTask: (id: string): Promise<Task[]> => ipcRenderer.invoke(IPC.storeDeleteTask, id),
    setTasks: (tasks: Task[]): Promise<Task[]> => ipcRenderer.invoke(IPC.storeSetTasks, tasks),
    /** Saves the tasks before this returns (the window is closing). */
    setTasksNow: (tasks: Task[]): void => void ipcRenderer.sendSync(IPC.storeSetTasksNow, tasks),
    /** The highest task number each project has used (keys are never given out twice). */
    keyHigh: (): Promise<Record<string, number>> => ipcRenderer.invoke(IPC.storeKeyHigh),
    getComments: (): Promise<ReviewComment[]> => ipcRenderer.invoke(IPC.storeGetComments),
    addComment: (comment: ReviewComment): Promise<ReviewComment[]> => ipcRenderer.invoke(IPC.storeAddComment, comment),
    deleteComment: (id: string): Promise<void> => ipcRenderer.invoke(IPC.storeDeleteComment, id),
    getNotices: (): Promise<Notice[]> => ipcRenderer.invoke(IPC.storeGetNotices),
    setNotices: (notices: Notice[]): Promise<void> => ipcRenderer.invoke(IPC.storeSetNotices, notices),
    updateComments: (patches: { id: string; patch: Partial<ReviewComment> }[]): Promise<ReviewComment[]> => ipcRenderer.invoke(IPC.storeUpdateComments, patches),
    clearTaskData: (taskIds: string[]): Promise<void> => ipcRenderer.invoke(IPC.storeClearTaskData, taskIds),
    getViewedFiles: (taskId: string): Promise<string[]> => ipcRenderer.invoke(IPC.storeGetViewedFiles, taskId),
    setFileViewed: (taskId: string, path: string, viewed: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.storeSetFileViewed, taskId, path, viewed),
    /** An agent answered review comments (they're in the comments' threads). */
    onCommentsChanged: (cb: (change: CommentsChange) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, change: CommentsChange): void => cb(change)
      ipcRenderer.on(IPC.commentsChanged, handler)
      return () => ipcRenderer.removeListener(IPC.commentsChanged, handler)
    }
  },
  /** Switchyard's log file (Help → Open Logs Folder). */
  log: {
    error: (scope: string, message: string, detail?: string): void => ipcRenderer.send(IPC.logWrite, 'error', scope, message, detail),
    openDir: (): Promise<void> => ipcRenderer.invoke(IPC.logOpenDir)
  },
  /** App updates (the installed app, with a release channel). */
  updates: {
    check: (): Promise<{ message: string }> => ipcRenderer.invoke(IPC.updatesCheck),
    install: (): Promise<void> => ipcRenderer.invoke(IPC.updatesInstall),
    /** An update was downloaded (its version); it installs on quit. */
    onReady: (cb: (version: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, v: string): void => cb(v)
      ipcRenderer.on(IPC.updatesReady, handler)
      return () => ipcRenderer.removeListener(IPC.updatesReady, handler)
    }
  },
  /** Plugins (<userData>/plugins; Settings → Plugins). */
  plugins: {
    list: (): Promise<PluginInfo[]> => ipcRenderer.invoke(IPC.pluginsList),
    setEnabled: (id: string, on: boolean): Promise<PluginInfo[]> => ipcRenderer.invoke(IPC.pluginsSetEnabled, id, on),
    reload: (): Promise<PluginInfo[]> => ipcRenderer.invoke(IPC.pluginsReload),
    /** A new plugin from the example; resolves with its folder. */
    scaffold: (): Promise<string> => ipcRenderer.invoke(IPC.pluginsScaffold),
    openFolder: (): Promise<string> => ipcRenderer.invoke(IPC.pluginsOpenFolder),
    open: (dir: string): Promise<string> => ipcRenderer.invoke(IPC.pluginsOpen, dir),
    /** Install from file: the package picked, looked at (null: cancelled). */
    pickPackage: (): Promise<PackagePreview | null> => ipcRenderer.invoke(IPC.pluginsPickPackage),
    previewFile: (path: string): Promise<PackagePreview> => ipcRenderer.invoke(IPC.pluginsPreviewFile, path),
    previewUrl: (url: string): Promise<PackagePreview> => ipcRenderer.invoke(IPC.pluginsPreviewUrl, url),
    install: (token: string, turnOn: boolean): Promise<PluginInfo[]> => ipcRenderer.invoke(IPC.pluginsInstall, token, turnOn),
    discard: (token: string): Promise<void> => ipcRenderer.invoke(IPC.pluginsDiscard, token),
    uninstall: (id: string): Promise<PluginInfo[]> => ipcRenderer.invoke(IPC.pluginsUninstall, id),
    /** Load from folder (development): null when cancelled. */
    linkFolder: (): Promise<PluginInfo[] | null> => ipcRenderer.invoke(IPC.pluginsLinkFolder),
    /** The packager: this plugin's folder (null: pick one); null when cancelled. */
    package: (dir: string | null): Promise<{ path: string; files: number; bytes: number } | null> => ipcRenderer.invoke(IPC.pluginsPackage, dir),
    /** Packages opened with the app (a double-click) before the window was ready. */
    takeOpened: (): Promise<PackagePreview[]> => ipcRenderer.invoke(IPC.pluginsTakeOpened),
    /** A package was opened with the app (or couldn't be). */
    onInstallRequest: (cb: (p: PackagePreview | { error: string }) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, p: PackagePreview | { error: string }): void => cb(p)
      ipcRenderer.on(IPC.pluginsInstallRequest, handler)
      return () => ipcRenderer.removeListener(IPC.pluginsInstallRequest, handler)
    },
    run: (command: string, ctx: PluginCommandContext): Promise<void> => ipcRenderer.invoke(IPC.pluginsRun, command, ctx),
    onChanged: (cb: (list: PluginInfo[]) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, list: PluginInfo[]): void => cb(list)
      ipcRenderer.on(IPC.pluginsChanged, handler)
      return () => ipcRenderer.removeListener(IPC.pluginsChanged, handler)
    },
    /** What a plugin asks the window to do (a toast, a badge, a message to an agent…). */
    onUi: (cb: (e: PluginUiEvent) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, e: PluginUiEvent): void => cb(e)
      ipcRenderer.on(IPC.pluginsUi, handler)
      return () => ipcRenderer.removeListener(IPC.pluginsUi, handler)
    }
  },
  dialog: {
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogPickFolder),
    /** Save as: the text to a file the user picks; resolves with its path, null when cancelled. */
    saveText: (name: string, text: string, filter: { name: string; extensions: string[] }): Promise<string | null> => ipcRenderer.invoke(IPC.dialogSaveText, name, text, filter),
    /** Asks for image files; resolves with their paths (none when cancelled). */
    pickImages: (): Promise<string[]> => ipcRenderer.invoke(IPC.dialogPickImages)
  },
  attachments: {
    /** Keeps a pasted image (a data: URL) as a file for an agent to open; resolves with its path. */
    save: (dataUrl: string): Promise<string> => ipcRenderer.invoke(IPC.attachmentsSave, dataUrl)
  },
  git: {
    checkRepo: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC.gitCheckRepo, path),
    repoInfo: (path: string): Promise<RepoInfo> => ipcRenderer.invoke(IPC.gitRepoInfo, path),
    suggestWorktreePath: (repoRoot: string, branch: string): Promise<string> =>
      ipcRenderer.invoke(IPC.gitSuggestWorktreePath, repoRoot, branch),
    /** The folder of a task in several repositories (one worktree per repository inside). */
    suggestTaskDir: (homeRepoRoot: string, key: string): Promise<string> => ipcRenderer.invoke(IPC.gitSuggestTaskDir, homeRepoRoot, key),
    moveWorktree: (repoPath: string, from: string, to: string): Promise<void> => ipcRenderer.invoke(IPC.gitMoveWorktree, repoPath, from, to),
    /** Removes a task's folder when it's empty. */
    removeTaskDir: (dir: string): Promise<void> => ipcRenderer.invoke(IPC.gitRemoveTaskDir, dir),
    detectProjectMeta: (repoRoot: string): Promise<ProjectMeta> => ipcRenderer.invoke(IPC.gitDetectProjectMeta, repoRoot),
    listWorktrees: (repoPath: string): Promise<GitWorktreeInfo[]> => ipcRenderer.invoke(IPC.gitListWorktrees, repoPath),
    addWorktree: (repoPath: string, worktreePath: string, branch: string, baseRef?: string): Promise<void> =>
      ipcRenderer.invoke(IPC.gitAddWorktree, repoPath, worktreePath, branch, baseRef),
    removeWorktree: (repoPath: string, worktreePath: string, force?: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.gitRemoveWorktree, repoPath, worktreePath, force),
    pruneWorktrees: (repoPath: string): Promise<void> => ipcRenderer.invoke(IPC.gitPruneWorktrees, repoPath),
    /** Whether a folder is (still) a git checkout - a task's worktree can be deleted outside Switchyard. */
    isCheckout: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC.gitIsCheckout, path),
    worktreeStatus: (worktreePath: string, baseBranch: string): Promise<WorktreeStatus> =>
      ipcRenderer.invoke(IPC.gitWorktreeStatus, worktreePath, baseBranch),
    log: (worktreePath: string, limit?: number): Promise<{ hash: string; message: string; date: string }[]> =>
      ipcRenderer.invoke(IPC.gitLog, worktreePath, limit),
    diffFiles: (worktreePath: string, baseBranch: string): Promise<FileDiff[]> =>
      ipcRenderer.invoke(IPC.gitDiffFiles, worktreePath, baseBranch),
    diffStat: (worktreePath: string, baseBranch: string): Promise<DiffStat> =>
      ipcRenderer.invoke(IPC.gitDiffStat, worktreePath, baseBranch),
    rebase: (worktreePath: string, baseBranch: string): Promise<void> => ipcRenderer.invoke(IPC.gitRebase, worktreePath, baseBranch),
    mergeAndPrune: (repoPath: string, worktreePath: string, branch: string, baseBranch: string, prune?: boolean, message?: string): Promise<void> =>
      ipcRenderer.invoke(IPC.gitMergeAndPrune, repoPath, worktreePath, branch, baseBranch, prune, message),
    issues: (repoPath: string): Promise<Issue[]> => ipcRenderer.invoke(IPC.gitIssues, repoPath),
    shortSha: (repoPath: string, ref: string): Promise<string | null> => ipcRenderer.invoke(IPC.gitShortSha, repoPath, ref),
    discardWorktree: (repoPath: string, worktreePath: string, branch: string): Promise<void> =>
      ipcRenderer.invoke(IPC.gitDiscardWorktree, repoPath, worktreePath, branch),
    copyIntoWorktree: (repoPath: string, worktreePath: string, paths: string[]): Promise<string[]> =>
      ipcRenderer.invoke(IPC.gitCopyIntoWorktree, repoPath, worktreePath, paths),
    copySuggestions: (repoPath: string): Promise<string[]> => ipcRenderer.invoke(IPC.gitCopySuggestions, repoPath),
    createBranch: (repoPath: string, branch: string, baseBranch: string): Promise<BranchResult> =>
      ipcRenderer.invoke(IPC.gitCreateBranch, repoPath, branch, baseBranch),
    commitAll: (worktreePath: string, message: string): Promise<string> => ipcRenderer.invoke(IPC.gitCommitAll, worktreePath, message),
    discardFile: (worktreePath: string, path: string): Promise<void> => ipcRenderer.invoke(IPC.gitDiscardFile, worktreePath, path),
    remoteInfo: (repoPath: string): Promise<RemoteInfo | null> => ipcRenderer.invoke(IPC.gitRemoteInfo, repoPath),
    push: (worktreePath: string, branch: string): Promise<void> => ipcRenderer.invoke(IPC.gitPush, worktreePath, branch),
    createPr: (worktreePath: string, repoPath: string, branch: string, baseBranch: string, title: string, body: string): Promise<PullRequest> =>
      ipcRenderer.invoke(IPC.gitCreatePr, worktreePath, repoPath, branch, baseBranch, title, body),
    prStatus: (worktreePath: string, ref: string): Promise<PullRequest | null> => ipcRenderer.invoke(IPC.gitPrStatus, worktreePath, ref),
    /** The pull request with its checks, review decision and comments (GitHub CLI). */
    prDetails: (worktreePath: string, ref: string): Promise<PrDetails | null> => ipcRenderer.invoke(IPC.gitPrDetails, worktreePath, ref),
    unpushed: (worktreePath: string, branch: string, baseBranch: string): Promise<number> =>
      ipcRenderer.invoke(IPC.gitUnpushed, worktreePath, branch, baseBranch),
    closeWithPr: (repoPath: string, worktreePath: string, branch: string, baseBranch: string, merged: boolean, prRef?: string): Promise<void> =>
      ipcRenderer.invoke(IPC.gitCloseWithPr, repoPath, worktreePath, branch, baseBranch, merged, prRef),
    /** Why the task can't close through its pull request without losing work, or null when it can. */
    closeCheck: (worktreePath: string, branch: string, baseBranch: string, prRef?: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.gitCloseCheck, worktreePath, branch, baseBranch, prRef),
    pruneStaleNow: (): Promise<string[]> => ipcRenderer.invoke(IPC.worktreesPruneNow),
    onPruned: (cb: (pruned: string[]) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, pruned: string[]): void => cb(pruned)
      ipcRenderer.on(IPC.worktreesPruned, handler)
      return () => ipcRenderer.removeListener(IPC.worktreesPruned, handler)
    }
  },
  /** Each project's base branch against origin, fetched in the background. */
  base: {
    list: (): Promise<BaseStatus[]> => ipcRenderer.invoke(IPC.baseList),
    fetch: (projectId?: string): Promise<BaseStatus[]> => ipcRenderer.invoke(IPC.baseFetch, projectId),
    /** Fast-forwards the project's base branch to origin's. */
    pull: (projectId: string): Promise<BaseStatus | null> => ipcRenderer.invoke(IPC.basePull, projectId),
    onChanged: (cb: (s: BaseStatus[]) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, s: BaseStatus[]): void => cb(s)
      ipcRenderer.on(IPC.baseChanged, handler)
      return () => ipcRenderer.removeListener(IPC.baseChanged, handler)
    }
  },
  menu: {
    set: (model: MenuModel[]): void => ipcRenderer.send(IPC.menuSet, model),
    role: (role: MenuRole): void => ipcRenderer.send(IPC.menuRole, role),
    onCommand: (cb: (id: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string): void => cb(id)
      ipcRenderer.on(IPC.menuCommand, handler)
      return () => ipcRenderer.removeListener(IPC.menuCommand, handler)
    }
  },
  prefs: {
    get: (): Promise<Prefs> => ipcRenderer.invoke(IPC.prefsGet),
    set: (patch: Partial<Prefs>): Promise<Prefs> => ipcRenderer.invoke(IPC.prefsSet, patch),
    /** settings.json was edited outside the app. */
    onChanged: (cb: (prefs: Prefs) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, prefs: Prefs): void => cb(prefs)
      ipcRenderer.on(IPC.prefsChanged, handler)
      return () => ipcRenderer.removeListener(IPC.prefsChanged, handler)
    }
  },
  settings: {
    /** Opens this machine's settings.json in the external editor (creating it if needed). */
    openUserFile: (): Promise<string> => ipcRenderer.invoke(IPC.settingsOpenUser),
    /** settings.json's current error, if it has one. */
    userError: (): Promise<SettingsFileError | null> => ipcRenderer.invoke(IPC.settingsUserError),
    onError: (cb: (err: SettingsFileError) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, err: SettingsFileError): void => cb(err)
      ipcRenderer.on(IPC.settingsError, handler)
      return () => ipcRenderer.removeListener(IPC.settingsError, handler)
    }
  },
  keybindings: {
    get: (): Promise<KeybindingsState> => ipcRenderer.invoke(IPC.keybindingsGet),
    /** Gives a command a key (null: none), replacing its entries in keybindings.json. */
    set: (command: string, key: string | null): Promise<KeybindingsState> => ipcRenderer.invoke(IPC.keybindingsSet, command, key),
    /** Opens keybindings.json in the external editor (creating it if needed). */
    openFile: (): Promise<string> => ipcRenderer.invoke(IPC.keybindingsOpen),
    /** keybindings.json was edited outside the app. */
    onChanged: (cb: (state: KeybindingsState) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, state: KeybindingsState): void => cb(state)
      ipcRenderer.on(IPC.keybindingsChanged, handler)
      return () => ipcRenderer.removeListener(IPC.keybindingsChanged, handler)
    }
  },
  projects: {
    /** Saves project settings where they're kept: Switchyard ("machine"), or the repo's shared/local file. */
    setSettings: (id: string, scope: 'machine' | 'shared' | 'local', patch: Partial<Project>): Promise<Project | null> =>
      ipcRenderer.invoke(IPC.projectsSetSettings, id, scope, patch),
    /** Opens .switchyard/settings(.local).json in the external editor (creating it if needed). */
    openSettingsFile: (id: string, scope: 'shared' | 'local'): Promise<string> => ipcRenderer.invoke(IPC.projectsOpenSettings, id, scope),
    /** Trusts what the repository's shared settings file asks for (commands, environment, permissions) - this version of it. */
    trust: (id: string, hash: string): Promise<void> => ipcRenderer.invoke(IPC.projectsTrust, id, hash),
    /** A project's settings file changed on disk. */
    onChanged: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on(IPC.projectsChanged, handler)
      return () => ipcRenderer.removeListener(IPC.projectsChanged, handler)
    }
  },
  repos: {
    scan: (path: string): Promise<RepoScan> => ipcRenderer.invoke(IPC.reposScan, path),
    browse: (dir: string): Promise<BrowseEntry[]> => ipcRenderer.invoke(IPC.reposBrowse, dir),
    places: (): Promise<BrowsePlace[]> => ipcRenderer.invoke(IPC.reposPlaces),
    recent: (): Promise<string[]> => ipcRenderer.invoke(IPC.reposRecent),
    clone: (url: string): Promise<string> => ipcRenderer.invoke(IPC.reposClone, url),
    init: (path: string, branch: string): Promise<void> => ipcRenderer.invoke(IPC.reposInit, path, branch),
    isUrl: (s: string): Promise<boolean> => ipcRenderer.invoke(IPC.reposIsUrl, s),
    cloneDir: (): Promise<string> => ipcRenderer.invoke(IPC.reposCloneDir),
    userName: (): Promise<string | null> => ipcRenderer.invoke(IPC.reposUserName)
  },
  sys: {
    homeDir: ipcRenderer.sendSync(IPC.sysHomeDir) as string,
    shells: (): Promise<ShellOption[]> => ipcRenderer.invoke(IPC.sysShells),
    editors: (): Promise<EditorOption[]> => ipcRenderer.invoke(IPC.sysEditors),
    openInEditor: (path: string): Promise<string> => ipcRenderer.invoke(IPC.sysOpenInEditor, path),
    /** Opens a folder in the file manager, or a file with its default app. */
    reveal: (path: string): Promise<void> => ipcRenderer.invoke(IPC.sysReveal, path),
    /** The file manager at the item's folder, the item selected. */
    showItem: (path: string): Promise<void> => ipcRenderer.invoke(IPC.sysShowItem, path),
    openTerminal: (path: string): Promise<void> => ipcRenderer.invoke(IPC.sysOpenTerminal, path),
    copy: (text: string): void => ipcRenderer.send(IPC.sysCopy, text),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.sysOpenExternal, url),
    notify: (title: string, body: string, taskId: string | null, actions?: NotifyAction[]): void => ipcRenderer.send(IPC.sysNotify, title, body, taskId, actions),
    /** A notification's button was clicked (see notify's `actions`). */
    onNotifyAction: (cb: (taskId: string, actionId: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, taskId: string, actionId: string): void => cb(taskId, actionId)
      ipcRenderer.on(IPC.appNotifyAction, handler)
      return () => ipcRenderer.removeListener(IPC.appNotifyAction, handler)
    },
    onOpenTask: (cb: (taskId: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, taskId: string): void => cb(taskId)
      ipcRenderer.on(IPC.appOpenTask, handler)
      return () => ipcRenderer.removeListener(IPC.appOpenTask, handler)
    }
  },
  net: {
    freePort: (): Promise<number> => ipcRenderer.invoke(IPC.netFreePort),
    portOpen: (port: number): Promise<boolean> => ipcRenderer.invoke(IPC.netPortOpen, port)
  },
  team: {
    /** The Team channel's messages, oldest first. */
    list: (): Promise<TeamMessage[]> => ipcRenderer.invoke(IPC.teamList),
    /** A message from you to a task's agent (by task id or key). */
    send: (to: string, text: string): Promise<TeamMessage> => ipcRenderer.invoke(IPC.teamSend, to, text),
    /** Lets a message the loop guard held go through. */
    release: (id: string): Promise<void> => ipcRenderer.invoke(IPC.teamRelease, id),
    onChanged: (cb: (messages: TeamMessage[]) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, m: TeamMessage[]): void => cb(m)
      ipcRenderer.on(IPC.teamChanged, handler)
      return () => ipcRenderer.removeListener(IPC.teamChanged, handler)
    }
  },
  /** The repository map: a project's files, and where each task's agent works in them. */
  map: {
    tree: (projectId: string): Promise<MapTree> => ipcRenderer.invoke(IPC.mapTree, projectId),
    activity: (projectId: string): Promise<MapActivity[]> => ipcRenderer.invoke(IPC.mapActivity, projectId)
  },
  /** Work in a project no task holds: worktrees, branches, agent conversations (or all projects'). */
  outside: (projectId?: string): Promise<OutsideItem[]> => ipcRenderer.invoke(IPC.outsideScan, projectId),
  /** The activity log behind the daily summary. */
  activity: {
    list: (): Promise<ActivityLog> => ipcRenderer.invoke(IPC.activityList),
    add: (event: ActivityEvent): Promise<void> => ipcRenderer.invoke(IPC.activityAdd, event),
    /** The summary was looked at. */
    seen: (at: number): Promise<void> => ipcRenderer.invoke(IPC.activitySeen, at),
    /** The day's summary was announced (YYYY-MM-DD). */
    announced: (day: string): Promise<void> => ipcRenderer.invoke(IPC.activityAnnounced, day),
    onChanged: (cb: (log: ActivityLog) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, log: ActivityLog): void => cb(log)
      ipcRenderer.on(IPC.activityChanged, handler)
      return () => ipcRenderer.removeListener(IPC.activityChanged, handler)
    }
  },
  /** An acceptance criterion's screenshot, as a data: URL. */
  evidenceImage: (path: string): Promise<string | null> => ipcRenderer.invoke(IPC.evidenceImage, path),
  conflicts: {
    /** The last check of which running tasks collide. */
    get: (): Promise<ConflictReport> => ipcRenderer.invoke(IPC.conflictsGet),
    scan: (): Promise<ConflictReport> => ipcRenderer.invoke(IPC.conflictsScan),
    /** The file as merging the two would leave it (conflict markers where they clash). */
    preview: (repoId: string, a: string, b: string | null, file: string): Promise<string> => ipcRenderer.invoke(IPC.conflictsPreview, repoId, a, b, file),
    onChanged: (cb: (r: ConflictReport) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, r: ConflictReport): void => cb(r)
      ipcRenderer.on(IPC.conflictsChanged, handler)
      return () => ipcRenderer.removeListener(IPC.conflictsChanged, handler)
    }
  },
  preview: {
    /** Keeps a screenshot (PNG data URL) in the task's folder for its agent: .switchyard/shots, kept out of git. */
    saveShot: (root: string, dataUrl: string): Promise<{ path: string; rel: string }> => ipcRenderer.invoke(IPC.previewSaveShot, root, dataUrl)
  },
  checkpoints: {
    /** The task's checkpoints, oldest first: session starts, turns, rewinds. */
    list: (taskId: string): Promise<Checkpoint[]> => ipcRenderer.invoke(IPC.checkpointsList, taskId),
    /** What a checkpoint changed (from the one before it, or `fromId`). */
    diff: (taskId: string, id: string, fromId?: string): Promise<FileDiff[]> => ipcRenderer.invoke(IPC.checkpointsDiff, taskId, id, fromId),
    /** Puts the task's files back as they were at the checkpoint (saving them first). */
    rewind: (taskId: string, id: string): Promise<RewindResult> => ipcRenderer.invoke(IPC.checkpointsRewind, taskId, id),
    onChanged: (cb: (taskId: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, taskId: string): void => cb(taskId)
      ipcRenderer.on(IPC.checkpointsChanged, handler)
      return () => ipcRenderer.removeListener(IPC.checkpointsChanged, handler)
    }
  },
  usage: {
    /** Agents' token use per session, by day and model (Claude Code sessions). */
    list: (): Promise<UsageEntry[]> => ipcRenderer.invoke(IPC.usageList),
    onChanged: (cb: (entries: UsageEntry[]) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, entries: UsageEntry[]): void => cb(entries)
      ipcRenderer.on(IPC.usageChanged, handler)
      return () => ipcRenderer.removeListener(IPC.usageChanged, handler)
    }
  },
  themes: {
    get: (): Promise<ThemesState> => ipcRenderer.invoke(IPC.themesGet),
    /** The window's own parts (background, title bar buttons, native menus) follow the theme. */
    chrome: (c: { type: 'dark' | 'light'; system: boolean; background: string; chrome: string; symbols: string }): void => ipcRenderer.send(IPC.themesChrome, c),
    /** A copy of the theme as a new file in the themes folder; resolves with its path. */
    duplicate: (theme: Theme, name: string): Promise<string> => ipcRenderer.invoke(IPC.themesDuplicate, theme, name),
    /** Asks for theme files and copies them into the themes folder. */
    install: (): Promise<{ count: number; problems: string[] } | null> => ipcRenderer.invoke(IPC.themesImport),
    openDir: (): Promise<void> => ipcRenderer.invoke(IPC.themesOpenDir),
    onChanged: (cb: (state: ThemesState) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, s: ThemesState): void => cb(s)
      ipcRenderer.on(IPC.themesChanged, handler)
      return () => ipcRenderer.removeListener(IPC.themesChanged, handler)
    }
  },
  notes: {
    list: (): Promise<Note[]> => ipcRenderer.invoke(IPC.notesList),
    save: (draft: NoteDraft): Promise<Note> => ipcRenderer.invoke(IPC.notesSave, draft),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.notesDelete, id),
    dir: (): Promise<string> => ipcRenderer.invoke(IPC.notesDir),
    /** An image a note shows (a path, or relative to the notes folder) as a data: URL; null if it can't be read. */
    image: (ref: string): Promise<string | null> => ipcRenderer.invoke(IPC.notesImage, ref),
    /** Asks for Markdown files or a folder (an Obsidian vault, a Notion export) and imports them; null when cancelled. */
    importPick: (kind: 'files' | 'folder', link?: { projectId: string | null; taskId: string | null }): Promise<NoteImportResult | null> =>
      ipcRenderer.invoke(IPC.notesImportPick, kind, link),
    /** Imports dropped files and folders. */
    importPaths: (paths: string[], link?: { projectId: string | null; taskId: string | null }): Promise<NoteImportResult> => ipcRenderer.invoke(IPC.notesImportPaths, paths, link),
    /** Save as: one note's Markdown to a file the user picks; resolves with its path, null when cancelled. */
    exportOne: (body: string): Promise<string | null> => ipcRenderer.invoke(IPC.notesExportOne, body),
    /** Notes into a folder the user picks, one "Title.md" each. */
    exportMany: (ids: string[]): Promise<{ dir: string; count: number } | null> => ipcRenderer.invoke(IPC.notesExportMany, ids),
    onChanged: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on(IPC.notesChanged, handler)
      return () => ipcRenderer.removeListener(IPC.notesChanged, handler)
    }
  },
  fs: {
    /** A checkout's files with their git status; a task folder's, per repository (`bases`: each one's base branch). */
    list: (root: string, baseBranch?: string, bases?: Record<string, string>): Promise<FileEntry[]> => ipcRenderer.invoke(IPC.fsList, root, baseBranch, bases),
    read: (path: string): Promise<string> => ipcRenderer.invoke(IPC.fsRead, path),
    write: (path: string, content: string): Promise<void> => ipcRenderer.invoke(IPC.fsWrite, path, content),
    /** A file as the editor opens it (text with "\n", its real line ends, BOM, modified time; binary/large without text). */
    readDoc: (path: string): Promise<FileDoc> => ipcRenderer.invoke(IPC.fsReadDoc, path),
    /** Saves editor text the file's way; "CHANGED_ON_DISK" when it changed since `expectMtime`. Resolves with the new modified time. */
    writeDoc: (path: string, text: string, o: { eol: '\n' | '\r\n'; bom: boolean; expectMtime?: number | null }): Promise<number> => ipcRenderer.invoke(IPC.fsWriteDoc, path, text, o),
    /** What .editorconfig files say for this file. */
    editorConfig: (path: string): Promise<EditorConfigProps> => ipcRenderer.invoke(IPC.fsEditorConfig, path),
    /** Live changes under a folder (batched); returns a function that stops them. */
    watch: (root: string, cb: (change: { paths: string[]; git: boolean }) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, c: { root: string; paths: string[]; git: boolean }): void => {
        if (c.root === root) cb(c)
      }
      ipcRenderer.on(IPC.fsChanged, handler)
      const id = ipcRenderer.invoke(IPC.fsWatch, root) as Promise<number>
      return () => {
        ipcRenderer.removeListener(IPC.fsChanged, handler)
        id.then((n) => n && ipcRenderer.invoke(IPC.fsUnwatch, n))
      }
    },
    create: (path: string, isDir: boolean): Promise<void> => ipcRenderer.invoke(IPC.fsCreate, path, isDir),
    /** Moves the file or folder to the system trash. */
    delete: (path: string): Promise<void> => ipcRenderer.invoke(IPC.fsDelete, path),
    rename: (oldPath: string, newPath: string): Promise<void> => ipcRenderer.invoke(IPC.fsRename, oldPath, newPath),
    /** Copies into a folder ("name copy.ext" when taken); resolves with the new path. */
    copy: (src: string, destDir: string): Promise<string> => ipcRenderer.invoke(IPC.fsCopy, src, destDir),
    /** Moves into a folder; resolves with the new path. */
    move: (src: string, destDir: string): Promise<string> => ipcRenderer.invoke(IPC.fsMove, src, destDir),
    /** Search in files: the matching lines of a checkout. */
    searchText: (root: string, o: TextSearchOptions): Promise<TextSearchResult> => ipcRenderer.invoke(IPC.fsSearchText, root, o),
    /** Replaces the matches in these files (worktree-relative) and saves them. */
    replaceText: (root: string, o: TextSearchOptions, replacement: string, paths: string[]): Promise<{ files: number; count: number }> =>
      ipcRenderer.invoke(IPC.fsReplaceText, root, o, replacement, paths),
    /** Every file of a checkout, for Go to file. */
    listAll: (root: string): Promise<CheckoutFiles> => ipcRenderer.invoke(IPC.fsListAll, root),
    /** Where a file dropped from the system's file manager lives ("" if it isn't a file on disk). */
    pathForFile: (file: File): string => webUtils.getPathForFile(file)
  },
  pty: {
    spawn: (opts: PtySpawnOptions): Promise<void> => ipcRenderer.invoke(IPC.ptySpawn, opts),
    exists: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.ptyExists, id),
    info: (id: string): Promise<PtyInfo | null> => ipcRenderer.invoke(IPC.ptyInfo, id),
    sendText: (id: string, text: string): void => ipcRenderer.send(IPC.ptySendText, id, text),
    getBuffer: (id: string): Promise<string> => ipcRenderer.invoke(IPC.ptyGetBuffer, id),
    write: (id: string, data: string): void => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id: string, cols: number, rows: number): void => ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    kill: (id: string): Promise<void> => ipcRenderer.invoke(IPC.ptyKill, id),
    list: (prefix: string): Promise<string[]> => ipcRenderer.invoke(IPC.ptyList, prefix),
    killPrefix: (prefix: string): Promise<void> => ipcRenderer.invoke(IPC.ptyKillPrefix, prefix),
    onData: (cb: (id: string, data: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: { id: string; data: string }): void =>
        cb(payload.id, payload.data)
      ipcRenderer.on(IPC.ptyData, handler)
      return () => ipcRenderer.removeListener(IPC.ptyData, handler)
    },
    onExit: (cb: (id: string, exitCode: number) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: { id: string; exitCode: number }): void =>
        cb(payload.id, payload.exitCode)
      ipcRenderer.on(IPC.ptyExit, handler)
      return () => ipcRenderer.removeListener(IPC.ptyExit, handler)
    }
  },
  agents: {
    detectInstalled: (): Promise<Record<AgentKind, boolean>> => ipcRenderer.invoke(IPC.agentsDetectInstalled),
    resolveBin: (kind: AgentKind): Promise<string | null> => ipcRenderer.invoke(IPC.agentsResolveBin, kind),
    version: (kind: AgentKind): Promise<string | null> => ipcRenderer.invoke(IPC.agentsVersion, kind),
    currentStatus: (): Promise<AgentStatusUpdate[]> => ipcRenderer.invoke(IPC.agentsCurrentStatus),
    hookSettings: (taskId: string, tools?: boolean): Promise<string> => ipcRenderer.invoke(IPC.agentsHookSettings, taskId, tools),
    /** What gives the agent Switchyard's tools (MCP) at launch: arguments, and environment variables. */
    toolLaunch: (taskId: string, kind: AgentKind): Promise<{ args: string[]; env: Record<string, string> }> => ipcRenderer.invoke(IPC.agentsToolArgs, taskId, kind),
    /** Types a message into the task's agent once it waits for input (agents that can't take one at launch). */
    typeWhenReady: (taskId: string, text: string): Promise<void> => ipcRenderer.invoke(IPC.agentsTypeWhenReady, taskId, text),
    /** An agent's terminal said it hit a usage limit (and when it resets, if it did). */
    onLimit: (cb: (limit: AgentLimit) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, limit: AgentLimit): void => cb(limit)
      ipcRenderer.on(IPC.agentLimit, handler)
      return () => ipcRenderer.removeListener(IPC.agentLimit, handler)
    },
    /** Something an agent asked Switchyard for (id 0: nothing to answer); answer with toolReply. */
    onToolRequest: (cb: (id: number, req: AgentToolRequest) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: number, req: AgentToolRequest): void => cb(id, req)
      ipcRenderer.on(IPC.agentToolsRequest, handler)
      return () => ipcRenderer.removeListener(IPC.agentToolsRequest, handler)
    },
    toolReply: (id: number, result: unknown, error?: string): Promise<void> => ipcRenderer.invoke(IPC.agentToolsReply, id, result, error),
    transcript: (path: string): Promise<TranscriptSummary> => ipcRenderer.invoke(IPC.agentsTranscript, path),
    onStatus: (cb: (update: AgentStatusUpdate) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: AgentStatusUpdate): void => cb(update)
      ipcRenderer.on(IPC.agentStatus, handler)
      return () => ipcRenderer.removeListener(IPC.agentStatus, handler)
    }
  }
}

export type SwitchyardApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // Without context isolation the page shares this window (the types are in window.d.ts).
  Object.assign(window, { electron: electronAPI, api })
}
