import { useEffect, useState } from 'react'
import type { DiffStat, Project, Task } from '@shared/types'
import type { WorktreeRow } from './derive'
import { checkoutsOf, inProject } from './multiRepo'
import { baseOf } from './stack'

export function useRealWorktrees(projects: Project[], tasks: Task[], refreshKey: number): { data: WorktreeRow[]; loading: boolean } {
  const [data, setData] = useState<WorktreeRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const gitProjects = projects.filter((p) => p.repoPath)
    if (gitProjects.length === 0) {
      setData([])
      return
    }

    let cancelled = false
    setLoading(true)

    Promise.all(
      gitProjects.map(async (project) => {
        try {
          const [info, worktrees] = await Promise.all([
            window.api.git.repoInfo(project.repoPath),
            window.api.git.listWorktrees(project.repoPath)
          ])
          const nonMain = worktrees.filter((w) => !w.isMain)
          const withStatus = await Promise.all(
            nonMain.map(async (w) => {
              // A task in several repositories has a worktree of this one too.
              const task = tasks.find((t) => inProject(t, project.id) && t.branch === w.branch && t.col !== 'done')
              // (A task building on another compares with that one's branch.)
              const base = task?.buildsOn ? baseOf(task, project) : (project.defaultBranch ?? info.defaultBranch)
              const status = await window.api.git.worktreeStatus(w.path, base).catch(() => ({
                ahead: 0,
                behind: 0,
                dirty: 0,
                lastCommitAt: 0
              }))
              const result: WorktreeRow = {
                id: `${project.id}:${w.path}`,
                projectId: project.id,
                branch: w.branch || w.headSha.slice(0, 7),
                path: w.path,
                taskId: task?.id ?? null,
                ahead: status.ahead,
                behind: status.behind,
                dirty: status.dirty,
                lastActivityAt: task?.lastActivityAt ?? (status.lastCommitAt || Date.now()),
                lastCommitAt: status.lastCommitAt,
                base
              }
              return result
            })
          )
          return withStatus
        } catch {
          return [] as WorktreeRow[]
        }
      })
    ).then((groups) => {
      if (!cancelled) {
        setData(groups.flat())
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, refreshKey])

  return { data, loading }
}

/**
 * Real added/deleted/changed-file counts for every active task backed by a
 * real repo + worktree, keyed by task id - replaces the board card's
 * fabricated `worktree.dirty * 12` / `* 3` math with actual git diff totals.
 */
export function useRealDiffStats(tasks: Task[], projects: Project[]): Record<string, DiffStat> {
  const [data, setData] = useState<Record<string, DiffStat>>({})

  const real = tasks.filter((t) => t.worktreePath && t.col !== 'done' && projects.find((p) => p.id === t.projectId)?.repoPath)
  const key = real.map((t) => `${t.id}:${t.worktreePath}:${(t.repos ?? []).join(',')}`).join('|')

  useEffect(() => {
    if (real.length === 0) {
      setData({})
      return
    }
    let cancelled = false

    Promise.all(
      real.map(async (t) => {
        try {
          // A task in several repositories: the totals of all of them.
          const stats = await Promise.all(checkoutsOf(t, projects).filter((c) => c.path).map((c) => window.api.git.diffStat(c.path!, baseOf(t, c.project))))
          if (!stats.length) return null
          const sum: DiffStat = stats.reduce((a, b) => ({ files: a.files + b.files, added: a.added + b.added, deleted: a.deleted + b.deleted }))
          return [t.id, sum] as const
        } catch {
          return null
        }
      })
    ).then((pairs) => {
      if (cancelled) return
      const map: Record<string, DiffStat> = {}
      for (const pair of pairs) if (pair) map[pair[0]] = pair[1]
      setData(map)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return data
}
