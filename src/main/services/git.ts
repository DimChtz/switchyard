import { gitAt, gitArgs, gitEnv, gitFailure, gitYes, newestBase } from './gitEnv'
import { basename, dirname, isAbsolute, join } from 'path'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getPrefs } from './store'
import { log } from './log'
import { expandPath } from './repos'
import { toPrDetails } from '@shared/pr'
import { samePath } from './paths'
import type { PrDetails } from '@shared/types'
import type { BranchInfo, BranchResult, Blame, FileCommit, FileDiff, DiffLine, DiffOptions, DiffScope, DiffStat, SyncState, GitWorktreeInfo, Issue, PullRequest, RemoteInfo, RepoInfo, WorktreeStatus } from '@shared/types'

/**
 * Where a task's worktree goes: a .worktrees folder inside the repository,
 * or <root>/<repo name>/<branch> when a worktree root is set in Settings.
 */
export function suggestWorktreePath(repoRoot: string, branch: string): string {
  const branchSlug = branch.replace(/[\\/]/g, '-')
  const root = getPrefs().worktreeRoot
  return root ? join(expandPath(root), basename(repoRoot), branchSlug) : join(repoRoot, '.worktrees', branchSlug)
}

/**
 * The folder of a task in several repositories: one worktree per repository
 * inside it. Next to the home repository's worktrees (.worktrees/_multi/KEY),
 * or under the worktree root from Settings.
 */
export function suggestTaskDir(homeRepoRoot: string, key: string): string {
  const root = getPrefs().worktreeRoot
  return root ? join(expandPath(root), '_multi', key) : join(homeRepoRoot, '.worktrees', '_multi', key)
}

/** Moves a worktree to another folder (a task that gains a second repository moves into its task folder). */
export async function moveWorktree(repoPath: string, from: string, to: string): Promise<void> {
  await fs.mkdir(join(to, '..'), { recursive: true })
  await gitAt(repoPath).raw(['worktree', 'move', from, to])
}

/** Removes a task's folder once its worktrees are gone (only if nothing else is left in it). */
export async function removeTaskDir(dir: string): Promise<void> {
  try {
    await fs.rmdir(dir)
  } catch {
    // Not empty (or already gone) - leave it.
  }
}

/**
 * Keeps .worktrees/ out of git status - in the repository's own exclude
 * file (.git/info/exclude), which isn't committed: the project's .gitignore
 * is left alone. (A .gitignore that already lists it is fine too.)
 */
async function ensureWorktreesIgnored(repoPath: string): Promise<void> {
  const git = gitAt(repoPath)
  if (await gitYes(repoPath, ['check-ignore', '-q', '.worktrees/x'])) return
  const common = (await git.revparse(['--git-common-dir'])).trim()
  const file = join(isAbsolute(common) ? common : join(repoPath, common), 'info', 'exclude')
  await fs.mkdir(join(file, '..'), { recursive: true })
  const content = await fs.readFile(file, 'utf-8').catch(() => '')
  const sep = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
  await fs.writeFile(file, `${content}${sep}# Switchyard's task worktrees\n/.worktrees/\n`, 'utf-8')
}

export async function shortSha(repoPath: string, ref: string): Promise<string | null> {
  try {
    return (await gitAt(repoPath).revparse(['--short', ref])).trim() || null
  } catch {
    return null
  }
}

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    const git = gitAt(path)
    return await git.checkIsRepo()
  } catch {
    return false
  }
}

export async function getRepoInfo(repoPath: string): Promise<RepoInfo> {
  const git = gitAt(repoPath)
  const root = (await git.revparse(['--show-toplevel'])).trim()

  let repo = basename(root)
  try {
    const remotes = await git.getRemotes(true)
    const origin = remotes.find((r) => r.name === 'origin')
    if (origin?.refs?.fetch) {
      const match = origin.refs.fetch.match(/[/:]([^/:]+\/[^/]+?)(\.git)?$/)
      if (match) repo = match[1]
    }
  } catch {
    // no remote configured; fall back to directory name
  }

  return { repo, defaultBranch: await defaultBranchOf(root), root }
}

/**
 * The branch work starts from and merges into: what origin calls its
 * default (origin/HEAD), else git's init.defaultBranch, main or master if
 * there's such a branch - and only then whatever happens to be checked out
 * (adding a project while on a feature branch shouldn't make that the base).
 */
export async function defaultBranchOf(repoPath: string): Promise<string> {
  const git = gitAt(repoPath)
  const local = new Set((await git.branchLocal().catch(() => ({ all: [] as string[] }))).all)
  const tryRaw = (args: string[]): Promise<string> => git.raw(args).then((o) => o.trim(), () => '')
  const fromOrigin = (await tryRaw(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//, '')
  if (fromOrigin) return fromOrigin
  const configured = await tryRaw(['config', '--get', 'init.defaultBranch'])
  for (const b of [configured, 'main', 'master', 'trunk', 'develop']) if (b && local.has(b)) return b
  return (await tryRaw(['branch', '--show-current'])) || 'main'
}

export async function listWorktrees(repoPath: string): Promise<GitWorktreeInfo[]> {
  const git = gitAt(repoPath)
  const raw = await git.raw(['worktree', 'list', '--porcelain'])
  const blocks = raw.split(/\n\n+/).filter(Boolean)
  const result: GitWorktreeInfo[] = []

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    let path = ''
    let branch = ''
    let headSha = ''
    let locked = false
    let prunable = false

    for (const line of lines) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
      else if (line.startsWith('HEAD ')) headSha = line.slice('HEAD '.length)
      else if (line.startsWith('branch ')) branch = line.slice('branch '.length).replace('refs/heads/', '')
      else if (line.startsWith('locked')) locked = true
      else if (line.startsWith('prunable')) prunable = true
    }

    if (path) {
      result.push({ path, branch, headSha, isMain: result.length === 0, locked, prunable })
    }
  }

  return result
}

/**
 * The launch flow's first step: creates the task branch from the project's
 * base branch (not whatever the main checkout has out), after a quick fetch
 * so it can say when the local base is behind its remote. An existing
 * branch is reused as it is.
 */
export async function createBranch(repoPath: string, branch: string, baseBranch: string): Promise<BranchResult> {
  const git = gitAt(repoPath)
  const branches = await git.branchLocal()
  if (branches.all.includes(branch)) {
    return { existed: true, base: branch, sha: (await shortSha(repoPath, branch)) ?? '', behindRemote: 0 }
  }
  // Only on origin (someone else's, or pushed from another machine): the task continues it, tracking origin's.
  if (await gitYes(repoPath, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]).catch(() => false)) {
    await git.raw(['branch', '--track', branch, `origin/${branch}`])
    return { existed: true, fromOrigin: true, base: `origin/${branch}`, sha: (await shortSha(repoPath, branch)) ?? '', behindRemote: 0 }
  }
  const base = branches.all.includes(baseBranch) ? baseBranch : 'HEAD'
  let behindRemote = 0
  if (base !== 'HEAD' && (await git.getRemotes()).some((r) => r.name === 'origin')) {
    await withTimeout(gitAt(repoPath, { network: true }).fetch('origin', baseBranch), 15_000).catch((err) => log.warn('git', `Could not fetch ${baseBranch}`, err))
    try {
      behindRemote = Number((await git.raw(['rev-list', '--count', `${baseBranch}..origin/${baseBranch}`])).trim()) || 0
    } catch {
      // no such remote branch
    }
  }
  await git.raw(['branch', branch, base])
  return { existed: false, base: base === 'HEAD' ? branches.current : base, sha: (await shortSha(repoPath, branch)) ?? '', behindRemote }
}

/**
 * The branches a task could start on, newest first: local ones, and ones
 * only on origin (as last fetched - no network here), with where each is
 * checked out. HEAD and the base branch itself aren't offered.
 */
export async function listBranches(repoPath: string, baseBranch: string): Promise<BranchInfo[]> {
  const out = await gitAt(repoPath).raw(['for-each-ref', '--sort=-committerdate', '--format=%(refname)%00%(committerdate:unix)%00%(subject)', 'refs/heads', 'refs/remotes/origin'])
  const trees = await listWorktrees(repoPath).catch(() => [])
  const byName = new Map<string, BranchInfo>()
  for (const line of out.split('\n')) {
    const [ref, at, subject] = line.split('\0')
    if (!ref) continue
    const local = ref.startsWith('refs/heads/')
    const name = local ? ref.slice('refs/heads/'.length) : ref.slice('refs/remotes/origin/'.length)
    if (!name || name === 'HEAD' || name === baseBranch) continue
    const b = byName.get(name) ?? { name, local: false, remote: false, at: Number(at) * 1000 || 0, subject: subject ?? '', worktree: null, mainCheckout: false }
    if (local) b.local = true
    else b.remote = true
    byName.set(name, b)
  }
  for (const w of trees) {
    const b = w.branch ? byName.get(w.branch) : undefined
    if (b) {
      b.worktree = w.path
      b.mainCheckout = w.isMain
    }
  }
  return [...byName.values()].slice(0, 300)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))])
}

export async function addWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  baseRef = 'HEAD'
): Promise<void> {
  const git = gitAt(repoPath)
  const branches = await git.branchLocal()
  if (branches.all.includes(branch)) {
    await git.raw(['worktree', 'add', worktreePath, branch])
  } else {
    await git.raw(['worktree', 'add', '-b', branch, worktreePath, baseRef])
  }
  if (join(worktreePath).startsWith(join(repoPath, '.worktrees'))) {
    await ensureWorktreesIgnored(repoPath).catch((err) => log.warn('git', 'Could not add .worktrees/ to .git/info/exclude', err))
  }
}

export async function removeWorktree(repoPath: string, worktreePath: string, force = false): Promise<void> {
  const git = gitAt(repoPath)
  const args = ['worktree', 'remove', worktreePath]
  if (force) args.push('--force')
  await git.raw(args)
}

/** Undo a task worktree: remove it and its branch (either may be '' to skip it). */
export async function discardWorktree(repoPath: string, worktreePath: string, branch: string): Promise<void> {
  const git = gitAt(repoPath)
  if (worktreePath) await dropWorktree(repoPath, worktreePath)
  if (branch) await git.raw(['branch', '-D', branch]).catch(() => {})
}

export async function pruneWorktrees(repoPath: string): Promise<void> {
  const git = gitAt(repoPath)
  await git.raw(['worktree', 'prune'])
}

/**
 * Merges a task branch into the base branch; removes its worktree and
 * branch unless `prune` is off. Refuses while the worktree has uncommitted
 * changes (only commits get merged - removing the folder would lose the
 * rest), and backs out of a conflicting merge so the main checkout is left
 * as it was.
 */
export async function mergeAndPrune(repoPath: string, worktreePath: string, branch: string, baseBranch: string, prune = true, message?: string): Promise<{ merged: boolean }> {
  // A worktree folder deleted outside Switchyard has nothing uncommitted to lose; its commits are on the branch.
  const dirty = (await isWorktree(worktreePath)) ? (await gitAt(worktreePath).status()).files.length : 0
  if (dirty > 0) {
    throw new Error(`The worktree has ${dirty} uncommitted change${dirty > 1 ? 's' : ''} - commit or discard them first (Changes tab).`)
  }
  const main = gitAt(repoPath)
  // Nothing the base doesn't have already (no commits of its own, or merged some other way - a
  // squash on GitHub, say): no merge, so no empty merge commit on the base. No branch at all: nothing either.
  const merged = (await branchExists(repoPath, branch)) && !(await nothingToMerge(repoPath, branch, baseBranch))
  if (merged) {
    // The base branch checked out somewhere: merge there, so its files follow.
    // Checked out nowhere (you're on another branch): merge without a checkout.
    const holder = (await listWorktrees(repoPath)).find((w) => w.branch === baseBranch)
    if (!holder) await mergeWithoutCheckout(repoPath, branch, baseBranch, message)
    else await mergeIn(holder.path, branch, baseBranch, message)
  }
  if (!prune) return { merged }
  // Checked clean above - --force only gets ignored files (node_modules, .env) out of the way.
  await dropWorktree(repoPath, worktreePath)
  // -D when nothing was merged: its commits may be in the base only as a squash, which -d doesn't see.
  // (Kept when Settings → Git says so.)
  if (getPrefs(repoPath).deleteBranchOnFinish !== false) await main.raw(['branch', merged ? '-d' : '-D', branch]).catch(() => {})
  return { merged }
}

function branchExists(repoPath: string, branch: string): Promise<boolean> {
  return gitYes(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).catch(() => false)
}

/**
 * The commits on `branch` that merging it into the base would bring: 0 when
 * there's nothing to merge, null when the branch doesn't exist.
 */
export async function branchLeft(repoPath: string, branch: string, baseBranch: string): Promise<number | null> {
  if (!(await branchExists(repoPath, branch))) return null
  if (await nothingToMerge(repoPath, branch, baseBranch)) return 0
  const n = await gitAt(repoPath)
    .raw(['rev-list', '--count', `refs/heads/${baseBranch}..refs/heads/${branch}`])
    .then((out) => Number(out.trim()) || 0)
    .catch(() => 0)
  return Math.max(n, 1)
}

/**
 * Whether merging `branch` into `base` would change nothing: the branch is
 * behind it (or the same), or the merge's files are the base's files already.
 */
export async function nothingToMerge(repoPath: string, branch: string, baseBranch: string): Promise<boolean> {
  if (await gitYes(repoPath, ['merge-base', '--is-ancestor', `refs/heads/${branch}`, `refs/heads/${baseBranch}`]).catch(() => false)) return true
  // The merge as git would make it (git 2.38+), without touching anything: its tree against the base's.
  const r = await execFileP('git', gitArgs(['merge-tree', '--write-tree', '--no-messages', `refs/heads/${baseBranch}`, `refs/heads/${branch}`]), { cwd: repoPath, env: gitEnv(), windowsHide: true, maxBuffer: 16 * 1024 * 1024 }).catch(
    (err: { code?: number }) => (err.code === 1 ? { stdout: '' } : null) // 1: it conflicts - so there's something to merge
  )
  if (r) {
    const tree = r.stdout.split('\n')[0].trim()
    const baseTree = (await gitAt(repoPath).raw(['rev-parse', `refs/heads/${baseBranch}^{tree}`]).catch(() => '')).trim()
    return !!tree && tree === baseTree
  }
  // Older git: every file the branch changed reads the same in the base already.
  const missing = await notIn(gitAt(repoPath), `refs/heads/${baseBranch}`, `refs/heads/${branch}`)
  return !!missing && missing.length === 0
}

/** A merge in the checkout that has the base branch out; a conflicting one is backed out again. */
async function mergeIn(checkout: string, branch: string, baseBranch: string, message?: string): Promise<void> {
  const main = gitAt(checkout)
  try {
    // With a message ("closes #12") there's always a merge commit to carry it.
    await main.merge([branch, '--no-edit', ...(message ? ['--no-ff', '-m', message] : [])])
  } catch (err) {
    const conflicted = (await main.status()).conflicted
    if (conflicted.length === 0) throw err
    await main.merge(['--abort']).catch(() => {})
    throw new Error(
      `Merging into ${baseBranch} conflicts in ${listFiles(conflicted)}. Nothing was changed - sync the branch with ${baseBranch} and resolve the conflicts in the worktree first.`,
      { cause: err }
    )
  }
}

/**
 * Merges into a branch nobody has checked out, without touching any files:
 * a fast-forward when the base hasn't moved (and no message needs a merge
 * commit); otherwise git merge-tree builds the result (git 2.38+) - or, on
 * an older git, a merge in a throwaway checkout - and it's committed on top
 * of the base. The branch moves only if it's still where it was.
 */
export async function mergeWithoutCheckout(repoPath: string, branch: string, baseBranch: string, message?: string): Promise<void> {
  const git = gitAt(repoPath)
  const rev = async (ref: string): Promise<string> => (await git.revparse([`refs/heads/${ref}`])).trim()
  const [base, head] = await Promise.all([rev(baseBranch), rev(branch)])
  const ancestor = await gitYes(repoPath, ['merge-base', '--is-ancestor', base, head])
  const conflictError = (files: string[]): Error =>
    new Error(`Merging into ${baseBranch} conflicts in ${listFiles(files.length ? files : ['some files'])}. Nothing was changed - sync the branch with ${baseBranch} and resolve the conflicts in the worktree first.`)
  let result = head
  if (!ancestor || message) {
    const commitMessage = message ?? `Merge branch '${branch}' into ${baseBranch}`
    // Run directly: its exit code is what says "conflicts" (1), with nothing on stderr.
    const merged = await execFileP('git', gitArgs(['merge-tree', '--write-tree', '--no-messages', '-z', base, head]), { cwd: repoPath, env: gitEnv(), windowsHide: true, maxBuffer: 16 * 1024 * 1024 }).then(
      (r) => ({ code: 0, out: r.stdout }),
      (err: { code?: number; stdout?: string }) => ({ code: typeof err.code === 'number' ? err.code : -1, out: err.stdout ?? '' })
    )
    const parts = merged.out.split('\0')
    if (merged.code === 0) {
      result = (await git.raw(['commit-tree', parts[0].trim(), '-p', base, '-p', head, '-m', commitMessage])).trim()
    } else if (merged.code === 1) {
      throw conflictError([...new Set(parts.slice(1).map((p) => p.match(/^\d+ [0-9a-f]+ \d\t(.+)$/)?.[1]).filter((f): f is string => !!f))])
    } else {
      result = await mergeInScratch(repoPath, base, branch, commitMessage, conflictError)
    }
  }
  await git.raw(['update-ref', '-m', `switchyard: merge ${branch}`, `refs/heads/${baseBranch}`, result, base])
}

/** git before 2.38 (no merge-tree --write-tree): the merge in a throwaway detached checkout, removed afterwards. */
async function mergeInScratch(repoPath: string, base: string, branch: string, message: string, conflictError: (files: string[]) => Error): Promise<string> {
  const dir = join(await fs.mkdtemp(join(tmpdir(), 'switchyard-merge-')), 'wt')
  const git = gitAt(repoPath)
  await git.raw(['worktree', 'add', '--detach', '--quiet', dir, base])
  try {
    const wt = gitAt(dir)
    try {
      await wt.merge(['--no-ff', '--no-edit', '-m', message, branch])
    } catch (err) {
      const conflicted = (await wt.status()).conflicted
      if (conflicted.length) throw conflictError(conflicted)
      throw err
    }
    return (await wt.revparse(['HEAD'])).trim()
  } finally {
    await git.raw(['worktree', 'remove', '--force', dir]).catch((err) => log.warn('git', `Could not remove the scratch checkout ${dir}`, err))
    await fs.rm(join(dir, '..'), { recursive: true, force: true }).catch(() => {})
  }
}

function listFiles(files: string[]): string {
  return files.length > 3 ? `${files.slice(0, 3).join(', ')} and ${files.length - 3} more` : files.join(', ')
}

/** Stages everything in the worktree (ignored files stay out) and commits it. */
export async function commitAll(worktreePath: string, message: string): Promise<string> {
  const git = gitAt(worktreePath)
  await git.add(['-A'])
  const res = await git.commit(message)
  if (!res.commit) throw new Error('Nothing to commit.')
  return res.commit
}

/** Throws away one file's uncommitted changes: restored from HEAD, or deleted when it's new. */
export async function discardFile(worktreePath: string, path: string): Promise<void> {
  const git = gitAt(worktreePath)
  const inHead = await gitYes(worktreePath, ['cat-file', '-e', `HEAD:${path}`]).catch(() => false)
  if (inHead) {
    await git.raw(['checkout', 'HEAD', '--', path])
    return
  }
  await git.raw(['rm', '--cached', '--force', '--quiet', '--', path]).catch(() => {})
  await fs.rm(join(worktreePath, path), { force: true, recursive: true })
}

/** Stages just these files (ignored ones stay out) and commits them - anything else already staged stays out too. */
export async function commitFiles(worktreePath: string, paths: string[], message: string): Promise<string> {
  if (!paths.length) throw new Error('No files picked.')
  const git = gitAt(worktreePath)
  await git.add(['-A', '--', ...paths])
  // (--only: the commit takes these paths as they are now, whatever else is in the index.)
  await git.raw(['commit', '--only', '--quiet', '-m', message, '--', ...paths])
  return (await git.revparse(['HEAD'])).trim()
}

/** What goes into a commit from one file: all of it, or (`lines`, `include`) only some of its changed lines. */
export interface CommitPick {
  path: string
  /** Moved from here (its deletion goes in too). */
  oldPath?: string
  /** The file's uncommitted diff (vs HEAD) and the indexes of its changed lines to commit. */
  lines?: DiffLine[]
  include?: number[]
}

/**
 * A patch of just the picked lines of a file's diff vs HEAD: an added line left out isn't added,
 * a removed line left out stays. Hunks with nothing picked are dropped.
 */
export function partialPatch(path: string, lines: DiffLine[], include: Set<number>, isNew: boolean): string {
  const out = isNew ? [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`] : [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`]
  // A new file read straight from disk has no "@@" line: it's one hunk.
  const all = lines[0]?.kind === '@' ? lines : [{ kind: '@' as const, text: `@@ -0,0 +1,${lines.length} @@`, oldLine: null, newLine: null }, ...lines]
  let hunk: string[] = []
  let picked = false
  const flush = (): void => {
    if (picked) out.push(...hunk)
    hunk = []
    picked = false
  }
  all.forEach((l, k) => {
    // (Indexes are the caller's: the lines it was given.)
    const i = all === lines ? k : k - 1
    if (l.kind === '@') {
      flush()
      hunk.push(l.text.match(/^@@ [^@]+ @@/)?.[0] ?? l.text)
      return
    }
    const on = include.has(i)
    let row: string | null
    if (l.kind === ' ') row = ` ${l.text}`
    else if (l.kind === '+') row = on ? `+${l.text}` : null
    else row = on ? `-${l.text}` : ` ${l.text}`
    if (on && l.kind !== ' ') picked = true
    if (row == null) return
    hunk.push(row)
    if (l.noEol) hunk.push('\\ No newline at end of file')
  })
  flush()
  return out.join('\n') + '\n'
}

/**
 * Commits the picked files - whole, or only some of their lines - and nothing else. Built in a
 * index of its own (so what's staged in the real one stays as it is), then the real index is
 * brought up to date for those files. Hooks run as for any commit.
 */
export async function commitSelection(worktreePath: string, picks: CommitPick[], message: string): Promise<string> {
  if (!picks.length) throw new Error('No files picked.')
  if (!picks.some((p) => p.lines)) return commitFiles(worktreePath, picks.flatMap((p) => [p.path, ...(p.oldPath ? [p.oldPath] : [])]), message)
  const dir = await fs.mkdtemp(join(tmpdir(), 'sy-commit-'))
  const env = gitEnv({ GIT_INDEX_FILE: join(dir, 'index') })
  const run = (args: string[]): Promise<unknown> => execFileP('git', gitArgs(args), { cwd: worktreePath, windowsHide: true, env, maxBuffer: 16 * 1024 * 1024 })
  const paths = picks.flatMap((p) => [p.path, ...(p.oldPath ? [p.oldPath] : [])])
  try {
    await run(['read-tree', 'HEAD'])
    const whole = picks.filter((p) => !p.lines)
    if (whole.length) await run(['add', '-A', '--', ...whole.flatMap((p) => [p.path, ...(p.oldPath ? [p.oldPath] : [])])])
    for (const p of picks.filter((x) => x.lines)) {
      const inHead = await gitYes(worktreePath, ['cat-file', '-e', `HEAD:${p.path}`]).catch(() => false)
      const file = join(dir, 'pick.patch')
      await fs.writeFile(file, partialPatch(p.path, p.lines!, new Set(p.include ?? []), !inHead))
      await run(['apply', '--cached', '--recount', '--whitespace=nowarn', file]).catch((err: unknown) => {
        throw new Error(`${p.path} changed since its diff was read - refresh and pick its lines again. (${gitFailure(err, 'git apply failed')})`, { cause: err })
      })
    }
    try {
      await run(['commit', '--quiet', '-m', message])
    } catch (err) {
      throw new Error(gitFailure(err, 'git commit failed'), { cause: err })
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  // The real index: these files as they're now committed (what's left of them shows as uncommitted).
  await gitAt(worktreePath)
    .raw(['reset', '--quiet', '--', ...paths])
    .catch(() => {})
  return (await gitAt(worktreePath).revparse(['HEAD'])).trim()
}

/**
 * Takes one file back to how it is where the diff starts (the base, origin's copy, the last commit):
 * the task's changes to it are undone in the worktree, uncommitted, for the next commit.
 * A file the task added is deleted; one it moved comes back under its old name.
 */
export async function revertFile(worktreePath: string, baseBranch: string, scope: DiffScope, path: string, oldPath?: string): Promise<void> {
  const from = typeof scope === 'object' ? await parentOf(worktreePath, scope.commit) : await diffStart(worktreePath, baseBranch, scope)
  const git = gitAt(worktreePath)
  const was = oldPath ?? path
  const existed = await gitYes(worktreePath, ['cat-file', '-e', `${from}:${was}`]).catch(() => false)
  if (oldPath || !existed) {
    await git.raw(['rm', '--cached', '--force', '--quiet', '--ignore-unmatch', '--', path]).catch(() => {})
    await fs.rm(join(worktreePath, path), { force: true, recursive: true })
  }
  if (existed) {
    await git.raw(['checkout', from, '--', was])
    // (checkout stages it; leave it unstaged, like any other change in the worktree.)
    await git.raw(['reset', '--quiet', '--', was]).catch(() => {})
  }
}

/**
 * Undoes one hunk of a file's diff in the worktree (the diff ends at the worktree, so the hunk
 * is there to take out). `lines`: the hunk, its "@@" line first.
 */
export async function revertHunk(worktreePath: string, path: string, lines: DiffLine[], oldPath?: string): Promise<void> {
  if (lines[0]?.kind !== '@') throw new Error('Not a hunk.')
  const body: string[] = []
  for (const l of lines) {
    body.push(l.kind === '@' ? l.text : `${l.kind}${l.text}`)
    if (l.noEol) body.push('\\ No newline at end of file')
  }
  const patch = [`diff --git a/${oldPath ?? path} b/${path}`, `--- a/${oldPath ?? path}`, `+++ b/${path}`, ...body, ''].join('\n')
  const dir = await fs.mkdtemp(join(tmpdir(), 'sy-hunk-'))
  const file = join(dir, 'hunk.patch')
  try {
    await fs.writeFile(file, patch)
    // Onto the worktree only (no --index); --recount: the "@@" counts needn't be exact.
    await gitAt(worktreePath).raw(['apply', '-R', '--recount', '--whitespace=nowarn', file])
  } catch (err) {
    throw new Error(`The file changed since the diff was read - refresh and try again. (${gitFailure(err, 'git apply failed')})`, { cause: err })
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif' }

/**
 * An image in a diff, as a data URL: how it is now ('new': the worktree, or the commit), or where the
 * diff starts ('old'). Null when it isn't an image, isn't there on that side, or is too big to show.
 */
export async function diffImage(worktreePath: string, baseBranch: string, scope: DiffScope, path: string, side: 'old' | 'new', oldPath?: string): Promise<string | null> {
  const type = IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? '']
  if (!type) return null
  let buf: Buffer | null
  if (side === 'new' && typeof scope !== 'object') {
    buf = await fs.readFile(join(worktreePath, path)).catch(() => null)
  } else {
    const rev = typeof scope === 'object' ? (side === 'new' ? scope.commit : await parentOf(worktreePath, scope.commit)) : await diffStart(worktreePath, baseBranch, scope)
    buf = await execFileP('git', gitArgs(['show', `${rev}:${side === 'old' ? (oldPath ?? path) : path}`]), { cwd: worktreePath, windowsHide: true, env: gitEnv(), encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
      .then((r) => r.stdout as Buffer)
      .catch(() => null)
  }
  if (!buf || buf.length > 20 * 1024 * 1024) return null
  return `data:${type};base64,${buf.toString('base64')}`
}

export async function getWorktreeStatus(worktreePath: string, baseBranch: string): Promise<WorktreeStatus> {
  const git = gitAt(worktreePath)
  let ahead = 0
  let behind = 0
  try {
    const counts = await git.raw(['rev-list', '--left-right', '--count', `${await newestBase(worktreePath, baseBranch)}...HEAD`])
    const [b, a] = counts.trim().split(/\s+/).map(Number)
    behind = b || 0
    ahead = a || 0
  } catch {
    // baseBranch may not exist locally; leave at 0
  }
  const status = await git.status()
  const dirty = status.files.length
  let lastCommitAt = 0
  try {
    lastCommitAt = Number((await git.raw(['log', '-1', '--format=%ct'])).trim()) * 1000 || 0
  } catch {
    // no commits
  }
  return { ahead, behind, dirty, lastCommitAt }
}

export async function getLog(worktreePath: string, limit = 10): Promise<{ hash: string; message: string; date: string }[]> {
  const git = gitAt(worktreePath)
  const log = await git.log({ maxCount: limit })
  return log.all.map((c) => ({ hash: c.hash.slice(0, 7), message: c.message, date: c.date }))
}

/**
 * Where the task branch left the base branch. Diffing the working tree
 * against it shows everything the task changed - committed or not - in one
 * diff per file. Falls back to HEAD (uncommitted changes only) when the
 * base branch doesn't exist.
 */
async function forkPoint(worktreePath: string, baseBranch: string): Promise<string> {
  try {
    return (await gitAt(worktreePath).raw(['merge-base', await newestBase(worktreePath, baseBranch), 'HEAD'])).trim() || 'HEAD'
  } catch {
    return 'HEAD'
  }
}

/**
 * Where origin's copy of the checked-out branch is (its upstream, or origin/<branch>):
 * diffing against it shows what isn't pushed yet. Null when the branch was never pushed.
 */
async function pushedPoint(worktreePath: string): Promise<string | null> {
  const git = gitAt(worktreePath)
  const upstream = (await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')).trim()
  if (upstream) return upstream
  const branch = (await git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim()
  if (branch && (await gitYes(worktreePath, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]).catch(() => false))) return `origin/${branch}`
  return null
}

/** What a diff in this scope starts from (see DiffScope). A branch never pushed: everything since it left the base. */
async function diffStart(worktreePath: string, baseBranch: string, scope: DiffScope): Promise<string> {
  if (scope === 'uncommitted') return 'HEAD'
  if (scope === 'unpushed') {
    const pushed = await pushedPoint(worktreePath)
    if (pushed) return pushed
  }
  return forkPoint(worktreePath, baseBranch)
}

const MAX_DIFF_LINES = 20_000
/** A new file bigger than this isn't read for its diff (it's listed, with no lines). */
const MAX_TEXT_BYTES = 16 * 1024 * 1024

/**
 * A new file's text, or null when it isn't text (or is too big to show). UTF-16 with its
 * byte-order mark (what Windows PowerShell writes) is text too - its zero bytes aren't binary.
 */
function textOf(buf: Buffer): string | null {
  if (buf.length > MAX_TEXT_BYTES) return null
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const le = Buffer.from(buf.subarray(2, buf.length - (buf.length % 2)))
    le.swap16()
    return le.toString('utf16le')
  }
  // Git's test for binary: a zero byte near the start.
  if (buf.subarray(0, 8000).includes(0)) return null
  const text = buf.toString('utf-8')
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Git's empty tree: what a repository's first commit is compared with. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** A commit's parent, or the empty tree for a first commit. */
async function parentOf(worktreePath: string, sha: string): Promise<string> {
  const ok = await gitYes(worktreePath, ['rev-parse', '--verify', '--quiet', `${sha}^`]).catch(() => false)
  return ok ? `${sha}^` : EMPTY_TREE
}

/** `git diff`'s output, one FileDiff per file. */
function parseDiff(raw: string, uncommitted: (path: string) => boolean): FileDiff[] {
  const out: FileDiff[] = []
  for (const section of raw.split(/^(?=diff --git )/m)) {
    if (!section.startsWith('diff --git ')) continue
    const file = parseFileSection(section)
    if (file) out.push({ ...file, uncommitted: uncommitted(file.path) })
  }
  return out
}

export async function getDiffFiles(worktreePath: string, baseBranch: string, scope: DiffScope = 'branch', opts: DiffOptions = {}): Promise<FileDiff[]> {
  const git = gitAt(worktreePath)
  const space = opts.ignoreSpace ? ['-w'] : []
  // One commit: what it changed, nothing of the worktree's.
  if (typeof scope === 'object') {
    const sha = scope.commit
    const raw = await git.raw(['diff', '-M', ...space, '--no-color', '--no-ext-diff', await parentOf(worktreePath, sha), sha])
    return parseDiff(raw, () => false).sort((a, b) => a.path.localeCompare(b.path))
  }
  const from = await diffStart(worktreePath, baseBranch, scope)
  const status = await git.status()
  const uncommitted = new Set(status.files.map((f) => f.path.replace(/^"|"$/g, '')))
  for (const r of status.renamed) uncommitted.add(r.to)
  const results = new Map<string, FileDiff>()

  const raw = await git.raw(['diff', '-M', ...space, '--no-color', '--no-ext-diff', from])
  for (const file of parseDiff(raw, (p) => uncommitted.has(p))) results.set(file.path, file)

  // Untracked files: git diff won't show their content, so build a synthetic
  // all-additions diff from the file itself.
  for (const path of status.not_added) {
    try {
      const text = textOf(await fs.readFile(join(worktreePath, path)))
      if (text == null) {
        results.set(path, { path, status: 'added', added: 0, deleted: 0, lines: [], uncommitted: true })
        continue
      }
      const all = fileLines(text)
      const lines: DiffLine[] = all.slice(0, MAX_DIFF_LINES).map((line, i) => ({ kind: '+', text: line, oldLine: null, newLine: i + 1 }))
      results.set(path, { path, status: 'added', added: all.length, deleted: 0, lines, uncommitted: true, ...(all.length > MAX_DIFF_LINES ? { truncated: true } : {}) })
    } catch {
      results.set(path, { path, status: 'added', added: 0, deleted: 0, lines: [], uncommitted: true })
    }
  }

  return [...results.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** The changes from one commit to another, per file (checkpoints). `gitDir`: the repository's git folder. */
export async function diffFilesBetween(gitDir: string, from: string, to: string): Promise<FileDiff[]> {
  const { stdout } = await execFileP('git', gitArgs(['--git-dir', gitDir, 'diff', '--no-renames', '--no-color', '--no-ext-diff', from, to]), {
    windowsHide: true,
    env: gitEnv(),
    maxBuffer: 64 * 1024 * 1024
  })
  return parseDiff(stdout, () => false).sort((a, b) => a.path.localeCompare(b.path))
}

/** A text file's lines, as git counts them (a final newline doesn't start another). */
function fileLines(text: string): string[] {
  if (!text) return []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** One file's part of a `git diff` - its path, status and lines. */
export function parseFileSection(section: string): Omit<FileDiff, 'uncommitted'> | null {
  const header = section.slice(0, section.indexOf('\n@@') === -1 ? section.length : section.indexOf('\n@@'))
  const pick = (re: RegExp): string | null => header.match(re)?.[1] ?? null
  const plus = pick(/^\+\+\+ b\/(.+)$/m)
  const minus = pick(/^--- a\/(.+)$/m)
  const renamed = pick(/^rename to (.+)$/m)
  const renamedFrom = pick(/^rename from (.+)$/m)
  const fromGit = header.match(/^diff --git a\/(.+) b\/(.+)$/m)
  const path = plus ?? renamed ?? minus ?? fromGit?.[2] ?? null
  if (!path) return null
  const status: FileDiff['status'] = /^new file mode/m.test(header) ? 'added' : /^deleted file mode/m.test(header) ? 'deleted' : 'modified'
  const moved = renamedFrom && renamedFrom !== path ? { oldPath: renamedFrom } : {}
  if (/^Binary files /m.test(header)) return { path, status, added: 0, deleted: 0, lines: [], binary: true, ...moved }
  const lines = parseUnifiedDiff(section)
  const added = lines.filter((l) => l.kind === '+').length
  const deleted = lines.filter((l) => l.kind === '-').length
  if (lines.length > MAX_DIFF_LINES) return { path, status, added, deleted, lines: lines.slice(0, MAX_DIFF_LINES), truncated: true, ...moved }
  return { path, status, added, deleted, lines, ...moved }
}

export function parseUnifiedDiff(raw: string): DiffLine[] {
  const lines = raw.split('\n')
  const result: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  if (lines[lines.length - 1] === '') lines.pop()

  for (const line of lines) {
    if (!inHunk && !line.startsWith('@@')) continue
    inHunk = true
    // "\ No newline at end of file": about the line before it.
    if (line.startsWith('\\')) {
      const last = result[result.length - 1]
      if (last && last.kind !== '@') last.noEol = true
      continue
    }
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      result.push({ kind: '@', text: line, oldLine: null, newLine: null })
    } else if (line.startsWith('+')) {
      // (Inside a hunk a line is content whatever follows its marker: an
      // added "++i" or a removed "-- comment" are lines, not headers.)
      result.push({ kind: '+', text: line.slice(1), oldLine: null, newLine: newLine++ })
    } else if (line.startsWith('-')) {
      result.push({ kind: '-', text: line.slice(1), oldLine: oldLine++, newLine: null })
    } else {
      result.push({ kind: ' ', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
    }
  }

  return result
}

/**
 * Brings a task branch up to date with the base branch - by rebase or
 * merge, per Settings. On conflicts it backs out again, so the worktree is
 * never left half-way through, and says which files conflict.
 */
export async function rebaseOnto(worktreePath: string, baseBranch: string, keepConflicts = false): Promise<void> {
  const git = gitAt(worktreePath)
  const merge = getPrefs(worktreePath).syncMode === 'merge'
  // Onto origin's base when it's newer than the local one: up to date for real.
  const onto = await newestBase(worktreePath, baseBranch)
  try {
    // --autostash: uncommitted changes (an agent's work in progress) are put
    // aside for the sync and back after it, instead of stopping it.
    if (merge) await git.merge([onto, '--no-edit', '--autostash'])
    else await git.rebase(['--autostash', onto])
  } catch (err) {
    const conflicted = (await git.status()).conflicted
    // Kept to resolve (the Changes view's conflict editor): left half-way, as git leaves it.
    if (keepConflicts && conflicted.length) throw new Error(`CONFLICT:${conflicted.join('\n')}`, { cause: err })
    if (merge) await git.merge(['--abort']).catch(() => {})
    else await git.rebase(['--abort']).catch(() => {})
    if (conflicted.length === 0) throw err
    throw new Error(`CONFLICT:${conflicted.join('\n')}`, { cause: err })
  }
}

// ── A file's history ────────────────────────────────────────────────

/** The commits that changed a file, newest first (across moves). */
export async function fileHistory(worktreePath: string, path: string, limit = 200): Promise<FileCommit[]> {
  const raw = await gitAt(worktreePath)
    .raw(['log', '--follow', `-n${limit}`, '--format=%H%x1f%an%x1f%at%x1f%s', '--', path])
    .catch(() => '')
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, author, at, subject] = l.split('\x1f')
      return { hash, author, at: Number(at) * 1000, subject }
    })
}

/**
 * Who last changed each line of the file as it is in the worktree: per line, its commit's id
 * (all zeros for a line not committed yet), with each commit's author, time and subject.
 */
export async function blame(worktreePath: string, path: string): Promise<Blame> {
  const { stdout } = await execFileP('git', gitArgs(['blame', '--porcelain', '--', path]), { cwd: worktreePath, windowsHide: true, env: gitEnv(), maxBuffer: 64 * 1024 * 1024 })
  const commits: Blame['commits'] = {}
  const lines: string[] = []
  let cur = ''
  for (const row of stdout.split('\n')) {
    const head = row.match(/^([0-9a-f]{40}) \d+ (\d+)/)
    if (head) {
      cur = head[1]
      commits[cur] ??= { author: '', at: 0, subject: '' }
      continue
    }
    if (row.startsWith('\t')) {
      lines.push(cur)
      continue
    }
    const c = commits[cur]
    if (!c) continue
    if (row.startsWith('author ')) c.author = row.slice(7)
    else if (row.startsWith('author-time ')) c.at = Number(row.slice(12)) * 1000
    else if (row.startsWith('summary ')) c.subject = row.slice(8)
  }
  return { commits, lines }
}

// ── A merge or rebase stopped on conflicts ──────────────────────────

/** Whether a git-dir file exists (MERGE_HEAD, rebase-merge…), for the worktree. */
async function gitPathExists(worktreePath: string, name: string): Promise<string | null> {
  const p = (await gitAt(worktreePath).raw(['rev-parse', '--git-path', name]).catch(() => '')).trim()
  if (!p) return null
  const full = isAbsolute(p) ? p : join(worktreePath, p)
  return (await fs.stat(full).catch(() => null)) ? full : null
}

/**
 * What the worktree is in the middle of (a merge, rebase or cherry-pick git stopped), and its
 * conflicted files with how each conflicts. Null when it's in the middle of nothing.
 */
export async function syncState(worktreePath: string): Promise<SyncState | null> {
  const rebaseDir = (await gitPathExists(worktreePath, 'rebase-merge')) ?? (await gitPathExists(worktreePath, 'rebase-apply'))
  const op: SyncState['op'] | null = rebaseDir
    ? 'rebase'
    : (await gitPathExists(worktreePath, 'MERGE_HEAD'))
      ? 'merge'
      : (await gitPathExists(worktreePath, 'CHERRY_PICK_HEAD'))
        ? 'cherry-pick'
        : null
  if (!op) return null
  const read = (dir: string, f: string): Promise<string> => fs.readFile(join(dir, f), 'utf-8').then((s) => s.trim()).catch(() => '')
  let onto = ''
  let step: [number, number] | null = null
  let commit = ''
  if (rebaseDir) {
    const ontoSha = await read(rebaseDir, 'onto')
    // The branch name it's onto, when one points there.
    onto = ontoSha ? (await gitAt(worktreePath).raw(['name-rev', '--name-only', '--exclude=refs/tags/*', ontoSha]).catch(() => '')).trim().replace(/^remotes\//, '') || ontoSha.slice(0, 7) : ''
    const n = Number(await read(rebaseDir, 'msgnum')) || Number(await read(rebaseDir, 'next'))
    const total = Number(await read(rebaseDir, 'end')) || Number(await read(rebaseDir, 'last'))
    if (n && total) step = [n, total]
    const stopped = await read(rebaseDir, 'stopped-sha')
    if (stopped) commit = (await gitAt(worktreePath).raw(['log', '-1', '--format=%h %s', stopped]).catch(() => '')).trim()
  } else if (op === 'merge') {
    const msg = await fs.readFile((await gitPathExists(worktreePath, 'MERGE_MSG')) ?? '', 'utf-8').catch(() => '')
    onto = msg.match(/^Merge (?:remote-tracking )?branch '([^']+)'/m)?.[1] ?? ''
  }
  // Each unmerged file and how: both changed it, or one side deleted it.
  const files: SyncState['files'] = []
  const porcelain = await gitAt(worktreePath).raw(['status', '--porcelain=v1', '-z', '--untracked-files=no']).catch(() => '')
  for (const entry of porcelain.split('\0')) {
    const code = entry.slice(0, 2)
    if (!['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code)) continue
    // ("Us" is HEAD: in a rebase that's the base being rebased onto, in a merge this branch.)
    const kind: SyncState['files'][number]['kind'] = code === 'UU' || code === 'AA' ? 'both' : code === 'UD' || code === 'AU' ? 'deleted-theirs' : code === 'DU' || code === 'UA' ? 'deleted-ours' : 'both-deleted'
    files.push({ path: entry.slice(3), kind })
  }
  return { op, onto, step, commit, files }
}

/** One conflicted file settled: as it is now in the worktree (or deleted, when it's gone). */
export async function markResolved(worktreePath: string, path: string): Promise<void> {
  const exists = await fs.stat(join(worktreePath, path)).catch(() => null)
  if (exists) await gitAt(worktreePath).raw(['add', '--', path])
  else await gitAt(worktreePath).raw(['rm', '--quiet', '--cached', '--ignore-unmatch', '--', path])
}

/**
 * A conflicted file taken whole from one side and marked resolved. 'ours' / 'theirs' are git's
 * (HEAD / the other side) - the window says which is the task's.
 */
export async function takeSide(worktreePath: string, path: string, side: 'ours' | 'theirs'): Promise<void> {
  const git = gitAt(worktreePath)
  const ok = await git.raw(['checkout', `--${side}`, '--', path]).then(
    () => true,
    () => false
  )
  // That side deleted it: so does the resolution.
  if (!ok) {
    await git.raw(['rm', '--quiet', '--force', '--', path])
    return
  }
  await git.raw(['add', '--', path])
}

/** Goes on with the merge / rebase once its conflicts are resolved (a rebase may stop again on the next commit). */
export async function continueSync(worktreePath: string): Promise<SyncState | null> {
  const state = await syncState(worktreePath)
  if (!state) return null
  if (state.files.length) throw new Error(`Resolve ${state.files.length === 1 ? state.files[0].path : `the ${state.files.length} conflicted files`} first.`)
  // No editor: the commit messages stay as they are.
  const env = { GIT_EDITOR: 'true' }
  const args = state.op === 'rebase' ? ['rebase', '--continue'] : state.op === 'merge' ? ['merge', '--continue'] : ['cherry-pick', '--continue']
  try {
    await execFileP('git', gitArgs(['-c', 'core.editor=true', ...args]), { cwd: worktreePath, windowsHide: true, env: gitEnv(env), maxBuffer: 16 * 1024 * 1024 })
  } catch (err) {
    // Stopped again on conflicts (the next commit of a rebase): that's the new state.
    const next = await syncState(worktreePath)
    if (next?.files.length) return next
    // A commit the rebase had to make came out empty (the resolution dropped its changes): skip it.
    if (next?.op === 'rebase' && /nothing to commit|empty/i.test(String((err as { stderr?: unknown }).stderr ?? err))) {
      await execFileP('git', gitArgs(['rebase', '--skip']), { cwd: worktreePath, windowsHide: true, env: gitEnv(env) }).catch(() => {})
      return syncState(worktreePath)
    }
    throw new Error(gitFailure(err, `git ${args[0]} --continue failed`), { cause: err })
  }
  return syncState(worktreePath)
}

/** Gives up on the merge / rebase: the branch goes back to how it was before. */
export async function abortSync(worktreePath: string): Promise<void> {
  const state = await syncState(worktreePath)
  if (!state) return
  await gitAt(worktreePath).raw([state.op, '--abort'])
}

/** Changed files and lines vs the base branch, committed or not - without reading whole diffs. */
export async function getDiffStat(worktreePath: string, baseBranch: string): Promise<DiffStat> {
  const git = gitAt(worktreePath)
  const from = await forkPoint(worktreePath, baseBranch)
  const stat = { files: 0, added: 0, deleted: 0 }
  const numstat = await git.raw(['diff', '-M', '--numstat', from])
  for (const line of numstat.split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t/)
    if (!m) continue
    stat.files += 1
    stat.added += Number(m[1]) || 0
    stat.deleted += Number(m[2]) || 0
  }
  for (const path of (await git.status()).not_added) {
    stat.files += 1
    try {
      const text = textOf(await fs.readFile(join(worktreePath, path)))
      if (text != null) stat.added += fileLines(text).length
    } catch {
      // unreadable - still counts as a file
    }
  }
  return stat
}

// ── Push & pull requests ────────────────────────────────────────────

const execFileP = promisify(execFile)

/** The origin remote, and its web page when it's on GitHub. */
export async function remoteInfo(repoPath: string): Promise<RemoteInfo | null> {
  const remotes = await gitAt(repoPath).getRemotes(true).catch(() => [])
  const url = remotes.find((r) => r.name === 'origin')?.refs.push
  if (!url) return null
  const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/i)
  return { url, github: m ? `https://github.com/${m[1]}` : null }
}

async function gh(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileP('gh', args, { cwd: await existingDir(cwd), windowsHide: true, timeout: 60_000, maxBuffer: 32 * 1024 * 1024, env: gitEnv({ GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }) })
  return stdout.trim()
}

/**
 * `dir`, or the nearest folder above it that exists: a task's worktree may be
 * deleted outside Switchyard, and its pull request (asked about by URL) can
 * still be looked at, merged and finished with.
 */
async function existingDir(dir: string): Promise<string> {
  for (let d = dir; ; ) {
    if (await fs.stat(d).then((s) => s.isDirectory()).catch(() => false)) return d
    const up = dirname(d)
    if (up === d) return dir
    d = up
  }
}

let ghReady: { ok: boolean; at: number } | null = null
/** True when the GitHub CLI is installed and signed in (a "no" is asked again after a minute: you may install it meanwhile). */
export async function hasGh(): Promise<boolean> {
  if (ghReady && (ghReady.ok || Date.now() - ghReady.at < 60_000)) return ghReady.ok
  try {
    await gh(['auth', 'status'], process.cwd())
    ghReady = { ok: true, at: Date.now() }
  } catch {
    ghReady = { ok: false, at: Date.now() }
  }
  return ghReady.ok
}

/**
 * Pushes the task branch to origin (setting it as upstream). There's no
 * terminal to ask for credentials in; a credential manager can still show
 * its own sign-in window.
 */
export async function pushBranch(worktreePath: string, branch: string): Promise<void> {
  await gitAt(worktreePath, { network: true }).push(['-u', '--progress', 'origin', branch])
}

/**
 * Opens a pull request for the pushed branch. With the GitHub CLI signed in
 * it's created directly; otherwise this returns GitHub's compare page, where
 * the user finishes it in the browser.
 */
export async function createPr(worktreePath: string, repoPath: string, branch: string, baseBranch: string, title: string, body: string): Promise<PullRequest> {
  // The repository's own pull request template comes first; what Switchyard knows goes under it.
  const template = await prTemplate(worktreePath)
  if (template) body = body.trim() ? `${template.trim()}\n\n---\n\n${body}` : template
  const remote = await remoteInfo(repoPath)
  if (!remote?.github) throw new Error(`Pushed ${branch}, but origin isn't on GitHub - open the pull request from your Git host.`)
  if (await hasGh()) {
    try {
      const url = (await gh(['pr', 'create', '--head', branch, '--base', baseBranch, '--title', title, '--body', body], worktreePath)).split('\n').pop()!
      return { url, number: Number(url.match(/\/pull\/(\d+)/)?.[1]) || null, state: 'OPEN', created: true }
    } catch (err) {
      // One already exists for this branch - use it.
      const existing = await prStatus(worktreePath, branch)
      if (existing) return { ...existing, created: false }
      throw new Error(ghError(err), { cause: err })
    }
  }
  const url = `${remote.github}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branch)}?expand=1&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
  return { url, number: null, state: null, created: false }
}

/**
 * The repository's pull request template, where GitHub looks for one: the
 * root, .github/ or docs/ (any case), or the first of several in a
 * PULL_REQUEST_TEMPLATE folder. Null without one.
 */
export async function prTemplate(checkout: string): Promise<string | null> {
  const read = (p: string): Promise<string | null> => fs.readFile(p, 'utf-8').catch(() => null)
  for (const dir of ['.github', '', 'docs']) {
    const at = join(checkout, dir)
    const names = await fs.readdir(at).catch(() => [] as string[])
    const file = names.find((n) => n.toLowerCase() === 'pull_request_template.md')
    if (file) {
      const text = await read(join(at, file))
      if (text?.trim()) return text
    }
    const folder = names.find((n) => n.toLowerCase() === 'pull_request_template')
    if (folder) {
      const many = (await fs.readdir(join(at, folder)).catch(() => [] as string[])).filter((n) => n.toLowerCase().endsWith('.md')).sort()
      for (const n of many) {
        const text = await read(join(at, folder, n))
        if (text?.trim()) return text
      }
    }
  }
  return null
}

export type PrMergeMethod = 'squash' | 'merge' | 'rebase'

/** How the repository lets pull requests be merged (its GitHub settings); all three when it can't be asked. */
export async function prMergeMethods(cwd: string): Promise<PrMergeMethod[]> {
  try {
    const r = JSON.parse(await gh(['repo', 'view', '--json', 'squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed'], cwd)) as Record<string, boolean>
    const ok = (['squash', 'merge', 'rebase'] as const).filter((m) => r[m === 'squash' ? 'squashMergeAllowed' : m === 'merge' ? 'mergeCommitAllowed' : 'rebaseMergeAllowed'])
    return ok.length ? ok : ['squash', 'merge', 'rebase']
  } catch {
    return ['squash', 'merge', 'rebase']
  }
}

/**
 * Merges the pull request on GitHub. The branch on GitHub is left to the
 * repository's own setting (delete after merge); the local one goes when the
 * task finishes. Refusals (checks, reviews, conflicts) come back as GitHub says them.
 */
export async function mergePr(cwd: string, ref: string, method: PrMergeMethod): Promise<void> {
  if (!(await hasGh())) throw new Error('Merging on GitHub needs the GitHub CLI - install it and run `gh auth login`.')
  try {
    await gh(['pr', 'merge', ref, `--${method}`], cwd)
  } catch (err) {
    throw new Error(ghError(err), { cause: err })
  }
}

/**
 * A pull request opened for the task's branch by someone else - its agent, or
 * you on github.com: the newest one whose branch it is, opened `since` (the
 * task's start) or later - an older one would be another task's that had the
 * same branch name. Null without the GitHub CLI, or without one.
 */
export async function findPr(worktreePath: string, branch: string, since: number): Promise<PullRequest | null> {
  if (!(await hasGh())) return null
  try {
    const list = JSON.parse(await gh(['pr', 'list', '--head', branch, '--state', 'all', '--limit', '10', '--json', 'url,number,state,createdAt'], worktreePath)) as {
      url: string
      number: number
      state: PullRequest['state']
      createdAt: string
    }[]
    // (A minute's grace: the task's start and GitHub's clock.)
    const mine = list.filter((p) => Date.parse(p.createdAt) >= since - 60_000).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
    return mine ? { url: mine.url, number: mine.number, state: mine.state, created: false } : null
  } catch {
    return null
  }
}

/** The pull request for a branch (or URL), via the GitHub CLI; null without one. */
export async function prStatus(worktreePath: string, ref: string): Promise<PullRequest | null> {
  if (!(await hasGh())) return null
  try {
    const out = JSON.parse(await gh(['pr', 'view', ref, '--json', 'url,number,state'], worktreePath)) as { url: string; number: number; state: PullRequest['state'] }
    return { url: out.url, number: out.number, state: out.state, created: false }
  } catch {
    return null
  }
}

/**
 * The pull request with its CI checks, review decision and comments (the
 * review's text, conversation comments and comments on lines), via the
 * GitHub CLI; null without it or without a PR.
 */
export async function prDetails(worktreePath: string, ref: string): Promise<PrDetails | null> {
  if (!(await hasGh())) return null
  try {
    const pr = JSON.parse(await gh(['pr', 'view', ref, '--json', 'url,number,state,statusCheckRollup,reviewDecision,reviews,comments'], worktreePath))
    const lines = await gh(['api', `repos/{owner}/{repo}/pulls/${pr.number}/comments`, '--paginate'], worktreePath)
      .then((out) => JSON.parse(out || '[]'))
      .catch(() => [])
    return toPrDetails(pr, Array.isArray(lines) ? lines : [])
  } catch (err) {
    log.warn('git', `Could not read pull request ${ref}`, err)
    return null
  }
}

function ghError(err: unknown): string {
  const e = err as { stderr?: string; message?: string }
  return (e.stderr || e.message || String(err)).trim().split('\n').pop() ?? 'gh failed'
}

/** Open issues of the project's GitHub repository, via the GitHub CLI. */
export async function listIssues(repoPath: string): Promise<Issue[]> {
  const remote = await remoteInfo(repoPath)
  if (!remote?.github) throw new Error("This project's origin isn't on GitHub.")
  if (!(await hasGh())) throw new Error('Importing issues needs the GitHub CLI - install it and run `gh auth login`.')
  const out = await gh(['issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,body,url,labels'], repoPath)
  return (JSON.parse(out) as { number: number; title: string; body: string | null; url: string; labels: { name: string }[] }[]).map((i) => ({
    number: i.number,
    title: i.title,
    body: i.body ?? '',
    url: i.url,
    labels: i.labels.map((l) => l.name)
  }))
}

/** Commits on the task branch that origin doesn't have yet (all of them when never pushed). */
export async function unpushedCount(worktreePath: string, branch: string, baseBranch: string): Promise<number> {
  const git = gitAt(worktreePath)
  try {
    return Number((await git.raw(['rev-list', '--count', `origin/${branch}..HEAD`])).trim()) || 0
  } catch {
    try {
      // Never pushed - or deleted on origin after its PR was merged: what origin's base doesn't have.
      return Number((await git.raw(['rev-list', '--count', `origin/${baseBranch}..HEAD`]).catch(() => git.raw(['rev-list', '--count', `${baseBranch}..HEAD`]))).trim()) || 0
    } catch {
      return 0
    }
  }
}

/**
 * Commits in the worktree that exist nowhere else - not on origin's copy of
 * the branch, and not in the pull request. After a merge on GitHub the
 * branch is often deleted there (and a fetch --prune drops origin/<branch>),
 * and a squash or rebase merge leaves the base without these very commits:
 * so the PR's head commit is what counts, then origin's base branch - never
 * the local base, which hasn't seen the merge yet.
 */
async function unpublishedCount(worktreePath: string, branch: string, baseBranch: string, prRef?: string): Promise<number> {
  const git = gitAt(worktreePath)
  const count = async (range: string, paths: string[] = []): Promise<number | null> =>
    git
      .raw(['rev-list', '--count', range, ...(paths.length ? ['--', ...paths] : [])])
      .then((out) => Number(out.trim()) || 0)
      .catch(() => null)
  const onOrigin = await count(`origin/${branch}..HEAD`)
  if (onOrigin !== null) return onOrigin
  if (prRef && (await hasGh())) {
    const head = await gh(['pr', 'view', prRef, '--json', 'headRefOid'], worktreePath)
      .then((out) => (JSON.parse(out) as { headRefOid?: string }).headRefOid ?? null)
      .catch(() => null)
    if (head) {
      const after = await commitsAfter(worktreePath, head)
      if (after !== null) return after
    }
  }
  // Without GitHub to ask: origin's base, fresh. Every file the branch changed
  // reads the same there - it's merged (squashed or rebased: other commits).
  await withTimeout(gitAt(worktreePath, { network: true }).fetch('origin', baseBranch), 15_000).catch(() => {})
  const missing = await notIn(git, `origin/${baseBranch}`)
  if (missing && !missing.length) return 0
  // The commits behind the files that differ (a squash merge took the rest).
  if (missing) return (await count(`origin/${baseBranch}..HEAD`, missing)) || 1
  return (await count(`origin/${baseBranch}..HEAD`)) ?? (await count(`${baseBranch}..HEAD`)) ?? 0
}

/**
 * The worktree's commits that a pull request's head commit doesn't have: 0
 * when HEAD is that commit or behind it; null when it can't tell (the commit
 * isn't here - pushed from elsewhere).
 */
export async function commitsAfter(worktreePath: string, head: string): Promise<number | null> {
  // Its exit code is the answer - gitYes, not simple-git, which takes a silent "no" for a yes.
  if (await gitYes(worktreePath, ['merge-base', '--is-ancestor', 'HEAD', head]).catch(() => false)) return 0
  return gitAt(worktreePath)
    .raw(['rev-list', '--count', `${head}..HEAD`])
    .then((out) => Number(out.trim()) || 0)
    .catch(() => null)
}

/** The files HEAD changed (since it left `ref`'s history) that don't read the same in `ref`; null when it can't tell. */
async function notIn(git: ReturnType<typeof gitAt>, ref: string, head = 'HEAD'): Promise<string[] | null> {
  try {
    const base = (await git.raw(['merge-base', head, ref])).trim()
    const files = (await git.raw(['diff', '--name-only', '-z', base, head])).split('\0').filter(Boolean)
    if (!files.length) return []
    return (await git.raw(['diff', '--name-only', '-z', head, ref, '--', ...files])).split('\0').filter(Boolean)
  } catch {
    return null
  }
}

/**
 * Whether a task can close out through its pull request without losing
 * work: an error message when it can't (uncommitted changes, commits that
 * aren't anywhere else), null when it can. A worktree that's already gone
 * has nothing to lose.
 */
export async function closeCheck(worktreePath: string, branch: string, baseBranch: string, prRef?: string): Promise<string | null> {
  if (!(await isWorktree(worktreePath))) return null
  const dirty = (await gitAt(worktreePath).status()).files.length
  if (dirty > 0) return `The worktree has ${dirty} uncommitted change${dirty > 1 ? 's' : ''} - commit and push them, or discard them, first.`
  const unpushed = await unpublishedCount(worktreePath, branch, baseBranch, prRef)
  if (unpushed > 0) return `${unpushed} commit${unpushed > 1 ? "s aren't" : " isn't"} in the pull request - push ${unpushed > 1 ? 'them' : 'it'} first.`
  return null
}

/**
 * Closes out a task whose work lives on in a pull request: removes the
 * worktree (only when clean and everything is in the PR) and, once the PR
 * is merged, the local branch too.
 */
export async function closeWithPr(repoPath: string, worktreePath: string, branch: string, baseBranch: string, merged: boolean, prRef?: string): Promise<void> {
  const refused = await closeCheck(worktreePath, branch, baseBranch, prRef)
  if (refused) throw new Error(refused)
  await dropWorktree(repoPath, worktreePath)
  if (merged && getPrefs(repoPath).deleteBranchOnFinish !== false) await gitAt(repoPath).raw(['branch', '-D', branch]).catch(() => {})
}

/** A folder that's a git checkout (a worktree has a .git file). */
export async function isWorktree(path: string): Promise<boolean> {
  return fs
    .access(join(path, '.git'))
    .then(() => true)
    .catch(() => false)
}

/**
 * Removes a worktree that was checked to be safe to remove. On Windows a
 * process that just stopped can hold the folder a moment longer, so it's
 * tried again; a worktree already gone (or half-removed by an earlier try)
 * is cleaned up rather than failing on it.
 */
async function dropWorktree(repoPath: string, worktreePath: string): Promise<void> {
  const main = gitAt(repoPath)
  // Only a folder git knows as this repository's worktree is ever deleted.
  // (Compared as real folders: git reports /private/var for /var on macOS, long names for Windows' short ones.)
  const registered = (await listWorktrees(repoPath).catch(() => [])).some((w) => !w.isMain && samePath(w.path, worktreePath))
  if (!registered) {
    await main.raw(['worktree', 'prune']).catch(() => {})
    return
  }
  for (let i = 1; ; i++) {
    try {
      if (await isWorktree(worktreePath)) await main.raw(['worktree', 'remove', worktreePath, '--force'])
      break
    } catch (err) {
      if (!(await isWorktree(worktreePath))) break
      if (i >= 5) throw err
      await new Promise((r) => setTimeout(r, 400 * i))
    }
  }
  // What git left behind (a half-removed folder), and its record of the worktree.
  for (let i = 1; ; i++) {
    try {
      await fs.rm(worktreePath, { recursive: true, force: true })
      break
    } catch (err) {
      if (i >= 5) throw new Error(`The worktree is removed from git, but its folder is still in use: ${worktreePath}`, { cause: err })
      await new Promise((r) => setTimeout(r, 400 * i))
    }
  }
  await main.raw(['worktree', 'prune']).catch(() => {})
}

/**
 * Copies files git doesn't track (e.g. .env, config/master.key) from the
 * main checkout into a new worktree. Paths are relative to the repository;
 * "*" works in the last part ("config/*.key"). Missing files are skipped,
 * and nothing already in the worktree is overwritten. Resolves with what
 * was copied.
 */
export async function copyIntoWorktree(repoPath: string, worktreePath: string, paths: string[]): Promise<string[]> {
  const copied: string[] = []
  for (const raw of paths) {
    const rel = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!rel || rel.split('/').includes('..')) continue
    const parts = rel.split('/')
    const last = parts.pop()!
    const dir = parts.join('/')
    let names = [last]
    if (last.includes('*')) {
      const re = new RegExp('^' + last.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
      names = (await fs.readdir(join(repoPath, dir)).catch(() => [] as string[])).filter((n) => re.test(n))
    }
    for (const name of names) {
      const from = join(repoPath, dir, name)
      const to = join(worktreePath, dir, name)
      try {
        await fs.access(from)
      } catch {
        continue
      }
      try {
        await fs.access(to)
        continue // already there (tracked, or copied before)
      } catch {
        // not there yet
      }
      await fs.cp(from, to, { recursive: true, errorOnExist: false, force: false })
      copied.push(dir ? `${dir}/${name}` : name)
    }
  }
  return copied
}

// Ignored files worth giving every worktree: env files, keys, local configs.
const COPY_CANDIDATE = /(^|\/)(\.env(\.[\w.-]+)?|[\w.-]+\.key|master\.key|credentials\.json|\.npmrc|\.tool-versions|local\.settings\.json|application\.yml|database\.yml|secrets\.ya?ml)$/i
const NEVER = /(^|\/)(node_modules|vendor|tmp|log|logs|dist|build|out|coverage|\.git|\.worktrees|\.next|\.venv|venv|__pycache__)(\/|$)/

/** Files in the main checkout that git ignores and a worktree would likely need. */
export async function copySuggestions(repoPath: string): Promise<string[]> {
  try {
    const raw = await gitAt(repoPath).raw(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory'])
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.endsWith('/') && !NEVER.test(l) && COPY_CANDIDATE.test(l) && !/\.example$|\.sample$|\.template$/.test(l))
      .slice(0, 20)
  } catch {
    return []
  }
}
