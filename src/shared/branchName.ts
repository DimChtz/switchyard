/**
 * What's wrong with a new branch name, before git says so at Start: git's
 * rules for names (git check-ref-format), and clashes with branches that are
 * there - "foo" and "foo/bar" can't both exist (one is a file, the other a
 * folder of them), and on macOS and Windows names differing only in case
 * are the same file. Null when it's fine. `existing`: the names there now
 * (local, and origin's); one of them exactly is fine - it's reused.
 */
export function branchProblem(name: string, existing: string[] = []): string | null {
  const n = name.trim()
  if (!n) return 'A branch needs a name.'
  if (n.startsWith('-')) return 'A branch name can’t start with “-”.'
  if (n === '@' || n === 'HEAD') return `“${n}” isn’t a branch name git allows.`
  // eslint-disable-next-line no-control-regex
  const bad = n.match(/[~^:?*[\\\x00-\x20\x7f]/)
  if (bad) return `A branch name can’t contain “${bad[0] === ' ' ? 'a space' : bad[0]}”.`
  if (n.includes('..')) return 'A branch name can’t contain “..”.'
  if (n.includes('@{')) return 'A branch name can’t contain “@{”.'
  if (n.startsWith('/') || n.endsWith('/') || n.includes('//')) return 'Slashes separate parts of the name: none at the start or end, and not two in a row.'
  if (n.endsWith('.')) return 'A branch name can’t end with “.”.'
  for (const part of n.split('/')) {
    if (part.startsWith('.')) return `No part of a branch name can start with “.” (“${part}”).`
    if (part.endsWith('.lock')) return `No part of a branch name can end with “.lock” (“${part}”).`
  }
  if (existing.includes(n)) return null
  const lower = n.toLowerCase()
  for (const e of existing) {
    if (n.startsWith(e + '/')) return `A branch “${e}” is there: git can’t have both “${e}” and “${n}”.`
    if (e.startsWith(n + '/')) return `A branch “${e}” is there: git can’t have both “${n}” and “${e}”.`
    if (e.toLowerCase() === lower) return `“${e}” is there - differing only in case, they’d clash on macOS and Windows.`
  }
  return null
}
