import { BrowserWindow, powerMonitor } from 'electron'
import type { Notice, NoticeKind, Prefs } from '@shared/types'
import { getPrefs } from './store'
import { log } from './log'

/** What goes to the phone: a notice, without the bookkeeping. */
export type PushNotice = Pick<Notice, 'kind' | 'taskKey' | 'taskTitle' | 'text' | 'detail'>

/** Away: the window isn't in front, or nothing was typed or clicked for this long. */
const IDLE_SECONDS = 120

function away(): boolean {
  const focused = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused())
  return !focused || powerMonitor.getSystemIdleTime() >= IDLE_SECONDS
}

/** Urgent ones (it's stuck until you answer) ring louder where the service can. */
const URGENT: NoticeKind[] = ['permission', 'failed', 'agent-question']

/** The request a service takes for a notice. */
export function pushRequest(service: Prefs['pushService'], url: string, n: PushNotice): { url: string; init: RequestInit } {
  const title = `${n.taskKey ? `${n.taskKey}: ` : ''}${n.text}`
  const body = [n.taskTitle, n.detail].filter(Boolean).join('\n') || n.text
  if (service === 'ntfy') {
    return {
      url,
      init: {
        method: 'POST',
        body,
        headers: { Title: encodeHeader(title), Tags: n.kind === 'failed' || n.kind === 'tests-failed' ? 'x' : n.kind === 'done' || n.kind === 'pr-merged' ? 'white_check_mark' : 'robot', Priority: URGENT.includes(n.kind) ? 'high' : 'default' }
      }
    }
  }
  if (service === 'slack') return { url, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `*${title}*\n${body}` }) } }
  if (service === 'discord') return { url, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: `**${title}**\n${body}`.slice(0, 1900) }) } }
  return {
    url,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'switchyard', kind: n.kind, title, text: n.text, detail: n.detail ?? null, task: n.taskKey ? { key: n.taskKey, title: n.taskTitle } : null, at: new Date().toISOString() })
    }
  }
}

/** HTTP headers are Latin-1: other characters (an emoji, Greek) would fail the request - ntfy reads RFC 2047. */
function encodeHeader(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf-8').toString('base64')}?=`
}

/**
 * Sends a notice to the phone or chat set in Settings → Notifications - the kinds picked there,
 * and (unless it's set to always) only while you're away from the computer. `test` sends
 * regardless, and throws when it doesn't get through.
 */
export async function pushNotice(n: PushNotice, test = false): Promise<void> {
  const prefs = getPrefs()
  const url = prefs.pushUrl.trim()
  if (!url) {
    if (test) throw new Error('Set where to send them first.')
    return
  }
  if (!test && (!prefs.pushKinds.includes(n.kind) || (prefs.pushWhenAway && !away()))) return
  if (!/^https?:\/\//i.test(url)) {
    if (test) throw new Error('The address must start with https:// (or http:// for a server on your network).')
    return
  }
  const req = pushRequest(prefs.pushService, url, n)
  try {
    const res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim())
  } catch (err) {
    log.warn('push', `Could not send a notification to ${url.replace(/^https?:\/\/([^/]+).*$/i, '$1')}`, err)
    if (test) throw new Error(`It didn't get through: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
}
