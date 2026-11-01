import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiskFree, LeftoverFolder, WorktreeSize } from '@shared/diskSpace'

/**
 * The worktrees' sizes, measured in the background two at a time (a big
 * node_modules takes a few seconds) - each shown as soon as it's known.
 */
export function useWorktreeSizes(paths: string[], refreshKey: number): { sizes: Record<string, WorktreeSize>; measuring: boolean; remeasure: (path?: string) => void } {
  const [sizes, setSizes] = useState<Record<string, WorktreeSize>>({})
  const [pending, setPending] = useState(0)
  // Measure again (all, or one): asked once, for the next run only.
  const [again, setAgain] = useState(0)
  const ask = useRef<{ path?: string } | null>(null)
  const run = useRef(0)
  const key = paths.join('\n')

  useEffect(() => {
    const id = ++run.current
    const asked = ask.current
    ask.current = null
    const todo = asked?.path ? paths.filter((p) => p === asked.path) : [...paths]
    const force = !!asked
    setPending(todo.length)
    const next = async (): Promise<void> => {
      for (let p = todo.shift(); p !== undefined && run.current === id; p = todo.shift()) {
        const path = p
        const s = await window.api.disk.measure(path, force).catch(() => null)
        if (run.current !== id) return
        if (s) setSizes((cur) => ({ ...cur, [path]: s }))
        setPending((n) => Math.max(0, n - 1))
      }
    }
    void Promise.all([next(), next()])
    // (Gone worktrees drop out.)
    setSizes((cur) => Object.fromEntries(Object.entries(cur).filter(([p]) => paths.includes(p))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey, again])

  const remeasure = useCallback((path?: string) => {
    ask.current = { path }
    setAgain((n) => n + 1)
  }, [])
  return { sizes, measuring: pending > 0, remeasure }
}

/** Folders left behind in the worktree homes, and the free room on the drives. */
export function useLeftovers(refreshKey: number): { leftovers: LeftoverFolder[]; free: DiskFree[] } {
  const [leftovers, setLeftovers] = useState<LeftoverFolder[]>([])
  const [free, setFree] = useState<DiskFree[]>([])
  useEffect(() => {
    let live = true
    window.api.disk
      .leftovers()
      .then((l) => live && setLeftovers(l))
      .catch(() => live && setLeftovers([]))
    window.api.disk
      .free()
      .then((f) => live && setFree(f))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [refreshKey])
  return { leftovers, free }
}
