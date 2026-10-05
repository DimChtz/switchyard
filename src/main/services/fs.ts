import { promises as fs } from 'fs'
import { basename, dirname, join, relative, resolve, sep } from 'path'
import { shell } from 'electron'
import { gitAt, gitArgs, gitEnv } from './gitEnv'
import { execFile } from 'child_process'
import type { FileEntry, CheckoutFiles, EditorConfigProps, FileDoc } from '@shared/types'
import { editorConfigFor, parseEditorConfig, type EditorConfigFile } from '@shared/editorconfig'
import { matchLines, pathFilter, replaceMatches, searchRegex, type FileMatches, type TextSearchOptions, type TextSearchResult } from '@shared/textSearch'

const IGNORE_DIRS = new Set(['.git', 'node_modules', '.worktrees', '.switchyard-worktrees', 'dist', 'out', 'build', '.next', '.venv'])
const MAX_FILES = 2000

async function gitStatusMap(root: string, baseBranch?: string): Promise<Map<string, 'added' | 'modified' | 'deleted'>> {
  const git = gitAt(root)
  const map = new Map<string, 'added' | 'modified' | 'deleted'>()

  if (baseBranch) {
    try {
      // -z: names exactly as they are (spaces, tabs), and a rename's two names apart.
      const parts = (await git.raw(['diff', '--name-status', '-z', `${baseBranch}...HEAD`])).split('\0')
      for (let i = 0; i < parts.length; i++) {
        const code = parts[i]
        if (!code) continue
        if (code.startsWith('R') || code.startsWith('C')) {
          map.set(parts[i + 2], code.startsWith('R') ? 'modified' : 'added')
          i += 2
          continue
        }
        const path = parts[++i]
        if (!path) continue
        map.set(path, code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified')
      }
    } catch {
      // base branch may not exist locally
    }
  }

  const status = await git.status()
  for (const f of status.created) map.set(f, 'added')
  for (const f of status.not_added) map.set(f, 'added')
  for (const f of status.modified) map.set(f, 'modified')
  for (const f of status.deleted) map.set(f, 'deleted')
  for (const r of status.renamed) map.set(r.to, 'modified')
  return map
}

/**
 * A task folder's repositories: the sub-folders that are git checkouts (a
 * worktree has a .git file). None when the folder is a checkout itself.
 */
export async function subRepos(root: string): Promise<string[]> {
  if (await exists(join(root, '.git'))) return []
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
    const repos = await Promise.all(dirs.map(async (d) => ((await exists(join(root, d, '.git'))) ? d : null)))
    return repos.filter((d): d is string => d !== null).sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

type StatusMap = Map<string, 'added' | 'modified' | 'deleted'>

/** git status (and changes since the base) of a checkout - or of each repository in a task folder, as "repo/path". */
async function statusOf(root: string, baseBranch?: string, bases?: Record<string, string>): Promise<StatusMap> {
  const subs = await subRepos(root)
  if (!subs.length) return gitStatusMap(root, baseBranch).catch((): StatusMap => new Map())
  const map: StatusMap = new Map()
  await Promise.all(
    subs.map(async (sub) => {
      const own = await gitStatusMap(join(root, sub), bases?.[sub] ?? baseBranch).catch((): StatusMap => new Map())
      for (const [path, st] of own) map.set(`${sub}/${path}`, st)
    })
  )
  return map
}

/**
 * The explorer's files: in a git checkout, what git lists - tracked files
 * and new ones it doesn't ignore, dotfiles (.github, .gitignore) and
 * committed build/ or dist/ folders included - plus ignored single files
 * such as .env, marked as ignored. A task folder: each repository's.
 * Anything else: a walk of the folder.
 */
export async function listFiles(root: string, baseBranch?: string, bases?: Record<string, string>): Promise<FileEntry[]> {
  const subs = await subRepos(root)
  const listed = subs.length
    ? await Promise.all(subs.map((sub) => gitFiles(join(root, sub), bases?.[sub] ?? baseBranch).then((l) => l && l.map((f) => ({ ...f, path: `${sub}/${f.path}` })))))
    : [await gitFiles(root, baseBranch)]
  if (listed.every((l) => l !== null)) {
    const files = (listed as FileEntry[][]).flat()
    const dirs = new Set<string>()
    for (const f of files) for (let i = f.path.indexOf('/'); i > 0; i = f.path.indexOf('/', i + 1)) dirs.add(f.path.slice(0, i))
    for (const sub of subs) dirs.add(sub)
    return [...[...dirs].map((d) => ({ path: d, isDir: true, status: 'unchanged' as const })), ...files]
  }
  return walkFiles(root, baseBranch, bases)
}

const MAX_TREE_FILES = 25_000

/** One checkout's files from git (see listFiles); null when it isn't one. */
async function gitFiles(root: string, baseBranch?: string): Promise<FileEntry[] | null> {
  const git = gitAt(root)
  let listed: string
  let ignored: string
  try {
    ;[listed, ignored] = await Promise.all([
      git.raw(['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
      // Ignored files, with wholly ignored folders (node_modules…) as one "dir/" entry - left out.
      git.raw(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory']).catch(() => '')
    ])
  } catch {
    return null
  }
  const statusMap = await gitStatusMap(root, baseBranch).catch((): StatusMap => new Map())
  const seen = new Set<string>()
  const out: FileEntry[] = []
  for (const path of listed.split('\0')) {
    if (!path || seen.has(path) || out.length >= MAX_TREE_FILES) continue
    seen.add(path)
    out.push({ path, isDir: false, status: statusMap.get(path) ?? 'unchanged' })
  }
  for (const path of ignored.split('\0')) {
    if (!path || path.endsWith('/') || seen.has(path) || out.length >= MAX_TREE_FILES) continue
    if (path.split('/').some((part) => IGNORE_DIRS.has(part))) continue
    out.push({ path, isDir: false, status: 'unchanged', ignored: true })
  }
  // Deleted files still show (they're changes to look at), changed ones the cap left out too.
  for (const [path, status] of statusMap) if (!seen.has(path) && !path.endsWith('/')) out.push({ path, isDir: false, status })
  return out
}

/** The folder walked (not a git checkout). */
async function walkFiles(root: string, baseBranch?: string, bases?: Record<string, string>): Promise<FileEntry[]> {
  const statusMap = await statusOf(root, baseBranch, bases)
  const results: FileEntry[] = []

  async function walk(dir: string): Promise<void> {
    if (results.length >= MAX_FILES) return
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= MAX_FILES) return
      if (entry.name.startsWith('.') && entry.name !== '.env') continue
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue
        const full = join(dir, entry.name)
        results.push({ path: relative(root, full).split(sep).join('/'), isDir: true, status: 'unchanged' })
        await walk(full)
      } else {
        const full = join(dir, entry.name)
        const rel = relative(root, full).split(sep).join('/')
        results.push({ path: rel, isDir: false, status: statusMap.get(rel) ?? 'unchanged' })
      }
    }
  }

  await walk(root)

  // Big repos hit MAX_FILES before the walk reaches everything - changed
  // files must still show (they're what "Changed only" is for), so add any
  // the walk missed, with their folders.
  if (results.length >= MAX_FILES) {
    const listed = new Set(results.map((r) => r.path))
    for (const [path, status] of statusMap) {
      if (status === 'deleted' || listed.has(path) || path.endsWith('/')) continue
      const parts = path.split('/')
      if (parts.some((p) => p.startsWith('.') && p !== '.env')) continue
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/')
        if (!listed.has(dir)) {
          listed.add(dir)
          results.push({ path: dir, isDir: true, status: 'unchanged' })
        }
      }
      listed.add(path)
      results.push({ path, isDir: false, status })
    }
  }
  return results
}

const MAX_SEARCH_FILES = 100_000

/**
 * Every file of a checkout for Go to file: what git tracks plus untracked
 * files it doesn't ignore (as VS Code lists them), and which have changes.
 * Not a git checkout: the explorer's walk.
 */
export async function listAllFiles(root: string): Promise<CheckoutFiles> {
  // A task folder: each repository's files, under its folder.
  const subs = await subRepos(root)
  if (subs.length) {
    const lists = await Promise.all(subs.map((sub) => listAllFiles(join(root, sub))))
    const files = lists.flatMap((l, i) => l.files.map((f) => `${subs[i]}/${f}`))
    return {
      files: files.slice(0, MAX_SEARCH_FILES),
      changed: lists.flatMap((l, i) => l.changed.map((f) => `${subs[i]}/${f}`)),
      truncated: files.length > MAX_SEARCH_FILES || lists.some((l) => l.truncated)
    }
  }
  const git = gitAt(root)
  let all: string
  let deleted: string
  let status: string
  try {
    ;[all, deleted, status] = await Promise.all([
      git.raw(['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
      git.raw(['ls-files', '-z', '--deleted']),
      git.raw(['status', '--porcelain', '-z', '--untracked-files=all'])
    ])
  } catch {
    const walked = await listFiles(root)
    const files = walked.filter((f) => !f.isDir).map((f) => f.path)
    return { files, changed: walked.filter((f) => !f.isDir && f.status !== 'unchanged').map((f) => f.path), truncated: files.length >= MAX_FILES }
  }
  const gone = new Set(deleted.split('\0').filter(Boolean))
  const files = [...new Set(all.split('\0'))].filter((f) => f && !gone.has(f))
  return { files: files.slice(0, MAX_SEARCH_FILES), changed: changedPaths(status), truncated: files.length > MAX_SEARCH_FILES }
}

/** Paths `git status --porcelain -z` reports as changed - not deleted ones, there's nothing to open. */
export function changedPaths(porcelain: string): string[] {
  const out: string[] = []
  const parts = porcelain.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    // A rename or copy is followed by the path it came from.
    if (code.includes('R') || code.includes('C')) i++
    if (code.includes('D')) continue
    out.push(entry.slice(3))
  }
  return out
}

export async function readFile(path: string): Promise<string> {
  const buf = await fs.readFile(path)
  if (buf.length > 2_000_000) return '(file too large to display)'
  return buf.toString('utf-8')
}

export async function writeFile(path: string, content: string): Promise<void> {
  await fs.writeFile(path, content, 'utf-8')
}

const EDITABLE_BYTES = 5_000_000

/**
 * A file as the editor opens it: its text with "\n" line ends, and how it
 * really ends its lines and whether it starts with a byte-order mark - so a
 * save writes it back the same way (a CRLF file stays CRLF). Binary and very
 * large files come back without text, to show rather than edit.
 */
export async function readDoc(path: string): Promise<FileDoc> {
  const st = await fs.stat(path)
  const base = { size: st.size, mtime: st.mtimeMs, eol: '\n' as const, bom: false }
  if (st.size > EDITABLE_BYTES) return { ...base, kind: 'large', text: '' }
  const buf = await fs.readFile(path)
  if (buf.subarray(0, 8000).includes(0)) return { ...base, kind: 'binary', text: '' }
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  const raw = buf.toString('utf-8', bom ? 3 : 0)
  const crlf = (raw.match(/\r\n/g) ?? []).length
  const lf = (raw.match(/\n/g) ?? []).length - crlf
  return { ...base, kind: 'text', bom, eol: crlf > lf ? '\r\n' : '\n', text: raw.replace(/\r\n/g, '\n') }
}

/**
 * Saves editor text with the file's line ends and byte-order mark. With
 * `expectMtime`, refuses (error "CHANGED_ON_DISK") when the file changed
 * since it was read - an agent's edit isn't silently written over.
 * Resolves with the new modified time.
 */
export async function writeDoc(path: string, text: string, o: { eol: '\n' | '\r\n'; bom: boolean; expectMtime?: number | null }): Promise<number> {
  if (o.expectMtime) {
    const now = await fs.stat(path).then((s) => s.mtimeMs, () => null)
    if (now !== null && Math.abs(now - o.expectMtime) > 1) throw new Error('CHANGED_ON_DISK')
  }
  const body = o.eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text
  await fs.writeFile(path, (o.bom ? '\ufeff' : '') + body, 'utf-8')
  return (await fs.stat(path)).mtimeMs
}

/** What the .editorconfig files above `path` say for it (nearest wins; stops at root = true). */
export async function editorConfig(path: string): Promise<EditorConfigProps> {
  const files: EditorConfigFile[] = []
  let dir = dirname(resolve(path))
  for (let i = 0; i < 64; i++) {
    const content = await fs.readFile(join(dir, '.editorconfig'), 'utf-8').catch(() => null)
    if (content !== null) {
      files.push({ dir: dir.split(sep).join('/'), content })
      if (parseEditorConfig(content).root) break
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return editorConfigFor(resolve(path).split(sep).join('/'), files)
}

export async function createEntry(path: string, isDir: boolean): Promise<void> {
  if (isDir) {
    await fs.mkdir(path, { recursive: true })
    return
  }
  await fs.mkdir(join(path, '..'), { recursive: true })
  await fs.writeFile(path, '', { flag: 'wx' })
}

/** Moves it to the system trash (restorable), as VS Code's explorer does. */
export async function deleteEntry(path: string): Promise<void> {
  await shell.trashItem(path)
}

export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
  // Only a change of case is the same file on Windows/macOS - allowed.
  const sameFile = resolve(oldPath).toLowerCase() === resolve(newPath).toLowerCase()
  if (!sameFile && (await exists(newPath))) throw new Error(`${basename(newPath)} already exists there`)
  await fs.mkdir(join(newPath, '..'), { recursive: true })
  await fs.rename(oldPath, newPath)
}

/**
 * Copies a file or folder into `destDir` and returns the new path. A name
 * that's taken becomes "name copy.ext", then "name copy 2.ext" (VS Code's way).
 */
export async function copyEntry(src: string, destDir: string): Promise<string> {
  const name = basename(src)
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  let dest = join(destDir, name)
  for (let i = 1; await exists(dest); i++) dest = join(destDir, `${stem} copy${i > 1 ? ` ${i}` : ''}${ext}`)
  await fs.cp(src, dest, { recursive: true, errorOnExist: true, force: false })
  return dest
}

/** Moves a file or folder into `destDir` (Cut → Paste); returns the new path. */
export async function moveEntry(src: string, destDir: string): Promise<string> {
  const dest = join(destDir, basename(src))
  if (resolve(dest) === resolve(src)) return src
  if (resolve(destDir).startsWith(resolve(src) + sep)) throw new Error("A folder can't be moved into itself")
  await renameEntry(src, dest)
  return dest
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/* ---------- search in files ---------- */

const MAX_RESULTS = 5000
const MAX_SEARCH_BYTES = 2_000_000

/**
 * Files git grep finds the query in (looser than the real match: no whole
 * word; the regex as PCRE). Null when it can't say - then every file is read.
 */
function grepCandidates(root: string, o: TextSearchOptions): Promise<Set<string> | null> {
  const args = ['grep', '-l', '-I', '-z', '--untracked', '--no-color', ...(o.caseSensitive ? [] : ['-i']), o.regex ? '-P' : '-F', '-e', o.query, '--']
  return new Promise((done) => {
    execFile('git', gitArgs(args), { cwd: root, env: gitEnv(), maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      // Exit code 1: found nowhere. Anything else (not a repository, no PCRE…): unknown.
      if (err) return done((err as { code?: number }).code === 1 ? new Set() : null)
      done(new Set(stdout.split('\0').filter(Boolean)))
    })
  })
}

/** grepCandidates for a checkout, or for each repository of a task folder (as "repo/path"). */
async function candidatesIn(root: string, o: TextSearchOptions): Promise<Set<string> | null> {
  const subs = await subRepos(root)
  if (!subs.length) return grepCandidates(root, o)
  const sets = await Promise.all(subs.map((sub) => grepCandidates(join(root, sub), o)))
  if (sets.some((x) => x === null)) return null
  return new Set(sets.flatMap((set, i) => [...set!].map((p) => `${subs[i]}/${p}`)))
}

/** Reads a text file for searching; null for a binary or very large one. */
async function readText(path: string): Promise<string | null> {
  try {
    const st = await fs.stat(path)
    if (!st.isFile() || st.size > MAX_SEARCH_BYTES) return null
    const buf = await fs.readFile(path)
    if (buf.subarray(0, 8000).includes(0)) return null
    return buf.toString('utf-8')
  } catch {
    return null
  }
}

/** The checkout's files whose names pass include/exclude and that may contain the query. */
async function searchablePaths(root: string, o: TextSearchOptions): Promise<string[]> {
  const [all, candidates] = await Promise.all([listAllFiles(root), candidatesIn(root, o)])
  const keep = pathFilter(o)
  return all.files.filter((p) => keep(p) && (!candidates || candidates.has(p))).sort((a, b) => a.localeCompare(b))
}

/** Search in files: every matching line of the checkout, file by file (up to MAX_RESULTS matches). */
export async function searchText(root: string, o: TextSearchOptions): Promise<TextSearchResult> {
  const { rx, error } = searchRegex(o)
  if (error) return { files: [], total: 0, truncated: false, error }
  if (!rx) return { files: [], total: 0, truncated: false }
  const files: FileMatches[] = []
  let total = 0
  for (const path of await searchablePaths(root, o)) {
    const text = await readText(join(root, path))
    if (text === null) continue
    const lines = matchLines(text, rx, MAX_RESULTS - total)
    if (!lines.length) continue
    const count = lines.reduce((n, l) => n + l.ranges.length, 0)
    files.push({ path, count, lines })
    total += count
    if (total >= MAX_RESULTS) return { files, total, truncated: true }
  }
  return { files, total, truncated: false }
}

/**
 * Replaces every match in these files of the checkout (worktree-relative)
 * and saves them; returns how many were replaced, in how many files.
 */
export async function replaceText(root: string, o: TextSearchOptions, replacement: string, paths: string[]): Promise<{ files: number; count: number }> {
  const { rx, error } = searchRegex(o)
  if (error) throw new Error(error)
  if (!rx) return { files: 0, count: 0 }
  const base = resolve(root)
  let files = 0
  let count = 0
  for (const rel of paths) {
    const full = resolve(base, rel)
    if (!full.startsWith(base + sep)) continue // only files of this checkout
    const text = await readText(full)
    if (text === null) continue
    const r = replaceMatches(text, rx, replacement, o.regex)
    if (!r.count) continue
    await fs.writeFile(full, r.text, 'utf-8')
    files++
    count += r.count
  }
  return { files, count }
}
