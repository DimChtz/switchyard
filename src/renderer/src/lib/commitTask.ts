import type { Task } from '@shared/types'

/**
 * The task a commit came from, by its message: Switchyard's commits start with the task's key
 * ("SYT-25: …"), a merge names the task's branch ("Merge branch 'syt-25'"), and a squashed pull
 * request ends with its number, which the task's PR may have.
 */
export function taskOfCommit(subject: string, tasks: Task[]): Task | null {
  const key = subject.match(/^\s*(?:\[)?([A-Z][A-Z0-9]*-\d+)\b/)?.[1]
  if (key) {
    const t = tasks.find((x) => x.key === key)
    if (t) return t
  }
  const branch = subject.match(/^Merge (?:remote-tracking )?branch '(?:origin\/)?([^']+)'/)?.[1] ?? subject.match(/^Merge pull request #\d+ from [^/\s]+\/(\S+)/)?.[1]
  if (branch) {
    const t = tasks.find((x) => x.branch === branch)
    if (t) return t
  }
  const pr = subject.match(/\(#(\d+)\)\s*$/)?.[1]
  if (pr) {
    const t = tasks.find((x) => x.pr?.number === Number(pr) || x.pr?.url?.endsWith(`/pull/${pr}`))
    if (t) return t
  }
  return null
}
