import { gitAt } from './gitEnv'
import { existsSync, promises as fs, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { detectProjectMeta } from './projectMeta'
import { getProjects, getPrefs } from './store'
import type { BrowseEntry, BrowsePlace, RepoScan } from '@shared/types'

/** "~/code/x" → absolute path. */
export function expandPath(p: string): string {
  const t = p.trim().replace(/^["']|["']$/g, '')
  if (t === '~') return homedir()
  if (t.startsWith('~/') || t.startsWith('~\\')) return join(homedir(), t.slice(2))
  return isAbsolute(t) ? resolve(t) : resolve(homedir(), t)
}

const URL_RE = /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)|^(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)\//i

export function isGitUrl(s: string): boolean {
  return URL_RE.test(s.trim())
}

/** "github.com/org/repo" → a URL git can clone. */
function cloneUrl(s: string): string {
  const t = s.trim()
  return /^(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)\//i.test(t) ? `https://${t.replace(/\.git$/, '')}.git` : t
}

export function repoNameFromUrl(s: string): string {
  return (s.trim().replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop() || 'repo').replace(/[^a-zA-Z0-9._-]/g, '-')
}

/** Folders the user keeps repositories in: next to existing projects, plus the usual spots. */
function codeDirs(): string[] {
  const home = homedir()
  const parents = getProjects().map((p) => dirname(p.repoPath))
  const common = ['code', 'dev', 'projects', 'src', 'repos', 'git', join('source', 'repos')].map((d) => join(home, d))
  return [...new Set([...parents, ...common])].filter((d) => isDir(d))
}

export function defaultCloneDir(): string {
  const pref = getPrefs().cloneDir
  if (pref) return expandPath(pref)
  const parents = getProjects().map((p) => dirname(p.repoPath))
  if (parents.length) {
    // The folder most projects live in.
    const counts = new Map<string, number>()
    for (const p of parents) counts.set(p, (counts.get(p) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }
  return codeDirs()[0] ?? homedir()
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Checked-out branch of a repository, read straight from .git/HEAD (fast, for listings). */
function gitBranch(dir: string): string | null {
  const dotGit = join(dir, '.git')
  try {
    let gitDir = dotGit
    if (!statSync(dotGit).isDirectory()) {
      // Worktrees and submodules: ".git" is a file pointing at the real one.
      const m = readFileSync(dotGit, 'utf-8').match(/gitdir:\s*(.+)/)
      if (!m) return null
      gitDir = resolve(dir, m[1].trim())
    }
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf-8').trim()
    const m = head.match(/^ref: refs\/heads\/(.+)$/)
    return m ? m[1] : head.slice(0, 7)
  } catch {
    return null
  }
}

async function countEntries(dir: string): Promise<number | null> {
  try {
    return (await fs.readdir(dir)).length
  } catch {
    return null
  }
}

export async function browse(dir: string): Promise<BrowseEntry[]> {
  const abs = expandPath(dir)
  const dirents = await fs.readdir(abs, { withFileTypes: true })
  const entries = await Promise.all(
    dirents.map(async (d): Promise<BrowseEntry | null> => {
      const path = join(abs, d.name)
      let isDirectory = d.isDirectory()
      if (d.isSymbolicLink()) isDirectory = isDir(path)
      if (!isDirectory && !d.isFile()) return null
      if (!isDirectory) return { name: d.name, path, isDir: false, git: null, items: null }
      const git = gitBranch(path)
      return { name: d.name, path, isDir: true, git, items: git ? null : await countEntries(path) }
    })
  )
  return entries.filter((e): e is BrowseEntry => e !== null)
}

export function places(): BrowsePlace[] {
  const home = homedir()
  const list: BrowsePlace[] = [{ label: 'Home', path: home }]
  for (const d of codeDirs()) list.push({ label: basename(d), path: d })
  for (const d of ['Desktop', 'Documents', 'Downloads']) {
    const p = join(home, d)
    if (isDir(p)) list.push({ label: d, path: p })
  }
  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJ') {
      const p = `${letter}:\\`
      if (isDir(p)) list.push({ label: `${letter}:`, path: p })
    }
  }
  const seen = new Set<string>()
  return list.filter((p) => (seen.has(p.path.toLowerCase()) ? false : (seen.add(p.path.toLowerCase()), true)))
}

/** Git repositories in the user's code folders that aren't projects yet, most recently used first. */
export async function recentRepos(limit = 4): Promise<string[]> {
  const added = new Set(getProjects().map((p) => resolve(p.repoPath).toLowerCase()))
  const found: { path: string; at: number }[] = []
  for (const dir of codeDirs()) {
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const path = join(dir, name)
      if (added.has(path.toLowerCase())) continue
      try {
        const st = await fs.stat(join(path, '.git'))
        // .git/index changes on every checkout, commit and add.
        const idx = await fs.stat(join(path, '.git', 'index')).catch(() => st)
        found.push({ path, at: idx.mtimeMs })
      } catch {
        // not a repository
      }
    }
  }
  return found
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((f) => f.path)
}

/** The branch worktrees should start from: the remote's default, else the checked-out one. */
export async function defaultBranchOf(repoPath: string): Promise<{ branch: string; src: string }> {
  const git = gitAt(repoPath)
  try {
    const ref = (await git.raw(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])).trim()
    if (ref) return { branch: ref.replace(/^refs\/remotes\/origin\//, ''), src: 'origin/HEAD' }
  } catch {
    // no remote HEAD recorded
  }
  try {
    const current = (await git.raw(['branch', '--show-current'])).trim()
    if (current) return { branch: current, src: 'checked-out branch' }
  } catch {
    // not a repository yet
  }
  return { branch: 'main', src: 'default' }
}

async function remoteName(repoPath: string): Promise<string> {
  try {
    const remotes = await gitAt(repoPath).getRemotes(true)
    const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0]
    const m = origin?.refs?.fetch?.match(/[/:]([^/:]+\/[^/]+?)(\.git)?$/)
    if (m) return m[1]
  } catch {
    // no remotes
  }
  return basename(repoPath)
}

export async function scan(path: string): Promise<RepoScan> {
  const abs = expandPath(path)
  if (!isDir(abs)) throw new Error(`${path} is not a folder`)
  const isGit = existsSync(join(abs, '.git'))
  if (!isGit) {
    return { path: abs, isGit, repo: basename(abs), defaultBranch: 'main', branchSrc: 'git init', meta: detectProjectMeta(abs) }
  }
  const root = (await gitAt(abs).revparse(['--show-toplevel'])).trim()
  const top = resolve(root)
  const [repo, branch] = await Promise.all([remoteName(top), defaultBranchOf(top)])
  return { path: top, isGit, repo, defaultBranch: branch.branch, branchSrc: branch.src, meta: detectProjectMeta(top) }
}

/** Clones a Git URL into the clone folder; resolves with the new checkout's path. */
export async function clone(url: string): Promise<string> {
  const dest = join(defaultCloneDir(), repoNameFromUrl(url))
  if (existsSync(dest)) {
    if (existsSync(join(dest, '.git'))) return dest
    throw new Error(`${dest} already exists and isn't a git repository`)
  }
  await fs.mkdir(dirname(dest), { recursive: true })
  // --progress: git keeps reporting, so the no-progress timeout only stops a clone that's really stuck.
  await gitAt(dirname(dest), { network: true }).clone(cloneUrl(url), dest, ['--progress'])
  return dest
}

/**
 * Turns a plain folder into a repository worktrees can branch from: git
 * init plus an empty first commit (worktrees need a commit to start at).
 */
export async function initRepo(path: string, branch: string): Promise<void> {
  const git = gitAt(path)
  await git.raw(['init', '-b', branch])
  await git.raw(['commit', '--allow-empty', '-m', 'Initial commit'])
}

/** The user's name from git config, for the sidebar. */
export async function gitUserName(): Promise<string | null> {
  try {
    return (await gitAt(homedir()).raw(['config', '--global', 'user.name'])).trim() || null
  } catch {
    return null
  }
}
