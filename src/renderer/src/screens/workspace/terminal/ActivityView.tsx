import React from 'react'
import { timeAgo } from '../../../lib/status'
import { agentShort } from '../../../lib/derive'
import type { Task } from '@shared/types'
import { PanelHeader, type PanelChrome } from '../layout/PanelHeader'
import { useTranscript } from './useTranscript'

/** The Activity side bar view: what the agent did lately, newest first (from its session's transcript). */
export function ActivityView({ task, chrome }: { task: Task; chrome: PanelChrome }): React.JSX.Element {
  const summary = useTranscript(task)
  const recent = (summary?.tools ?? []).slice(-30).reverse()
  const agent = agentShort(task.agentKind) || 'The agent'
  return (
    <>
      <PanelHeader title="Activity" chrome={chrome} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 18px 20px' }}>
        {!recent.length ? (
          <div style={{ font: '12.5px/1.5 var(--font-ui)', color: 'var(--t4)', textWrap: 'pretty' }}>
            {!task.agentKind ? 'No agent on this task.' : task.session?.transcript ? `${agent} hasn't done anything yet.` : `What ${agent} does shows up here - read from its session (Claude Code).`}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {recent.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '12px 1fr', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: i === 0 && task.st === 'working' ? 'var(--c-green)' : 'var(--t5)', marginTop: 5, flex: 'none' }} />
                  <span style={{ flex: 1, width: 1, background: 'var(--bd-2)' }} />
                </div>
                <div style={{ paddingBottom: 14, minWidth: 0 }}>
                  <div style={{ font: '12.5px/1.4 var(--font-ui)', color: i === 0 ? 'var(--t1)' : 'var(--t2)', overflowWrap: 'anywhere' }}>{r.what}</div>
                  <div style={{ font: '11px var(--font-mono)', color: 'var(--t4)', marginTop: 2 }}>{r.at ? `${timeAgo(r.at)} ago` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
