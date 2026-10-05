import React, { useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { AlertAction, AlertLine } from './AlertLine'
import { timeAgo } from '../lib/status'
import { errText } from '../lib/errors'
import type { Project } from '@shared/types'

/**
 * Keeping main current: the board's line when the project's base branch is
 * behind origin (fetched in the background) - new tasks would start from
 * old code - with Pull to bring it up to date. Also says when a fetch fails.
 */
export function BaseStrip({ project }: { project: Project }): React.JSX.Element | null {
  const { state, dispatch } = useAppStore()
  const [busy, setBusy] = useState<'pull' | 'fetch' | null>(null)
  const st = state.base[project.id]
  if (!st?.hasRemote || (!st.behind && !st.error)) return null
  const act = (what: 'pull' | 'fetch'): void => {
    if (busy) return
    setBusy(what)
    const job = what === 'pull' ? window.api.base.pull(project.id).then((s) => (s ? [s] : [])) : window.api.base.fetch(project.id)
    job
      .then((statuses) => {
        dispatch({ type: 'BASE_STATUS', statuses })
        if (what === 'pull') dispatch({ type: 'TOAST', text: `Pulled ${st.base} - new tasks start from the latest.`, tone: 'done' })
      })
      .catch((err: unknown) => dispatch({ type: 'TOAST', text: `Could not ${what} ${st.base}: ${errText(err)}` }))
      .finally(() => setBusy(null))
  }
  const fetched = st.fetchedAt ? `fetched ${timeAgo(st.fetchedAt)}` : 'never fetched'
  return (
    <div style={{ flex: 'none', borderBottom: '1px solid var(--bd-1)', background: 'var(--bg-panel)' }}>
      {st.error ? (
        <AlertLine color="var(--c-red)" icon="⇣" title={st.error}>
          Could not fetch origin for {project.name}: {st.error}
          <AlertAction onClick={() => act('fetch')}>{busy === 'fetch' ? 'fetching…' : 'try again'}</AlertAction>
        </AlertLine>
      ) : (
        <AlertLine color="var(--c-amber)" icon="⇣" title={`origin/${st.base} has ${st.behind} commit${st.behind > 1 ? 's' : ''} your local ${st.base} doesn't - ${fetched}`}>
          {st.base} is {st.behind} commit{st.behind > 1 ? 's' : ''} behind origin{st.ahead ? ` and ${st.ahead} ahead` : ''} · new tasks would start from old code
          {st.ahead ? null : <AlertAction onClick={() => act('pull')}>{busy === 'pull' ? 'pulling…' : `pull ${st.base}`}</AlertAction>}
          <AlertAction onClick={() => act('fetch')}>{busy === 'fetch' ? 'fetching…' : 'fetch again'}</AlertAction>
        </AlertLine>
      )}
    </div>
  )
}
