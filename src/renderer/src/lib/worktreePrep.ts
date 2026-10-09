import type { DepShare, Project } from '@shared/types'

/**
 * A new worktree made ready to work in: the project's untracked files copied in (.env, keys), and
 * - when the project asks for it - a copy of the checkout's installed dependencies, where the
 * lockfile matches. Never fails the worktree: what couldn't be done is left to the setup command.
 */
export async function prepareWorktree(p: Project, path: string): Promise<{ copied: string[]; deps: DepShare[]; error: string | null }> {
  let error: string | null = null
  const copied = p.copyFiles?.length
    ? await window.api.git.copyIntoWorktree(p.repoPath, path, p.copyFiles).catch((err: unknown) => {
        error = `Could not copy files into the worktree: ${err instanceof Error ? err.message : String(err)}`
        return [] as string[]
      })
    : []
  const deps =
    p.shareDeps === 'copy'
      ? await window.api.git.shareDeps(p.repoPath, path, p.depFolders?.length ? p.depFolders : ['node_modules']).catch((err: unknown) => {
          error = `Could not copy the dependencies: ${err instanceof Error ? err.message : String(err)}`
          return [] as DepShare[]
        })
      : []
  return { copied, deps, error }
}

/** What a worktree got, as list entries ("node_modules/ (dependencies)"). */
export function preparedList(r: { copied: string[]; deps: DepShare[] }, prefix = ''): string[] {
  return [...r.copied.map((f) => prefix + f), ...r.deps.filter((d) => d.how === 'copied').map((d) => `${prefix}${d.folder}/ (dependencies)`)]
}
