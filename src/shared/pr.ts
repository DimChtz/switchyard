import type { PrCheck, PrComment, PrDetails, PullRequest } from './types'

/**
 * A pull request's checks and reviews, from the GitHub CLI's JSON (`gh pr
 * view --json …` and the line comments from `gh api …/pulls/N/comments`),
 * and what to tell an agent about them.
 */

interface RollupItem {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string | null
  state?: string
  detailsUrl?: string | null
  targetUrl?: string | null
}

interface GhPr {
  url: string
  number: number
  state: PullRequest['state']
  statusCheckRollup?: RollupItem[] | null
  reviewDecision?: string | null
  reviews?: { id?: string; author?: { login?: string } | null; body?: string; state?: string; submittedAt?: string; url?: string }[] | null
  comments?: { id?: string; author?: { login?: string } | null; body?: string; createdAt?: string; url?: string }[] | null
}

interface GhLineComment {
  id: number | string
  user?: { login?: string } | null
  body?: string
  path?: string
  line?: number | null
  original_line?: number | null
  created_at?: string
  html_url?: string
}

export function checkState(c: RollupItem): PrCheck['state'] {
  if (c.__typename === 'StatusContext' || (c.state && !c.status)) {
    const s = (c.state ?? '').toUpperCase()
    return s === 'SUCCESS' ? 'pass' : s === 'FAILURE' || s === 'ERROR' ? 'fail' : 'pending'
  }
  if ((c.status ?? '').toUpperCase() !== 'COMPLETED') return 'pending'
  const k = (c.conclusion ?? '').toUpperCase()
  if (k === 'SUCCESS' || k === 'NEUTRAL') return 'pass'
  if (k === 'SKIPPED') return 'skipped'
  return 'fail'
}

const time = (s?: string | null): number => (s ? Date.parse(s) || 0 : 0)

export function toPrDetails(pr: GhPr, lineComments: GhLineComment[] = [], now = Date.now()): PrDetails {
  const checks: PrCheck[] = (pr.statusCheckRollup ?? []).map((c) => ({ name: c.name || c.context || 'check', state: checkState(c), url: c.detailsUrl ?? c.targetUrl ?? null }))
  const comments: PrComment[] = [
    // A review's own text (not the empty ones that only carry line comments).
    ...(pr.reviews ?? [])
      .filter((r) => r.body?.trim())
      .map((r, i) => ({ id: r.id ?? `review-${i}`, author: r.author?.login ?? 'someone', body: r.body!.trim(), path: null, line: null, at: time(r.submittedAt), url: r.url ?? null })),
    ...(pr.comments ?? [])
      .filter((c) => c.body?.trim())
      .map((c, i) => ({ id: c.id ?? `comment-${i}`, author: c.author?.login ?? 'someone', body: c.body!.trim(), path: null, line: null, at: time(c.createdAt), url: c.url ?? null })),
    ...lineComments
      .filter((c) => c.body?.trim())
      .map((c) => ({ id: String(c.id), author: c.user?.login ?? 'someone', body: c.body!.trim(), path: c.path ?? null, line: c.line ?? c.original_line ?? null, at: time(c.created_at), url: c.html_url ?? null }))
  ].sort((a, b) => a.at - b.at)
  return { url: pr.url, number: pr.number, state: pr.state, created: false, checks, reviewDecision: pr.reviewDecision || null, comments, at: now }
}

/** One line for a card or banner: "2 checks failing", "changes requested", "checks passing · approved". */
export function prSummary(d: PrDetails): { text: string; tone: 'fail' | 'pending' | 'pass' | 'plain' } {
  const failing = d.checks.filter((c) => c.state === 'fail').length
  const pending = d.checks.filter((c) => c.state === 'pending').length
  const parts: string[] = []
  let tone: 'fail' | 'pending' | 'pass' | 'plain' = 'plain'
  if (failing) {
    parts.push(`${failing} check${failing > 1 ? 's' : ''} failing`)
    tone = 'fail'
  } else if (pending) {
    parts.push(`${pending} check${pending > 1 ? 's' : ''} running`)
    tone = 'pending'
  } else if (d.checks.length) {
    parts.push('checks passing')
    tone = 'pass'
  }
  if (d.reviewDecision === 'CHANGES_REQUESTED') {
    parts.push('changes requested')
    tone = 'fail'
  } else if (d.reviewDecision === 'APPROVED') parts.push('approved')
  return { text: parts.join(' · ') || 'no checks', tone }
}

/** What to tell the agent about failing checks. */
export function checksMessage(d: PrDetails): string | null {
  const failing = d.checks.filter((c) => c.state === 'fail')
  if (!failing.length) return null
  const list = failing.map((c) => `${c.name}${c.url ? ` (${c.url})` : ''}`).join('; ')
  return `CI failed on pull request #${d.number}: ${list}. Find out why - e.g. \`gh pr checks ${d.number}\` and \`gh run view <run id> --log-failed\` - fix it, commit and push.`
}

/** What to tell the agent about review comments (those after `since`). */
export function reviewMessage(d: PrDetails, since = 0): string | null {
  const fresh = d.comments.filter((c) => c.at > since)
  if (!fresh.length) return null
  const lines = fresh.map((c) => `- ${c.author}${c.path ? ` on ${c.path}${c.line ? `:${c.line}` : ''}` : ''}: ${c.body.replace(/\s+/g, ' ').slice(0, 600)}`)
  return `Review comments on pull request #${d.number}${d.reviewDecision === 'CHANGES_REQUESTED' ? ' (changes requested)' : ''}:\n${lines.join('\n')}\nAddress them, commit and push.`
}
