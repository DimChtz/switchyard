/**
 * Links to a repository's files and commits on its host's website, from its
 * origin's address - as VS Code's Copy Remote URL / Copy Permalink. GitHub
 * (and GitHub Enterprise, and anything else) link as GitHub does; GitLab and
 * Bitbucket their own way.
 */

export interface RepoWeb {
  /** https://host/owner/repo */
  base: string
  host: string
  kind: 'github' | 'gitlab' | 'bitbucket'
}

/** git@github.com:o/r.git, ssh://git@host:22/o/r, https://user@host/o/r.git → its web page; null for a local path. */
export function repoWeb(remote: string): RepoWeb | null {
  const url = remote.trim()
  let host: string
  let path: string
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/.exec(url)
  const full = /^(?:ssh|git|https?|git\+ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(url)
  if (full) [, host, path] = full
  else if (scp && !/^[a-z]:[\\/]/i.test(url)) [, host, path] = scp
  else return null
  path = path.replace(/\.git\/?$/, '').replace(/\/+$/, '')
  // (GitLab and others over ssh add a "scm/" or a port path now and then - the owner/repo is what's after.)
  if (!path.includes('/')) return null
  const h = host.toLowerCase()
  const kind = h.includes('gitlab') ? 'gitlab' : h.includes('bitbucket') ? 'bitbucket' : 'github'
  return { base: `https://${host}/${path}`, host, kind }
}

/** A file at a ref (a branch, or a commit for a permalink), its lines marked when given (1-based, inclusive). */
export function fileUrl(web: RepoWeb, ref: string, path: string, lines?: [number, number] | null): string {
  const file = path.split('/').map(encodeURIComponent).join('/')
  const r = ref.split('/').map(encodeURIComponent).join('/')
  const [a, b] = lines ?? [0, 0]
  const one = !!lines && a === b
  if (web.kind === 'gitlab') return `${web.base}/-/blob/${r}/${file}${lines ? (one ? `#L${a}` : `#L${a}-${b}`) : ''}`
  if (web.kind === 'bitbucket') return `${web.base}/src/${r}/${file}${lines ? (one ? `#lines-${a}` : `#lines-${a}:${b}`) : ''}`
  return `${web.base}/blob/${r}/${file}${lines ? (one ? `#L${a}` : `#L${a}-L${b}`) : ''}`
}

/** A commit's page. */
export function commitUrl(web: RepoWeb, sha: string): string {
  if (web.kind === 'gitlab') return `${web.base}/-/commit/${sha}`
  if (web.kind === 'bitbucket') return `${web.base}/commits/${sha}`
  return `${web.base}/commit/${sha}`
}
