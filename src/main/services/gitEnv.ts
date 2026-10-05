import { execFile } from 'child_process'
import { simpleGit, type SimpleGit } from 'simple-git'

/**
 * How Switchyard runs git. Your own git configuration still applies
 * (identity, signing, credential helpers, hooks), except for a few settings
 * that change git's *output format* - which Switchyard reads - and the
 * one that would make git wait for typing in a terminal nobody sees.
 *
 * - GIT_TERMINAL_PROMPT=0: when git needs a username or password it asks
 *   in the terminal it was started from. Switchyard's git has none, so a push
 *   to a remote without stored credentials could hang forever; with this it
 *   fails right away and says so. (A credential manager's own sign-in window
 *   still works.)
 * - core.quotepath=off: file names with accents or other non-ASCII letters
 *   come out as they are, not as "\303\251" escapes that match no file.
 * - diff.noprefix / diff.mnemonicPrefix off: diffs name files "a/x" and
 *   "b/x", the form the Changes tab parses. With either setting on, every
 *   file vanished from it.
 * - color.ui=false, log.showSignature=false: no color codes or signature
 *   lines mixed into output that gets parsed.
 */
export const GIT_ENV: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' }

export const GIT_CONFIG = ['core.quotepath=off', 'diff.noprefix=false', 'diff.mnemonicPrefix=false', 'color.ui=false', 'log.showSignature=false']

/** Commands that talk to a remote (fetch, push, clone) give up after this long without progress. */
export const NETWORK_TIMEOUT_MS = 90_000

/** What the user's environment had, before the app's git settings went in (terminals get this back). */
export const USER_GIT_ENV: Record<string, string | undefined> = {}

/**
 * Puts GIT_ENV into this process's environment, which every git it starts
 * inherits. (Not through simple-git's env option: that refuses to run when
 * the environment has EDITOR, PAGER or the like - which many people's do.)
 */
export function applyGitEnv(): void {
  for (const [k, v] of Object.entries(GIT_ENV)) {
    if (!(k in USER_GIT_ENV)) USER_GIT_ENV[k] = process.env[k]
    process.env[k] = v
  }
}
applyGitEnv()

/** A simple-git for `dir`, with the settings above. `network`: it may reach a remote (gets a timeout). */
export function gitAt(dir: string, opts: { network?: boolean } = {}): SimpleGit {
  return simpleGit({ baseDir: dir, config: GIT_CONFIG, ...(opts.network ? { timeout: { block: NETWORK_TIMEOUT_MS } } : {}) })
}

/** Arguments for running git directly (execFile): the settings first. */
export function gitArgs(args: string[]): string[] {
  return [...GIT_CONFIG.flatMap((c) => ['-c', c]), ...args]
}

/** The environment for running git directly. */
export function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...GIT_ENV, ...extra }
}

/**
 * Runs a git command whose answer is its exit code (merge-base
 * --is-ancestor, check-ignore…): true for 0, false for 1. simple-git can't
 * be asked this - a failure that prints nothing to stderr comes back as a
 * success there.
 */
export function gitYes(cwd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile('git', gitArgs(args), { cwd, env: gitEnv(), windowsHide: true }, (err) => {
      if (!err) return resolve(true)
      if ((err as { code?: unknown }).code === 1) return resolve(false)
      reject(err)
    })
  })
}
