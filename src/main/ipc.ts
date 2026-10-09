import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { IPC } from '@shared/ipc'
import * as store from './services/store'
import * as git from './services/git'
import * as ptyService from './services/pty'
import * as agentsService from './services/agents'
import * as agentStatus from './services/agentStatus'
import * as ports from './services/ports'
import * as fsService from './services/fs'
import * as menu from './menu'
import * as cleanup from './services/cleanup'
import * as repos from './services/repos'
import * as system from './services/system'
import * as hooks from './services/hooks'
import * as transcript from './services/transcript'
import * as notes from './services/notes'
import * as notesTransfer from './services/notesTransfer'
import * as themes from './services/themes'
import * as usage from './services/usage'
import * as checkpoints from './services/checkpoints'
import { saveShot } from './services/shots'
import * as conflicts from './services/conflicts'
import { handleMcp, registerWindowReplies, evidenceImage } from './services/agentTools'
import * as team from './services/team'
import * as activity from './services/activity'
import * as outside from './services/outside'
import * as repoMap from './services/repoMap'
import * as inbox from './services/inbox'
import * as limits from './services/limits'
import { userSaved } from './services/coedit'
import * as settings from './services/settings'
import { homedir } from 'os'
import { log, logsDir } from './services/log'
import * as updates from './services/updates'
import * as baseSync from './services/baseSync'
import * as plugins from './services/plugins'
import type { PluginCommandContext } from '@shared/plugins'
import { unwatchFolder, watchFolder } from './services/watch'
import { detectProjectMeta } from './services/projectMeta'
import type { TextSearchOptions } from '@shared/textSearch'
import type { ActivityEvent, AgentKind, DiffLine, DiffOptions, DiffScope, MenuModel, MenuRole, NoteDraft, NotifyAction, Notice, Prefs, Project, PtySpawnOptions, ReviewComment, Task } from '@shared/types'

import type { Theme } from '@shared/themes'

type NoteLink = { projectId: string | null; taskId: string | null }

/** A diff scope from the window: one of the names, or a commit's id. */
function diffScope(s: unknown): DiffScope {
  if (s === 'unpushed' || s === 'uncommitted') return s
  const commit = (s as { commit?: unknown } | null)?.commit
  if (typeof commit === 'string' && /^[0-9a-f]{4,64}$/i.test(commit)) return { commit }
  return 'branch'
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.storeGetProjects, () => store.getProjects())
  ipcMain.handle(IPC.storeAddProject, (_e, project: Project) => {
    store.addProject(project)
    const all = store.getProjects()
    settings.watchProjectSettings(all)
    return all
  })
  ipcMain.handle(IPC.storeUpdateProject, (_e, id: string, patch: Partial<Project>) => store.updateProject(id, patch))
  ipcMain.handle(IPC.storeRemoveProject, (_e, id: string) => {
    store.removeProject(id)
    const all = store.getProjects()
    settings.watchProjectSettings(all)
    return all
  })

  // Settings files (settings.json here, .switchyard/settings.json in a repo).
  ipcMain.handle(IPC.projectsSetSettings, (_e, id: string, scope: 'machine' | 'shared' | 'local', patch: Partial<Project>) => {
    const p = store.getProject(id)
    if (!p) throw new Error('No such project')
    if (scope === 'machine') return store.updateProject(id, patch)
    settings.setProjectSettings(p.repoPath, scope, patch)
    return store.getProject(id)
  })
  ipcMain.handle(IPC.projectsOpenSettings, (_e, id: string, scope: 'shared' | 'local') => {
    const p = store.getProject(id)
    if (!p) throw new Error('No such project')
    return system.openInEditor(settings.ensureProjectSettingsFile(p.repoPath, scope))
  })
  ipcMain.handle(IPC.projectsTrust, (_e, id: string, hash: string) => {
    const p = store.getProject(id)
    if (!p) throw new Error('No such project')
    settings.trustProjectSettings(p.repoPath, hash)
  })
  ipcMain.handle(IPC.settingsOpenUser, () => system.openInEditor(settings.ensureUserSettingsFile()))
  ipcMain.handle(IPC.settingsUserError, () => settings.userSettingsError())
  ipcMain.handle(IPC.keybindingsGet, () => settings.getKeybindings())
  ipcMain.handle(IPC.keybindingsSet, (_e, command: string, key: string | null) => settings.setKeybinding(command, key))
  ipcMain.handle(IPC.keybindingsOpen, () => system.openInEditor(settings.ensureKeybindingsFile()))

  ipcMain.handle(IPC.storeGetTasks, () => store.getTasks())
  ipcMain.handle(IPC.storeAddTask, (_e, task: Task) => {
    store.addTask(task)
    return store.getTasks()
  })
  ipcMain.handle(IPC.storeUpdateTask, (_e, id: string, patch: Partial<Task>) => store.updateTask(id, patch))
  ipcMain.handle(IPC.storeDeleteTask, (_e, id: string) => {
    store.deleteTask(id)
    return store.getTasks()
  })
  ipcMain.handle(IPC.storeSetTasks, (_e, tasks: Task[]) => {
    store.setTasks(tasks)
    return tasks
  })
  ipcMain.on(IPC.storeSetTasksNow, (e, tasks: Task[]) => {
    try {
      store.setTasks(tasks)
    } catch (err) {
      log.error('store', 'Could not save the tasks on close', err)
    }
    e.returnValue = true
  })
  ipcMain.handle(IPC.storeKeyHigh, () => store.keyHigh())
  ipcMain.handle(IPC.updatesCheck, () => updates.checkNow())
  ipcMain.handle(IPC.updatesInstall, () => updates.installNow())
  ipcMain.handle(IPC.updatesStatus, () => updates.status())
  updates.startUpdates()
  ipcMain.on(IPC.logWrite, (_e, level: string, scope: string, message: string, detail?: string) =>
    level === 'error' ? log.error(scope, message, detail) : log.warn(scope, message, detail)
  )
  ipcMain.handle(IPC.logOpenDir, async () => {
    const err = await shell.openPath(logsDir())
    if (err) throw new Error(err)
  })
  ipcMain.handle(IPC.storeGetComments, () => store.getComments())
  ipcMain.handle(IPC.storeAddComment, (_e, comment: ReviewComment) => {
    store.addComment(comment)
    return store.getComments()
  })
  ipcMain.handle(IPC.storeDeleteComment, (_e, id: string) => store.deleteComment(id))
  ipcMain.handle(IPC.storeGetNotices, () => store.getNotices())
  ipcMain.handle(IPC.storeSetNotices, (_e, notices: Notice[]) => store.setNotices(notices))
  ipcMain.handle(IPC.storeUpdateComments, (_e, patches: { id: string; patch: Partial<ReviewComment> }[]) => store.updateComments(patches))
  ipcMain.handle(IPC.storeClearTaskData, (_e, taskIds: string[]) => {
    store.clearTaskData(taskIds)
    checkpoints.forget(taskIds)
  })
  ipcMain.handle(IPC.storeGetViewedFiles, (_e, taskId: string) => store.getViewedFiles(taskId))
  ipcMain.handle(IPC.storeSetFileViewed, (_e, taskId: string, path: string, viewed: boolean) => store.setFileViewed(taskId, path, viewed))

  // Save as: text the page made (an export) to a file the user picks. Resolves with its path, or null.
  ipcMain.handle(IPC.dialogSaveText, async (e, name: string, text: string, filter: { name: string; extensions: string[] }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.SaveDialogOptions = { defaultPath: join(app.getPath('documents'), name), filters: [filter] }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, text, 'utf-8')
    return res.filePath
  })
  ipcMain.handle(IPC.dialogPickImages, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? [] : res.filePaths
  })
  // Pasted images, kept where every agent can read them (the data folder's attachments).
  ipcMain.handle(IPC.attachmentsSave, async (_e, dataUrl: string) => {
    const m = dataUrl.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/)
    if (!m) throw new Error('Not an image')
    const dir = join(app.getPath('userData'), 'attachments')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`)
    await writeFile(file, Buffer.from(m[2], 'base64'))
    return file
  })
  ipcMain.handle(IPC.dialogPickFolder, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.gitCheckRepo, (_e, path: string) => git.isGitRepo(path))
  ipcMain.handle(IPC.gitRepoInfo, (_e, path: string) => git.getRepoInfo(path))
  ipcMain.handle(IPC.gitSuggestWorktreePath, (_e, repoRoot: string, branch: string) => git.suggestWorktreePath(repoRoot, branch))
  ipcMain.handle(IPC.gitSuggestTaskDir, (_e, repoRoot: string, key: string) => git.suggestTaskDir(repoRoot, key))
  ipcMain.handle(IPC.gitMoveWorktree, (_e, repoPath: string, from: string, to: string) => git.moveWorktree(repoPath, from, to))
  ipcMain.handle(IPC.gitRemoveTaskDir, (_e, dir: string) => git.removeTaskDir(dir))
  ipcMain.handle(IPC.gitDetectProjectMeta, (_e, repoRoot: string) => detectProjectMeta(repoRoot))
  ipcMain.handle(IPC.gitListWorktrees, (_e, repoPath: string) => git.listWorktrees(repoPath))
  ipcMain.handle(IPC.gitAddWorktree, (_e, repoPath: string, worktreePath: string, branch: string, baseRef?: string) =>
    git.addWorktree(repoPath, worktreePath, branch, baseRef)
  )
  ipcMain.handle(IPC.gitRemoveWorktree, (_e, repoPath: string, worktreePath: string, force?: boolean) =>
    git.removeWorktree(repoPath, worktreePath, force)
  )
  ipcMain.handle(IPC.gitPruneWorktrees, (_e, repoPath: string) => git.pruneWorktrees(repoPath))
  ipcMain.handle(IPC.gitIsCheckout, (_e, path: string) => git.isWorktree(path))
  ipcMain.handle(IPC.gitWorktreeStatus, (_e, worktreePath: string, baseBranch: string) =>
    git.getWorktreeStatus(worktreePath, baseBranch)
  )
  ipcMain.handle(IPC.gitLog, (_e, worktreePath: string, limit?: number) => git.getLog(worktreePath, limit))
  ipcMain.handle(IPC.gitDiffFiles, (_e, worktreePath: string, baseBranch: string, scope?: unknown, opts?: DiffOptions) =>
    git.getDiffFiles(worktreePath, baseBranch, diffScope(scope), { ignoreSpace: !!opts?.ignoreSpace })
  )
  ipcMain.handle(IPC.gitDiffStat, (_e, worktreePath: string, baseBranch: string) => git.getDiffStat(worktreePath, baseBranch))
  ipcMain.handle(IPC.gitRebase, (_e, worktreePath: string, baseBranch: string, keepConflicts?: boolean) => git.rebaseOnto(worktreePath, baseBranch, !!keepConflicts))
  ipcMain.handle(IPC.gitFileHistory, (_e, worktreePath: string, path: string) => git.fileHistory(worktreePath, path))
  ipcMain.handle(IPC.gitBlame, (_e, worktreePath: string, path: string) => git.blame(worktreePath, path))
  ipcMain.handle(IPC.gitSyncState, (_e, worktreePath: string) => git.syncState(worktreePath))
  ipcMain.handle(IPC.gitMarkResolved, (_e, worktreePath: string, path: string) => git.markResolved(worktreePath, path))
  ipcMain.handle(IPC.gitTakeSide, (_e, worktreePath: string, path: string, side: 'ours' | 'theirs') => git.takeSide(worktreePath, path, side === 'theirs' ? 'theirs' : 'ours'))
  ipcMain.handle(IPC.gitContinueSync, (_e, worktreePath: string) => git.continueSync(worktreePath))
  ipcMain.handle(IPC.gitAbortSync, (_e, worktreePath: string) => git.abortSync(worktreePath))
  ipcMain.handle(IPC.gitMergeAndPrune, (_e, repoPath: string, worktreePath: string, branch: string, baseBranch: string, prune?: boolean, message?: string) =>
    git.mergeAndPrune(repoPath, worktreePath, branch, baseBranch, prune, message)
  )
  ipcMain.handle(IPC.gitIssues, (_e, repoPath: string) => git.listIssues(repoPath))
  ipcMain.handle(IPC.gitPrDetails, (_e, worktreePath: string, ref: string) => git.prDetails(worktreePath, ref))
  ipcMain.handle(IPC.baseList, () => baseSync.list())
  ipcMain.handle(IPC.baseFetch, (_e, projectId?: string) => baseSync.fetchNow(projectId))
  ipcMain.handle(IPC.basePull, (_e, projectId: string) => baseSync.pull(projectId))
  baseSync.start()
  ipcMain.handle(IPC.gitDiscardWorktree, (_e, repoPath: string, worktreePath: string, branch: string) =>
    git.discardWorktree(repoPath, worktreePath, branch)
  )
  ipcMain.handle(IPC.gitShortSha, (_e, repoPath: string, ref: string) => git.shortSha(repoPath, ref))
  ipcMain.handle(IPC.gitCopyIntoWorktree, (_e, repoPath: string, worktreePath: string, paths: string[]) =>
    git.copyIntoWorktree(repoPath, worktreePath, paths)
  )
  ipcMain.handle(IPC.gitCopySuggestions, (_e, repoPath: string) => git.copySuggestions(repoPath))
  ipcMain.handle(IPC.gitCreateBranch, (_e, repoPath: string, branch: string, baseBranch: string) => git.createBranch(repoPath, branch, baseBranch))
  ipcMain.handle(IPC.gitCommitAll, (_e, worktreePath: string, message: string) => git.commitAll(worktreePath, message))
  ipcMain.handle(IPC.gitDiscardFile, (_e, worktreePath: string, path: string) => git.discardFile(worktreePath, path))
  ipcMain.handle(IPC.gitCommitSelection, (_e, worktreePath: string, picks: git.CommitPick[], message: string) => git.commitSelection(worktreePath, picks, message))
  ipcMain.handle(IPC.gitCommitFiles, (_e, worktreePath: string, paths: string[], message: string) => git.commitFiles(worktreePath, paths, message))
  ipcMain.handle(IPC.gitRevertFile, (_e, worktreePath: string, baseBranch: string, scope: unknown, path: string, oldPath?: string) =>
    git.revertFile(worktreePath, baseBranch, diffScope(scope), path, oldPath)
  )
  ipcMain.handle(IPC.gitRevertHunk, (_e, worktreePath: string, path: string, lines: DiffLine[], oldPath?: string) => git.revertHunk(worktreePath, path, lines, oldPath))
  ipcMain.handle(IPC.gitDiffImage, (_e, worktreePath: string, baseBranch: string, scope: unknown, path: string, side: 'old' | 'new', oldPath?: string) =>
    git.diffImage(worktreePath, baseBranch, diffScope(scope), path, side === 'old' ? 'old' : 'new', oldPath)
  )
  ipcMain.handle(IPC.gitRemoteInfo, (_e, repoPath: string) => git.remoteInfo(repoPath))
  ipcMain.handle(IPC.gitPush, (_e, worktreePath: string, branch: string) => git.pushBranch(worktreePath, branch))
  ipcMain.handle(IPC.gitCreatePr, (_e, worktreePath: string, repoPath: string, branch: string, baseBranch: string, title: string, body: string) =>
    git.createPr(worktreePath, repoPath, branch, baseBranch, title, body)
  )
  ipcMain.handle(IPC.gitPrStatus, (_e, worktreePath: string, ref: string) => git.prStatus(worktreePath, ref))
  ipcMain.handle(IPC.gitUnpushed, (_e, worktreePath: string, branch: string, baseBranch: string) => git.unpushedCount(worktreePath, branch, baseBranch))
  ipcMain.handle(IPC.gitCloseWithPr, (_e, repoPath: string, worktreePath: string, branch: string, baseBranch: string, merged: boolean, prRef?: string) =>
    git.closeWithPr(repoPath, worktreePath, branch, baseBranch, merged, prRef)
  )
  ipcMain.handle(IPC.gitFindPr, (_e, worktreePath: string, branch: string, since: number) => git.findPr(worktreePath, branch, since))
  ipcMain.handle(IPC.gitPrMergeMethods, (_e, cwd: string) => git.prMergeMethods(cwd))
  ipcMain.handle(IPC.gitMergePr, (_e, cwd: string, ref: string, method: git.PrMergeMethod) => git.mergePr(cwd, ref, method))
  ipcMain.handle(IPC.gitCloseCheck, (_e, worktreePath: string, branch: string, baseBranch: string, prRef?: string) => git.closeCheck(worktreePath, branch, baseBranch, prRef))
  ipcMain.handle(IPC.gitListBranches, (_e, repoPath: string, baseBranch: string) => git.listBranches(repoPath, baseBranch))
  ipcMain.handle(IPC.gitBranchLeft, (_e, repoPath: string, branch: string, baseBranch: string) => git.branchLeft(repoPath, branch, baseBranch))
  ipcMain.handle(IPC.worktreesPruneNow, () => cleanup.pruneStale(true))
  cleanup.startCleanup()

  ipcMain.handle(IPC.ptySpawn, (e, opts: PtySpawnOptions) => ptyService.spawn(e.sender, opts))
  ipcMain.handle(IPC.ptyExists, (_e, id: string) => ptyService.exists(id))
  ipcMain.handle(IPC.ptyInfo, (_e, id: string) => ptyService.info(id))
  ipcMain.on(IPC.ptySendText, (_e, id: string, text: string) => ptyService.sendText(id, text))
  ipcMain.handle(IPC.ptyGetBuffer, (_e, id: string) => ptyService.getBuffer(id))
  ipcMain.on(IPC.ptyWrite, (_e, id: string, data: string) => ptyService.write(id, data))
  ipcMain.on(IPC.ptyResize, (_e, id: string, cols: number, rows: number) => ptyService.resize(id, cols, rows))
  ipcMain.handle(IPC.ptyKill, (_e, id: string) => ptyService.kill(id))
  ipcMain.handle(IPC.ptyList, (_e, prefix: string) => ptyService.list(prefix))
  ipcMain.handle(IPC.ptyKillPrefix, (_e, prefix: string) => ptyService.killPrefix(prefix))

  ipcMain.handle(IPC.agentsDetectInstalled, () => agentsService.detectInstalled())
  ipcMain.handle(IPC.agentsResolveBin, (_e, kind: AgentKind) => agentsService.resolveBin(kind))
  ipcMain.handle(IPC.agentsVersion, (_e, kind: AgentKind) => agentsService.getVersion(kind))
  ipcMain.handle(IPC.agentsCurrentStatus, () => agentStatus.current())
  ipcMain.handle(IPC.agentsHookSettings, (_e, taskId: string, tools?: boolean) => hooks.settingsFileFor(taskId, tools))
  ipcMain.handle(IPC.agentsToolArgs, (_e, taskId: string, kind: string) => hooks.toolLaunchFor(taskId, kind))
  ipcMain.handle(IPC.agentsTypeWhenReady, (_e, taskId: string, text: string) => void inbox.deliver(taskId, text))
  // Switchyard's tools for the agents (MCP), and the conflict radar they and the board use.
  hooks.onMcpRequest(handleMcp)
  registerWindowReplies()
  ipcMain.handle(IPC.conflictsGet, () => conflicts.report())
  ipcMain.handle(IPC.conflictsScan, () => conflicts.scan())
  ipcMain.handle(IPC.conflictsPreview, (_e, repoId: string, a: string, b: string | null, file: string) => conflicts.preview(repoId, a, b, file))
  conflicts.start()
  // The Team channel: agents' messages to each other, and yours to them.
  ipcMain.handle(IPC.outsideScan, (_e, projectId?: string) => outside.scan(projectId))
  ipcMain.handle(IPC.mapTree, (_e, projectId: string) => repoMap.tree(projectId))
  ipcMain.handle(IPC.mapActivity, (_e, projectId: string) => repoMap.activity(projectId))
  ipcMain.handle(IPC.activityList, () => activity.list())
  ipcMain.handle(IPC.activityAdd, (_e, event: ActivityEvent) => activity.add(event))
  ipcMain.handle(IPC.activitySeen, (_e, at: number) => activity.seen(at))
  ipcMain.handle(IPC.activityAnnounced, (_e, day: string) => activity.announced(day))
  ipcMain.handle(IPC.teamList, () => team.list())
  ipcMain.handle(IPC.teamSend, (_e, to: string, text: string) => team.send('user', to, text))
  ipcMain.handle(IPC.teamRelease, (_e, id: string) => team.release(id))
  ipcMain.handle(IPC.evidenceImage, (_e, path: string) => evidenceImage(path))
  team.start()
  ipcMain.handle(IPC.agentsTranscript, (_e, path: string) => transcript.summarize(path))
  agentStatus.start()
  limits.start()
  hooks.onHookEvent(agentStatus.fromHook)

  ipcMain.on(IPC.menuSet, (_e, model: MenuModel[]) => menu.setMenu(model))
  ipcMain.on(IPC.menuRole, (e, role: MenuRole) => menu.runRole(e.sender, role))

  ipcMain.handle(IPC.prefsGet, () => store.getPrefs())
  ipcMain.handle(IPC.prefsSet, (_e, patch: Partial<Prefs>) => store.setPrefs(patch))

  // Plugins (Settings → Plugins; their commands from the palette, menus and keys).
  ipcMain.handle(IPC.pluginsList, () => plugins.list())
  ipcMain.handle(IPC.pluginsSetEnabled, (_e, id: string, on: boolean) => plugins.setEnabled(String(id), !!on))
  ipcMain.handle(IPC.pluginsReload, () => plugins.reload())
  ipcMain.handle(IPC.pluginsScaffold, () => plugins.scaffold())
  ipcMain.handle(IPC.pluginsOpenFolder, () => plugins.openFolder())
  ipcMain.handle(IPC.pluginsOpen, (_e, dir: string) => {
    if (typeof dir !== 'string' || !plugins.isPluginDir(dir)) throw new Error('Not a plugin folder')
    return shell.openPath(dir)
  })
  // Installing: look at a package first (Settings asks), then install it.
  ipcMain.handle(IPC.pluginsPickPackage, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = { title: 'Install a plugin', properties: ['openFile'], filters: [{ name: 'Switchyard plugin', extensions: ['syplugin'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || !r.filePaths[0] ? null : plugins.previewFile(r.filePaths[0])
  })
  ipcMain.handle(IPC.pluginsPreviewFile, (_e, path: string) => plugins.previewFile(String(path)))
  ipcMain.handle(IPC.pluginsPreviewUrl, (_e, url: string) => plugins.previewUrl(String(url)))
  ipcMain.handle(IPC.pluginsInstall, (_e, token: string, turnOn: boolean) => plugins.install(String(token), !!turnOn))
  ipcMain.handle(IPC.pluginsDiscard, (_e, token: string) => plugins.discard(String(token)))
  ipcMain.handle(IPC.pluginsUninstall, (_e, id: string) => plugins.uninstall(String(id)))
  ipcMain.handle(IPC.pluginsTakeOpened, () => plugins.takeOpened())
  ipcMain.handle(IPC.pluginsLinkFolder, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = { title: 'Load a plugin from its folder', properties: ['openDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || !r.filePaths[0] ? null : plugins.linkFolder(r.filePaths[0])
  })
  // The packager: a plugin's folder (or one picked) as a .syplugin, saved where the user says.
  ipcMain.handle(IPC.pluginsPackage, async (e, dir: string | null) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    let from = typeof dir === 'string' ? dir : null
    if (from && !plugins.isPluginDir(from)) throw new Error('Not a plugin folder')
    if (!from) {
      const opts: Electron.OpenDialogOptions = { title: "Package a plugin - its folder (the one with plugin.json)", properties: ['openDirectory'] }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (r.canceled || !r.filePaths[0]) return null
      from = r.filePaths[0]
    }
    const save: Electron.SaveDialogOptions = { title: 'Save the plugin package', defaultPath: join(app.getPath('downloads'), plugins.packageName(from)), filters: [{ name: 'Switchyard plugin', extensions: ['syplugin'] }] }
    const out = win ? await dialog.showSaveDialog(win, save) : await dialog.showSaveDialog(save)
    return out.canceled || !out.filePath ? null : plugins.packageTo(from, out.filePath)
  })
  ipcMain.handle(IPC.pluginsRun, (_e, command: string, ctx: PluginCommandContext) => plugins.run(String(command), ctx ?? { taskId: null, projectId: null }))

  ipcMain.handle(IPC.reposScan, (_e, path: string) => repos.scan(path))
  ipcMain.handle(IPC.reposBrowse, (_e, dir: string) => repos.browse(dir))
  ipcMain.handle(IPC.reposPlaces, () => repos.places())
  ipcMain.handle(IPC.reposRecent, () => repos.recentRepos())
  ipcMain.handle(IPC.reposClone, (_e, url: string) => repos.clone(url))
  ipcMain.handle(IPC.reposInit, (_e, path: string, branch: string) => repos.initRepo(path, branch))
  ipcMain.handle(IPC.reposIsUrl, (_e, s: string) => repos.isGitUrl(s))
  ipcMain.handle(IPC.reposCloneDir, () => repos.defaultCloneDir())
  ipcMain.handle(IPC.reposUserName, () => repos.gitUserName())

  ipcMain.handle(IPC.sysShells, () => system.shells())
  // Known at once: a terminal tab's default profile is looked up by its id.
  system.shells().catch((err) => log.warn('system', 'Could not list terminal profiles', err))
  ipcMain.handle(IPC.sysEditors, () => system.editors())
  ipcMain.handle(IPC.sysOpenInEditor, (_e, path: string) => system.openInEditor(path))
  ipcMain.handle(IPC.sysReveal, (_e, path: string) => system.reveal(path))
  ipcMain.handle(IPC.sysShowItem, (_e, path: string) => system.showItem(path))
  ipcMain.handle(IPC.sysOpenTerminal, (_e, path: string) => system.openTerminal(path))
  ipcMain.on(IPC.sysCopy, (_e, text: string) => system.copyText(text))
  ipcMain.on(IPC.sysNotify, (_e, title: string, body: string, taskId: string | null, actions?: NotifyAction[]) =>
    system.notify(title, body, taskId, Array.isArray(actions) ? actions.filter((a) => typeof a?.id === 'string' && typeof a?.label === 'string').slice(0, 3) : [])
  )
  ipcMain.on(IPC.sysHomeDir, (e) => (e.returnValue = homedir()))
  ipcMain.handle(IPC.sysOpenExternal, (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only web addresses can be opened.')
    return shell.openExternal(url)
  })

  ipcMain.handle(IPC.netFreePort, () => ports.freePort())
  ipcMain.handle(IPC.netPortOpen, (_e, port: number) => ports.portOpen(port))

  ipcMain.handle(IPC.notesList, () => {
    notes.watchNotes()
    return notes.list()
  })
  ipcMain.handle(IPC.notesSave, (_e, draft: NoteDraft) => notes.save(draft))
  ipcMain.handle(IPC.notesDelete, (_e, id: string) => notes.remove(id))
  ipcMain.handle(IPC.notesDir, () => notes.notesDir())
  ipcMain.handle(IPC.usageList, () => usage.list())
  ipcMain.handle(IPC.previewSaveShot, (_e, root: string, dataUrl: string) => saveShot(root, dataUrl))
  ipcMain.handle(IPC.checkpointsList, (_e, taskId: string) => checkpoints.list(taskId))
  ipcMain.handle(IPC.checkpointsDiff, (_e, taskId: string, id: string, fromId?: string) => checkpoints.diff(taskId, id, fromId))
  ipcMain.handle(IPC.checkpointsRewind, (_e, taskId: string, id: string) => checkpoints.rewind(taskId, id))
  usage.backfill()
  ipcMain.handle(IPC.themesGet, () => themes.getThemes())
  ipcMain.on(IPC.themesChrome, (e, c: Parameters<typeof themes.applyChrome>[1]) => themes.applyChrome(BrowserWindow.fromWebContents(e.sender), c))
  ipcMain.handle(IPC.themesDuplicate, (_e, t: Theme, name: string) => themes.duplicateTheme(t, name))
  ipcMain.handle(IPC.themesImport, (e) => themes.importThemes(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle(IPC.themesOpenDir, async () => {
    const err = await shell.openPath(themes.themesDir())
    if (err) throw new Error(err)
  })
  ipcMain.handle(IPC.notesImage, (_e, ref: string) => notes.imageData(ref))
  ipcMain.handle(IPC.notesImportPick, (e, kind: 'files' | 'folder', link?: NoteLink) => notesTransfer.importPicked(BrowserWindow.fromWebContents(e.sender), kind, link))
  ipcMain.handle(IPC.notesImportPaths, (_e, paths: string[], link?: NoteLink) => notesTransfer.importPaths(paths, link))
  ipcMain.handle(IPC.notesExportOne, (e, body: string) => notesTransfer.exportOne(BrowserWindow.fromWebContents(e.sender), body))
  ipcMain.handle(IPC.notesExportMany, (e, ids: string[]) => notesTransfer.exportMany(BrowserWindow.fromWebContents(e.sender), ids))

  ipcMain.handle(IPC.fsList, (_e, root: string, baseBranch?: string, bases?: Record<string, string>) => fsService.listFiles(root, baseBranch, bases))
  ipcMain.handle(IPC.fsRead, (_e, path: string) => fsService.readFile(path))
  ipcMain.handle(IPC.fsWrite, async (_e, path: string, content: string) => {
    // A save in a task's worktree while its agent works: the agent hears about it (see coedit).
    const before = await readFile(path, 'utf-8').catch(() => null)
    await fsService.writeFile(path, content)
    userSaved(path, before, content)
  })
  ipcMain.handle(IPC.fsReadDoc, (_e, path: string) => fsService.readDoc(path))
  ipcMain.handle(IPC.fsWriteDoc, async (_e, path: string, text: string, o: { eol: '\n' | '\r\n'; bom: boolean; expectMtime?: number | null }) => {
    const before = await readFile(path, 'utf-8').catch(() => null)
    const mtime = await fsService.writeDoc(path, text, o)
    userSaved(path, before, text)
    return mtime
  })
  ipcMain.handle(IPC.fsEditorConfig, (_e, path: string) => fsService.editorConfig(path))
  ipcMain.handle(IPC.fsWatch, (e, root: string) => watchFolder(e.sender, root))
  ipcMain.handle(IPC.fsUnwatch, (_e, id: number) => unwatchFolder(id))
  ipcMain.handle(IPC.fsCreate, (_e, path: string, isDir: boolean) => fsService.createEntry(path, isDir))
  ipcMain.handle(IPC.fsDelete, (_e, path: string) => fsService.deleteEntry(path))
  ipcMain.handle(IPC.fsRename, (_e, oldPath: string, newPath: string) => fsService.renameEntry(oldPath, newPath))
  ipcMain.handle(IPC.fsCopy, (_e, src: string, destDir: string) => fsService.copyEntry(src, destDir))
  ipcMain.handle(IPC.fsMove, (_e, src: string, destDir: string) => fsService.moveEntry(src, destDir))
  ipcMain.handle(IPC.fsListAll, (_e, root: string) => fsService.listAllFiles(root))
  ipcMain.handle(IPC.fsSearchText, (_e, root: string, o: TextSearchOptions) => fsService.searchText(root, o))
  ipcMain.handle(IPC.fsReplaceText, (_e, root: string, o: TextSearchOptions, replacement: string, paths: string[]) => fsService.replaceText(root, o, replacement, paths))
}
