/**
 * An error's message as the user should read it - without the
 * "Error invoking remote method 'git:rebase': Error: " that errors thrown in
 * the main process arrive wrapped in.
 */
export function errText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}
