import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { errText } from '../lib/errors'
import { Button, FooterNote, Modal, ModalFooter, ModalHeader, TextInput } from './ui'
import type { Issue, Project } from '@shared/types'

const MONO = "var(--font-mono)"

/** Pick open GitHub issues of a project to add to its backlog. */
export function IssuesModal(): React.JSX.Element | null {
  const { state } = useAppStore()
  const project = state.projects.find((p) => p.id === state.issuesFor)
  if (!project) return null
  return <Body key={project.id} project={project} />
}

function Body({ project }: { project: Project }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())

  useEffect(() => {
    window.api.git
      .issues(project.repoPath)
      .then(setIssues)
      .catch((err: unknown) => setError(errText(err)))
  }, [project.repoPath])

  const imported = useMemo(() => new Set(state.tasks.filter((t) => t.projectId === project.id && t.issue).map((t) => t.issue!.number)), [state.tasks, project.id])
  const q = query.trim().toLowerCase()
  const shown = (issues ?? []).filter((i) => !q || i.title.toLowerCase().includes(q) || String(i.number).includes(q) || i.labels.some((l) => l.toLowerCase().includes(q)))
  const pickable = shown.filter((i) => !imported.has(i.number))
  const allPicked = pickable.length > 0 && pickable.every((i) => picked.has(i.number))

  const close = (): void => dispatch({ type: 'OPEN_ISSUES', projectId: null })
  const importPicked = (): void => {
    const chosen = (issues ?? []).filter((i) => picked.has(i.number))
    if (chosen.length)
      dispatch({
        type: 'IMPORT_ISSUES',
        projectId: project.id,
        issues: chosen
      })
  }
  const toggle = (n: number): void =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') importPicked()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Modal width={680} top={72} onClose={close}>
      <ModalHeader kicker={`Import issues · ${project.repo}`} title="Open issues into the backlog">
        <TextInput autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by title, number or label" style={{ background: 'var(--bd-row)', fontSize: 13 }} />
      </ModalHeader>
      <div style={{ flex: 1, minHeight: 120, overflow: 'auto', padding: 6 }}>
        {error ? (
          <div
            style={{
              padding: 14,
              font: '13px/1.5 var(--font-ui)',
              color: 'var(--c-red)'
            }}
          >
            {error}
          </div>
        ) : issues === null ? (
          <div
            style={{
              padding: 14,
              font: '13px var(--font-ui)',
              color: 'var(--t3)'
            }}
          >
            Loading issues…
          </div>
        ) : shown.length === 0 ? (
          <div
            style={{
              padding: 14,
              font: '13px var(--font-ui)',
              color: 'var(--t3)'
            }}
          >
            {issues.length ? 'No issues match.' : 'No open issues.'}
          </div>
        ) : (
          shown.map((i) => {
            const done = imported.has(i.number)
            const on = picked.has(i.number)
            return (
              <div
                key={i.number}
                onClick={() => !done && toggle(i.number)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '18px 54px 1fr auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: 5,
                  cursor: done ? 'default' : 'pointer',
                  opacity: done ? 0.5 : 1,
                  background: on ? 'color-mix(in srgb, var(--c-blue) 8%, transparent)' : 'transparent'
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    border: `1.5px solid ${on ? 'var(--c-blue)' : 'var(--bd-5)'}`,
                    background: on ? 'var(--c-blue)' : 'transparent',
                    color: 'var(--bg-app)',
                    font: `700 10px/11px ${MONO}`,
                    textAlign: 'center'
                  }}
                >
                  {on ? '✓' : ''}
                </span>
                <span style={{ font: `12px ${MONO}`, color: 'var(--t3)' }}>#{i.number}</span>
                <span
                  style={{
                    font: '13px var(--font-ui)',
                    color: 'var(--t1)',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {i.title}
                  {i.labels.map((l) => (
                    <span
                      key={l}
                      style={{
                        marginLeft: 8,
                        font: `11px ${MONO}`,
                        color: 'var(--t-icon)',
                        border: '1px solid var(--bd-3)',
                        borderRadius: 3,
                        padding: '0 5px'
                      }}
                    >
                      {l}
                    </span>
                  ))}
                </span>
                <span style={{ font: `11px ${MONO}`, color: 'var(--t3)' }}>{done ? 'imported' : ''}</span>
              </div>
            )
          })
        )}
      </div>
      <ModalFooter>
        {pickable.length ? (
          <Button variant="ghost" onClick={() => setPicked(allPicked ? new Set() : new Set(pickable.map((i) => i.number)))}>
            {allPicked ? 'Select none' : `Select all ${pickable.length}`}
          </Button>
        ) : null}
        <FooterNote>
          <span style={{ display: 'block', textAlign: 'right' }}>Each becomes a backlog task; merging it closes the issue.</span>
        </FooterNote>
        <Button size="lg" variant="primary" hint="⌘↵" disabled={!picked.size} onClick={importPicked}>
          Import {picked.size || ''}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
