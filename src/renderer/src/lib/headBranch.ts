import { useEffect, useState } from 'react'

const same = (a: string, b: string): boolean => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** What's checked out in a checkout of `repoPath` ('' when detached or not known yet). */
export async function headBranch(repoPath: string, checkout = repoPath): Promise<string> {
  const all = await window.api.git.listWorktrees(repoPath).catch(() => [])
  const w = all.find((x) => same(x.path, checkout)) ?? all.find((x) => x.isMain)
  return w?.branch ?? ''
}

/**
 * The branch checked out in the project's own folder - for a task that works
 * there (it's whatever you switched to). Read again when the window comes back
 * to front, and when `tick` changes.
 */
export function useHeadBranch(repoPath: string | null | undefined, tick?: unknown): string {
  const [branch, setBranch] = useState('')
  useEffect(() => {
    if (!repoPath) return setBranch('')
    let cancelled = false
    const read = (): void => void headBranch(repoPath).then((b) => !cancelled && setBranch(b))
    read()
    window.addEventListener('focus', read)
    return () => {
      cancelled = true
      window.removeEventListener('focus', read)
    }
  }, [repoPath, tick])
  return branch
}
