import React, { useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { AlertAction, AlertLine } from './AlertLine'
import { errText } from '../lib/errors'
import type { Project } from '@shared/types'

/** What a repository's settings file asks for, in words (one line each). */
export function trustLines(values: Record<string, unknown>): string[] {
  const v = (k: string): string => String(values[k] ?? '')
  const out: string[] = []
  if (values.setupCmd) out.push(`run \`${v('setupCmd')}\` when a task starts`)
  if (values.testCmd) out.push(`run tests with \`${v('testCmd')}\``)
  if (values.devCmd) out.push(`start the dev server with \`${v('devCmd')}\``)
  if (values.env) {
    const keys = v('env')
      .split('\n')
      .map((l) => l.split('=')[0])
      .filter(Boolean)
    out.push(`set ${keys.length} environment variable${keys.length === 1 ? '' : 's'} (${keys.join(', ')})`)
  }
  if (values.agentArgs && typeof values.agentArgs === 'object') {
    for (const [agent, args] of Object.entries(values.agentArgs as Record<string, string>)) if (args) out.push(`start ${agent} with \`${args}\``)
  }
  if (values.editPerm === 'auto') out.push('let agents edit files without asking')
  if (values.shellPerm === 'auto') out.push('let agents run any command without asking')
  if (values.shellPerm === 'allowlist' || values.allowlist) out.push(`let agents run ${v('allowlist') || 'listed commands'} without asking`)
  if (values.shell) out.push(`open terminals with \`${v('shell')}\``)
  if (values.editor) out.push(`open files with \`${v('editor')}\``)
  return out
}

/**
 * A repository's committed settings ask to run commands or widen what agents
 * may do: held back until you trust them, here.
 */
export function TrustStrip({ project }: { project: Project }): React.JSX.Element | null {
  const { dispatch } = useAppStore()
  const [open, setOpen] = useState(false)
  const u = project.untrusted
  if (!u) return null
  const lines = trustLines(u.values)
  return (
    <div style={{ flex: 'none', borderBottom: '1px solid var(--bd-1)', background: 'var(--bg-panel)' }}>
      <AlertLine color="var(--c-amber)" icon="⚑" title="From .switchyard/settings.json in the repository - not applied until you trust it">
        {project.name}&apos;s settings file wants to {lines.length === 1 ? lines[0] : `do ${lines.length} things`} - not applied yet
        <AlertAction onClick={() => setOpen((o) => !o)}>{open ? 'hide' : 'review'}</AlertAction>
        <AlertAction
          onClick={() =>
            window.api.projects
              .trust(project.id, u.hash)
              .then(() => dispatch({ type: 'TOAST', text: `Trusted ${project.name}'s settings - they apply now.`, tone: 'done' }))
              .catch((err: unknown) => dispatch({ type: 'TOAST', text: errText(err) }))
          }
        >
          trust and apply
        </AlertAction>
        <AlertAction onClick={() => window.api.projects.openSettingsFile(project.id, 'shared').catch(() => {})}>open the file</AlertAction>
      </AlertLine>
      {open ? (
        <ul style={{ margin: 0, padding: '0 20px 10px 44px', font: '12.5px/1.6 var(--font-ui)', color: 'var(--t2)' }}>
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
          <li style={{ color: 'var(--t4)', listStyle: 'none', marginLeft: -16 }}>Trust holds for these exact values - if the file changes them, you&apos;re asked again.</li>
        </ul>
      ) : null}
    </div>
  )
}
