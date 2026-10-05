/** What the explorer's rows carry when dragged: their absolute paths, as JSON. */
export const FILE_DRAG_TYPE = 'application/x-switchyard-files'

/** How a shell wants a path written. */
export type PathStyle = 'win' | 'posix' | 'msys' | 'wsl'

/** The style for a terminal's program (a profile's path or id, or the default shell's) on this platform. */
export function pathStyleFor(program: string | undefined, platform: string): PathStyle {
  if (platform !== 'win32') return 'posix'
  const p = (program ?? '').toLowerCase()
  if (/(^|[\\/:])wsl(\.exe)?($|:)/.test(p) || p.startsWith('wsl')) return 'wsl'
  if (/bash|zsh|fish|(^|[\\/])sh(\.exe)?$/.test(p)) return 'msys'
  return 'win'
}

const isWinAbs = (p: string): boolean => /^[a-zA-Z]:[\\/]/.test(p)

/** `path` relative to `dir` when it's inside it (or is it), else null. */
function inside(path: string, dir: string, win: boolean): string | null {
  const norm = (s: string): string => s.replace(/\\/g, '/').replace(/\/+$/, '')
  const p = norm(path)
  const d = norm(dir)
  if (!d) return null
  const same = win ? (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase() : (a: string, b: string): boolean => a === b
  if (same(p, d)) return '.'
  if (p.length > d.length && same(p.slice(0, d.length + 1), `${d}/`)) return p.slice(d.length + 1)
  return null
}

function quote(p: string, style: PathStyle): string {
  if (style === 'win') return /[\s&()[\]{}^=;!'+,`~$#@%]/.test(p) ? `"${p}"` : p
  return /^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`
}

/**
 * Dropped files as text for a terminal: relative when inside its folder
 * (where its shell or agent works), else absolute - written and quoted the
 * way its shell reads them; several are separated by spaces, with one after.
 */
export function pathsForTerminal(paths: string[], cwd: string, style: PathStyle): string {
  const win = isWinAbs(cwd) || paths.some(isWinAbs)
  const out = paths.map((abs) => {
    const rel = inside(abs, cwd, win)
    let p = rel ?? abs
    if (style === 'win') p = p.replace(/\//g, '\\')
    else {
      p = p.replace(/\\/g, '/')
      if (!rel && isWinAbs(p)) {
        const drive = p[0].toLowerCase()
        p = style === 'wsl' ? `/mnt/${drive}${p.slice(2)}` : style === 'msys' ? `/${drive}${p.slice(2)}` : p
      }
    }
    return quote(p, style)
  })
  return out.length ? `${out.join(' ')} ` : ''
}
