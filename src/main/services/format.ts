import { exec } from 'child_process'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { dirname, join, relative, sep } from 'path'
import { gitAt } from './gitEnv'
import { commandFor, detectFormatters, parseFormatters, ruleFor, type FormatRule } from '@shared/formatters'

/**
 * Format on save (Settings → File editor): the file's formatter run on it,
 * in its repository - your rules when you set some, the repository's own
 * formatter otherwise (Prettier, RuboCop…, see detectFormatters).
 */

/** The repository a file is in (its top folder), or the file's folder when it isn't in one. */
async function repoOf(file: string): Promise<string> {
  const dir = dirname(file)
  return (await gitAt(dir).revparse(['--show-toplevel']).catch(() => '')).trim() || dir
}

/** What the repository has, read for picking its formatter. */
function signsOf(root: string): Parameters<typeof detectFormatters>[0] {
  const read = (f: string): string => {
    try {
      return readFileSync(join(root, f), 'utf8')
    } catch {
      return ''
    }
  }
  let files: string[] = []
  try {
    files = readdirSync(root)
  } catch {
    // (none)
  }
  let npm = new Set<string>()
  try {
    const pkg = JSON.parse(read('package.json') || '{}') as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    npm = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])
  } catch {
    // not JSON
  }
  return { files: new Set(files), npm, gemfile: existsSync(join(root, 'Gemfile')) ? read('Gemfile') : '', pyproject: read('pyproject.toml') }
}

/** The formatters that apply in a file's repository: yours (`lines`), else the ones it has. */
export async function formattersFor(file: string, lines: string[]): Promise<{ root: string; rules: FormatRule[]; detected: boolean }> {
  const root = await repoOf(file)
  const mine = parseFormatters(lines)
  return mine.length ? { root, rules: mine, detected: false } : { root, rules: detectFormatters(signsOf(root)), detected: true }
}

/**
 * Formats a saved file. `ran`: whether a formatter applies to it (and which);
 * an error with what the formatter said when it failed.
 */
export async function formatFile(file: string, lines: string[]): Promise<{ ran: boolean; name: string | null }> {
  const { root, rules } = await formattersFor(file, lines)
  const rel = relative(root, file).split(sep).join('/')
  const rule = ruleFor(rules, rel)
  if (!rule) return { ran: false, name: null }
  const cmd = commandFor(rule, rel, process.platform === 'win32')
  await new Promise<void>((resolve, reject) => {
    exec(cmd, { cwd: root, timeout: 30_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' } }, (err, stdout, stderr) => {
      if (!err) return resolve()
      const said = `${stderr}\n${stdout}`
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-12)
        .join('\n')
      const why = (err as { killed?: boolean }).killed ? 'it took longer than 30 seconds' : said || err.message
      reject(new Error(`${rule.name ?? cmd.split(' ')[0]} couldn't format ${rel}: ${why}\n\n(${cmd})`))
    })
  })
  return { ran: true, name: rule.name ?? rule.cmd.split(/\s+/).filter((w) => !/^(npx|bundle|exec|--no-install)$/.test(w))[0] ?? null }
}
