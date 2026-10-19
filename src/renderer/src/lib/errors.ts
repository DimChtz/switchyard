/**
 * An error's message as the user should read it - without the
 * "Error invoking remote method 'git:rebase': Error: " that errors thrown in
 * the main process arrive wrapped in.
 */
export function errText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/** A message that reports something going wrong ("Could not push: …", "fatal: …"), said plainly or not. */
export function looksLikeError(text: string): boolean {
  return /^(could not|couldn't|can't|cannot|not finished|failed|error\b|github didn't|git didn't)/i.test(text.trim()) || /\b(fatal|error):\s/i.test(text)
}
