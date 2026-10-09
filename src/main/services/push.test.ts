import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, powerMonitor: { getSystemIdleTime: () => 0 } }))
vi.mock('./store', () => ({ getPrefs: () => ({}) }))
vi.mock('./log', () => ({ log: { warn: () => {} } }))

import { pushRequest } from './push'

const n = { kind: 'permission' as const, taskKey: 'SYT-3', taskTitle: 'Fix login', text: 'Claude Code needs your approval', detail: 'Bash: rm -rf dist' }

describe('notifications to a phone or chat', () => {
  it('ntfy: the text as the body, title and priority as headers (non-ASCII encoded)', () => {
    const r = pushRequest('ntfy', 'https://ntfy.sh/t', n)
    const h = r.init.headers as Record<string, string>
    expect([r.url, r.init.body, h.Title, h.Priority]).toEqual(['https://ntfy.sh/t', 'Fix login\nBash: rm -rf dist', 'SYT-3: Claude Code needs your approval', 'high'])
    // Not ASCII: encoded (RFC 2047), as headers can't carry it.
    expect(pushRequest('ntfy', 'https://ntfy.sh/t', { ...n, taskKey: '', text: 'Δοκιμή' }).init.headers).toMatchObject({ Title: `=?UTF-8?B?${Buffer.from('Δοκιμή').toString('base64')}?=` })
  })

  it('Slack, Discord and a plain webhook: JSON', () => {
    expect(JSON.parse(pushRequest('slack', 'https://hooks.slack.com/x', n).init.body as string)).toEqual({ text: '*SYT-3: Claude Code needs your approval*\nFix login\nBash: rm -rf dist' })
    expect(JSON.parse(pushRequest('discord', 'https://discord.com/api/webhooks/x', n).init.body as string).content).toMatch(/^\*\*SYT-3/)
    expect(JSON.parse(pushRequest('webhook', 'https://example.test/h', n).init.body as string)).toMatchObject({ source: 'switchyard', kind: 'permission', task: { key: 'SYT-3', title: 'Fix login' } })
  })
})
