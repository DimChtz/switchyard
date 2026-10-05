import { useEffect, useState } from 'react'

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

/** Last `count` non-blank lines of raw PTY output, with escape codes stripped. */
export function tailLines(raw: string, count: number): string[] {
  const lines = raw
    .replace(ANSI, '')
    .split('\n')
    .map((l) => {
      const parts = l.split('\r').filter((p) => p.length > 0)
      // eslint-disable-next-line no-control-regex -- control characters are what's removed
      return (parts[parts.length - 1] ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trimEnd()
    })
    .filter((l) => l.trim().length > 0)
  return lines.slice(-count)
}

/**
 * Polls a PTY session's buffered output for a small live preview. Returns
 * null when there is no session (running or exited) in this app instance.
 */
export function usePtyTail(sessionId: string, count: number, intervalMs = 1500): string[] | null {
  const [lines, setLines] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async (): Promise<void> => {
      const info = await window.api.pty.info(sessionId)
      if (cancelled) return
      if (!info) {
        setLines(null)
        return
      }
      const raw = await window.api.pty.getBuffer(sessionId)
      if (!cancelled) setLines(tailLines(raw, count))
    }
    poll()
    const t = setInterval(poll, intervalMs)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [sessionId, count, intervalMs])

  return lines
}
