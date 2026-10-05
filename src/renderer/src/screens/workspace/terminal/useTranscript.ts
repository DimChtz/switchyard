import { useEffect, useState } from 'react'
import type { Task, TranscriptSummary } from '@shared/types'

/**
 * What the agent's Claude Code session did, read from its transcript:
 * tokens, and its latest actions. Read again a beat after its latest
 * activity (so the transcript has been written).
 */
export function useTranscript(task: Task): TranscriptSummary | null {
  const [summary, setSummary] = useState<TranscriptSummary | null>(null)
  const transcript = task.session?.transcript
  useEffect(() => {
    if (!transcript) return setSummary(null)
    let cancelled = false
    const t = setTimeout(() => {
      window.api.agents
        .transcript(transcript)
        .then((s) => !cancelled && setSummary(s))
        .catch(() => {})
    }, 800)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [transcript, task.lastActivityAt])
  return summary
}
