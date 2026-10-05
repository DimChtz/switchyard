import { BrowserWindow } from 'electron'
import { getComments, updateComments } from './store'
import { lastAssistantText } from './transcript'
import { parseReplies } from '@shared/reviewReplies'
import type { CommentsChange } from '@shared/types'
import { IPC } from '@shared/ipc'

/** Tells the windows the review comments changed (a task's agent answered some). */
export function commentsChanged(change: CommentsChange): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.commentsChanged, change)
}

/**
 * After the agent's turn: its answers to the review comments it was asked
 * about go into their threads. `message` is its last message (the Stop
 * hook's), else it's read from the transcript.
 */
export async function takeReplies(taskId: string, message: string | undefined, transcript: string | undefined): Promise<void> {
  const asked = getComments().filter((c) => c.taskId === taskId && c.awaiting && c.ref != null)
  if (!asked.length) return
  const text = message ?? (transcript ? await lastAssistantText(transcript).catch(() => null) : null)
  if (!text) return
  const replies = parseReplies(text, asked.map((c) => c.ref!))
  if (!replies.size) return
  const at = Date.now()
  const answered = asked.filter((c) => replies.has(c.ref!))
  updateComments(answered.map((c) => ({ id: c.id, patch: { awaiting: false, thread: [...(c.thread ?? []), { from: 'agent' as const, text: replies.get(c.ref!)!, at }] } })))
  commentsChanged({ taskId, replies: answered.length })
}
