/** This platform's path separator. */
export const SEP = window.electron.process.platform === 'win32' ? '\\' : '/'

/**
 * A worktree-relative path ("src/app.ts") as the system writes it, under
 * `root` - git may give Windows paths with "/", the shell wants "\".
 */
export function nativePath(root: string, rel = ''): string {
  return [...root.split(/[\\/]/), ...(rel ? rel.split('/') : [])].join(SEP)
}
