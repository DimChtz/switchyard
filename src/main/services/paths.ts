import { realpathSync } from 'fs'
import { basename, dirname, resolve } from 'path'

/**
 * A path as the file system has it, for comparing: the real folder (macOS's
 * /var is /private/var; Windows' short RUNNER~1 names are the long ones),
 * one kind of slash, no trailing one, any case. Git reports the real one, a
 * task or a temp folder may hold the other - compared as written they'd
 * never match. A path that doesn't exist (yet, or any more) is resolved as
 * far as it does.
 */
export function canonical(p: string): string {
  return real(resolve(p)).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function real(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    const parent = dirname(p)
    return parent === p ? p : `${real(parent)}/${basename(p)}`
  }
}

/** The real folder of `p` (see canonical), as the system writes it. */
export function realFolder(p: string): string {
  return real(resolve(p))
}

export function samePath(a: string, b: string): boolean {
  return canonical(a) === canonical(b)
}

/** `p` is `dir` or inside it. */
export function isInside(p: string, dir: string): boolean {
  const a = canonical(p)
  const d = canonical(dir)
  return a === d || a.startsWith(d + '/')
}
