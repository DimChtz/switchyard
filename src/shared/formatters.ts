/**
 * Format on save: which command formats a file. Rules are lines of
 * "patterns: command" - "*.rb, Gemfile: bundle exec rubocop -a {file}" -
 * where {file} is the file's path from the repository's top. Without rules
 * of your own, the repository's own formatter is used (see detect, in main).
 */

export interface FormatRule {
  patterns: string[]
  cmd: string
  /** A name for it in messages ("Prettier"), when detected. */
  name?: string
}

/** "*.rb, Gemfile: bundle exec rubocop -a {file}" lines → rules (blank lines and # comments skipped). */
export function parseFormatters(lines: string[]): FormatRule[] {
  const out: FormatRule[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const at = line.indexOf(': ')
    if (at <= 0) continue
    const patterns = splitPatterns(line.slice(0, at))
    const cmd = line.slice(at + 2).trim()
    if (patterns.length && cmd) out.push({ patterns, cmd })
  }
  return out
}

/** "*.{js,ts}, Gemfile" → ["*.{js,ts}", "Gemfile"] (commas inside braces kept). */
function splitPatterns(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '{') depth++
    if (ch === '}') depth = Math.max(0, depth - 1)
    if (ch === ',' && !depth) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** A glob as a regular expression: *, ?, ** and {a,b}. */
function globRe(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*'
      i++
      if (glob[i + 1] === '/') i++
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '{') re += '(?:'
    else if (c === '}') re += ')'
    else if (c === ',' && re.includes('(?:')) re += '|'
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

/** The rule for a file (its path from the repository's top): a pattern without "/" is matched against its name. */
export function ruleFor(rules: FormatRule[], rel: string): FormatRule | null {
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  return rules.find((r) => r.patterns.some((p) => globRe(p.replace(/^\.?\//, '')).test(p.includes('/') ? rel : name))) ?? null
}

/** The command for a file, its path put in (quoted for the shell). */
export function commandFor(rule: FormatRule, rel: string, windows: boolean): string {
  const quoted = windows ? `"${rel.replace(/"/g, '')}"` : `'${rel.replace(/'/g, `'\\''`)}'`
  return rule.cmd.includes('{file}') ? rule.cmd.split('{file}').join(quoted) : `${rule.cmd} ${quoted}`
}

/** What a repository has, for picking its formatter (see detect). */
export interface RepoSigns {
  /** Files at its top that exist. */
  files: Set<string>
  /** package.json's dependencies and devDependencies. */
  npm: Set<string>
  gemfile: string
  pyproject: string
}

const JS = '*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,css,scss,less,json,jsonc,md,mdx,yml,yaml,html,vue,svelte,graphql}'

/** The repository's own formatters, from what it has - Biome or Prettier, RuboCop, gofmt, ruff or black, rustfmt, mix format. */
export function detectFormatters(s: RepoSigns): FormatRule[] {
  const has = (f: string): boolean => s.files.has(f)
  const out: FormatRule[] = []
  const npx = (bin: string): string => `npx --no-install ${bin}`
  if (has('biome.json') || has('biome.jsonc') || s.npm.has('@biomejs/biome')) out.push({ name: 'Biome', patterns: ['*.{js,jsx,ts,tsx,mjs,cjs,json,jsonc,css}'], cmd: `${npx('biome')} format --write {file}` })
  if (s.npm.has('prettier') || [...s.files].some((f) => /^(\.prettierrc(\..+)?|prettier\.config\..+)$/.test(f))) out.push({ name: 'Prettier', patterns: [JS], cmd: `${npx('prettier')} --write {file}` })
  if (has('.rubocop.yml') || /\brubocop\b/.test(s.gemfile))
    out.push({ name: 'RuboCop', patterns: ['*.{rb,rake,ru,gemspec}', 'Gemfile', 'Rakefile'], cmd: `${has('Gemfile') ? 'bundle exec ' : ''}rubocop -a --fail-level fatal {file}` })
  if (has('go.mod')) out.push({ name: 'gofmt', patterns: ['*.go'], cmd: 'gofmt -w {file}' })
  if (/\[tool\.ruff/.test(s.pyproject) || has('ruff.toml') || has('.ruff.toml')) out.push({ name: 'Ruff', patterns: ['*.py', '*.pyi'], cmd: 'ruff format {file}' })
  else if (/\[tool\.black\]/.test(s.pyproject)) out.push({ name: 'Black', patterns: ['*.py', '*.pyi'], cmd: 'black -q {file}' })
  if (has('Cargo.toml')) out.push({ name: 'rustfmt', patterns: ['*.rs'], cmd: 'rustfmt {file}' })
  if (has('mix.exs')) out.push({ name: 'mix format', patterns: ['*.{ex,exs,heex}'], cmd: 'mix format {file}' })
  return out
}

/** A rule as a line again ("*.rb, Gemfile: …"), to show or copy into settings. */
export const ruleLine = (r: FormatRule): string => `${r.patterns.join(', ')}: ${r.cmd}`
