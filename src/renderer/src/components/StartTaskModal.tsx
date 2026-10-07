import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { busyAgents } from '../lib/derive'
import { noteTitle } from '../lib/notes'
import { AGENTS, branchFor } from '@shared/constants'
import type { AgentKind, BranchInfo, GitWorktreeInfo, Project, Task } from '@shared/types'
import { Button, Combo, FooterNote, Menu, Modal, ModalFooter, ModalHeader, SectionLabel, Segmented, Select, type MenuAnchor, type MenuItem } from './ui'
import { prefsFor } from '../lib/projectPrefs'
import { timeAgo } from '../lib/status'
import { useHeadBranch } from '../lib/headBranch'
import { repoDir, reposOf } from '../lib/multiRepo'
import { baseFor, parentFinished, parentOf, waitsFor } from '@shared/stack'
import { MODEL_SUGGESTIONS, canPlanFirst } from '../lib/agentControl'
import { droppedImages, fileName, pastedImages } from '../lib/attachments'
import { errText } from '../lib/errors'

const MONO = "var(--font-mono)"

interface AgentInfo {
  installed: boolean
  version: string | null
}

export function StartTaskModal(): React.JSX.Element | null {
  const { state } = useAppStore()
  if (!state.start || state.start.background) return null
  const task = state.tasks.find((t) => t.id === state.start!.taskId)
  if (!task) return null
  const project = state.projects.find((p) => p.id === task.projectId)
  if (!project) return null
  return <ModalBody key={task.id} task={task} project={project} />
}

function ModalBody({ task, project }: { task: Task; project: Project }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const start = state.start!
  // Building on another task: from its branch (once it has one).
  const base = baseFor(task, project, state.tasks)
  const parent = parentOf(task, state.tasks)
  const waiting = waitsFor(task, state.tasks)
  const from = (b: string): string => (parent && b !== (project.defaultBranch ?? 'main') ? `${b} · ${parent.key}` : b)

  const [head, setHead] = useState(waiting ? `${waiting.key}'s branch, once it starts` : from(base))
  const [suggestedWtPath, setSuggestedWtPath] = useState<string | null>(null)
  // The base branch against origin (fetched in the background): pulled here, the start is from the latest.
  const behind = state.base[project.id]
  const baseBehind = !parent && behind && behind.base === base ? behind.behind : 0

  useEffect(() => {
    if (waiting) return
    window.api.git.shortSha(project.repoPath, base).then((sha) => {
      if (sha) setHead(from(`${base} @ ${sha}`))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.repoPath, base, waiting, baseBehind])

  useEffect(() => {
    window.api.git.suggestWorktreePath(project.repoPath, start.branch).then(setSuggestedWtPath)
  }, [project.repoPath, start.branch])

  // In several repositories: one folder for the task, a worktree per repository inside.
  const [suggestedTaskDir, setSuggestedTaskDir] = useState<string | null>(null)
  useEffect(() => {
    window.api.git.suggestTaskDir(project.repoPath, task.key).then(setSuggestedTaskDir)
  }, [project.repoPath, task.key])
  const repoProjects = [project, ...start.repos.map((id) => state.projects.find((p) => p.id === id)).filter((p): p is Project => !!p)]
  const multi = repoProjects.length > 1
  const taskDir = start.taskDir ?? suggestedTaskDir
  const sep = taskDir?.includes('\\') ? '\\' : '/'
  const wtPath = multi ? (taskDir ? `${taskDir}${sep}{${repoProjects.map(repoDir).join(', ')}}` : '…') : (start.worktreePath ?? suggestedWtPath ?? '…')
  const agentName = AGENTS.find((a) => a.kind === start.agentKind)?.name ?? start.agentKind

  const onOverlay = (): void =>
    dispatch({
      type: start.phase === 'config' ? 'CLOSE_START_MODAL' : 'BACKGROUND_START'
    })

  return (
    <Modal width={620} onClose={onOverlay}>
      {start.phase === 'config' ? (
        <ConfigPhase task={task} project={project} head={head} wtPath={wtPath} agentName={agentName} baseBehind={baseBehind} />
      ) : (
        <LaunchPhase task={task} project={project} head={head} wtPath={wtPath} agentName={agentName} />
      )}
    </Modal>
  )
}

interface PhaseProps {
  task: Task
  project: Project
  head: string
  wtPath: string
  agentName: string
  baseBehind?: number
}

function ConfigPhase({ task, project, head, wtPath, agentName, baseBehind = 0 }: PhaseProps): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const start = state.start!
  const parent = parentOf(task, state.tasks)
  const waiting = waitsFor(task, state.tasks)
  // Notes linked to the task go to the agent with its first message.
  const taskNotes = state.notes.filter((n) => n.taskId === task.id)
  const busy = busyAgents(state.tasks)
  const full = state.prefs.maxAgents > 0 && busy >= state.prefs.maxAgents
  const [info, setInfo] = useState<Partial<Record<AgentKind, AgentInfo>>>({})

  useEffect(() => {
    let cancelled = false
    window.api.agents.detectInstalled().then((installed) => {
      if (cancelled) return
      setInfo(Object.fromEntries(AGENTS.map((a) => [a.kind, { installed: installed[a.kind], version: null }])))
      for (const a of AGENTS) {
        if (!installed[a.kind]) continue
        window.api.agents.version(a.kind).then((version) => {
          if (!cancelled)
            setInfo((cur) => ({
              ...cur,
              [a.kind]: { installed: true, version }
            }))
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const headHere = useHeadBranch(start.inPlace ? project.repoPath : null)
  const { branches, free } = useStartPlaces(project, task)
  // The branch named is one that's there already (local, or only on origin): the task continues on it.
  const picked = start.existingWorktree ? (branches.find((b) => b.name === start.branch) ?? { name: start.branch, local: true, remote: false, at: 0, subject: '', worktree: start.existingWorktree, mainCheckout: false }) : branches.find((b) => b.name === start.branch.trim())
  const newBranchName = branchFor(prefsFor(state, task.projectId).branchPattern, task.title, task.key)
  const multi = start.repos.length > 0

  const running = (kind: AgentKind): number =>
    state.tasks.filter((t) => t.agentKind === kind && (t.st === 'working' || t.st === 'waiting' || t.st === 'failed')).length

  return (
    <>
      <ModalHeader kicker={`Start task · ${task.key} · ${project.name}`} title={task.title} />
      {/* What's between the title and the buttons scrolls, so the buttons stay in sight. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div
          style={{
            padding: '14px 12px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}
        >
          <SectionLabel style={{ padding: '0 8px 8px' }}>Agent</SectionLabel>
          <AgentPicker
            agents={AGENTS.filter((a) => !state.prefs.agentsOff.includes(a.kind)).map((a) => {
              const ai = info[a.kind]
              return { kind: a.kind, name: a.name, note: a.note, meta: !ai ? '…' : !ai.installed ? 'not installed' : `${ai.version ? ai.version + ' · ' : ''}${running(a.kind)} running`, missing: ai?.installed === false }
            })}
            value={start.agentKind}
            onChange={(agentKind) => dispatch({ type: 'SET_START_AGENT', agentKind })}
          />
        </div>
        <div
          style={{
            margin: '10px 20px 0',
            border: '1px solid var(--bd-2)',
            borderRadius: 6,
            background: 'var(--bg-input)',
            padding: '8px 12px',
            display: 'grid',
            gridTemplateColumns: '78px 1fr',
            rowGap: 6,
            columnGap: 12,
            font: `12.5px ${MONO}`,
            alignItems: 'center'
          }}
        >
          <span style={{ color: 'var(--t4)', fontFamily: 'var(--font-ui)' }}>Works in</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, fontFamily: 'var(--font-ui)' }}>
            <Segmented
              value={start.inPlace ? 'here' : 'worktree'}
              options={[
                ['worktree', 'New branch & worktree'],
                ['here', 'Project folder']
              ]}
              onChange={(v) => {
                const inPlace = v === 'here'
                dispatch({ type: 'SET_START_OPTIONS', patch: { inPlace } })
                // Its other repositories get worktrees on its branch - there's none in the project folder.
                if (inPlace && start.repos.length) dispatch({ type: 'SET_START_REPOS', repos: [] })
              }}
            />
          </span>
          {start.inPlace ? (
            <>
              <span style={{ color: 'var(--t4)', fontFamily: 'var(--font-ui)' }}>Folder</span>
              <span title={project.repoPath} style={{ color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {project.repoPath}
                {headHere ? <span style={{ color: 'var(--t3)' }}> · on {headHere}</span> : null}
              </span>
              <span />
              <span style={{ font: '11.5px/1.45 var(--font-ui)', color: 'var(--t3)', textWrap: 'pretty' } as React.CSSProperties}>
                No branch, worktree or setup: {agentName} works on what&apos;s checked out there, alongside you. For explorations and investigations - nothing is merged or removed when it&apos;s done.
              </span>
            </>
          ) : (
            <>
              {/* (Another repository gets a new worktree on the branch, next to this one's: not with one that's already there.) */}
              {start.existingWorktree ? null : <RepoPicker task={task} project={project} agentName={agentName} />}
              <span style={{ color: 'var(--t4)', fontFamily: 'var(--font-ui)' }}>Branch</span>
              <BranchField task={task} project={project} branches={branches} free={free} />
              {picked ? (
                <>
                  <span />
                  <span style={{ font: '11.5px/1.45 var(--font-ui)', color: !start.existingWorktree && picked.worktree ? 'var(--c-amber)' : 'var(--t3)', textWrap: 'pretty' } as React.CSSProperties}>
                    {start.existingWorktree
                      ? `Takes over that worktree as it is, on ${start.branch} - its commits and changes stay; nothing is created. Done removes it like any task's.`
                      : picked.worktree
                        ? picked.mainCheckout
                          ? `${picked.name} is checked out in the project folder - a branch can't be out in two places. Switch that folder to another branch, or pick another one here.`
                          : `${picked.name} is checked out in ${picked.worktree} - pick it from the list to take that worktree over, or pick another branch.`
                        : picked.local
                        ? `An existing branch: the task continues on it, from ${picked.subject ? `“${picked.subject}”` : 'its last commit'} (${timeAgo(picked.at)} ago).`
                        : `Only on origin: checked out from there (tracking origin/${picked.name}), and the task continues on it.`}
                  </span>
                </>
              ) : null}
              {picked ? null : (
                <>
                  <span style={{ color: 'var(--t4)', fontFamily: 'var(--font-ui)' }}>From</span>
                  <span style={{ color: 'var(--t2)', display: 'flex', gap: 10, alignItems: 'baseline', minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{head}</span>
                    {baseBehind ? <PullBase projectId={project.id} behind={baseBehind} /> : null}
                  </span>
                </>
              )}
              <span style={{ color: 'var(--t4)', fontFamily: 'var(--font-ui)' }}>Worktree</span>
              {free.length && !multi ? (
                <Select
                  value={start.existingWorktree ?? ''}
                  title={start.existingWorktree ?? wtPath}
                  options={[['', `New · ${wtPath}`], ...free.map((w): [string, string] => [w.path, `${w.branch || '(detached)'} · ${w.path}`])]}
                  onChange={(path) => {
                    const w = free.find((x) => x.path === path)
                    dispatch({ type: 'SET_START_OPTIONS', patch: { existingWorktree: w ? w.path : null } })
                    // Its branch is the task's; back to a new worktree: a new branch name again.
                    dispatch({ type: 'SET_START_BRANCH', branch: w ? w.branch : newBranchName })
                    if (w && start.repos.length) dispatch({ type: 'SET_START_REPOS', repos: [] })
                  }}
                  style={{ ...FIELD, padding: '2px 0', background: 'transparent', border: 'none', borderBottom: '1px dashed var(--bd-4)' }}
                />
              ) : (
                <span style={{ color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wtPath}</span>
              )}
              <span style={{ color: 'var(--t4)', fontFamily: 'var(--font-ui)' }}>Setup</span>
              <span style={{ color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {start.existingWorktree ? 'skipped - that worktree is set up already' : startRepos(state, task).map((p) => p.setupCmd).filter(Boolean).join(' · ') || '—'}
              </span>
            </>
          )}
          <span style={{ color: 'var(--t4)', fontFamily: 'var(--font-ui)' }}>Model</span>
          <ModelField />
          {taskNotes.length ? (
            <>
              <span style={{ color: 'var(--t4)', fontFamily: 'var(--font-ui)' }}>Notes</span>
              <span style={{ color: 'var(--t2)', font: '12.5px var(--font-ui)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {taskNotes.map((n) => noteTitle(n) || 'Untitled').join(', ')} · attached as context
              </span>
            </>
          ) : null}
        </div>
        <div
          style={{
            margin: '10px 20px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <div style={{ font: '12px var(--font-ui)', color: 'var(--t3)' }}>
            First message to {agentName} <span style={{ color: 'var(--t4)' }}>— prefilled from the task</span>
          </div>
          <textarea
            value={start.message}
            onChange={(e) => dispatch({ type: 'SET_START_MESSAGE', message: e.target.value })}
            // A screenshot pasted or an image dropped here goes along (as a file the agent opens).
            onPaste={(e) => {
              pastedImages(e)
                .then((paths) => paths.length && dispatch({ type: 'SET_START_OPTIONS', patch: { images: [...start.images, ...paths] } }))
                .catch((err: unknown) => dispatch({ type: 'TOAST', text: `Could not keep the image: ${errText(err)}` }))
            }}
            onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
            onDrop={(e) => {
              const paths = droppedImages(e)
              if (paths.length) dispatch({ type: 'SET_START_OPTIONS', patch: { images: [...start.images, ...paths] } })
            }}
            // A long description shows its start; the rest scrolls (all of it goes to the agent).
            rows={Math.min(6, Math.max(2, start.message.split('\n').length))}
            style={{
              border: '1px solid var(--bd-2)',
              borderRadius: 6,
              padding: '10px 12px',
              font: '13px/1.5 var(--font-ui)',
              color: 'var(--t1)',
              background: 'var(--bg-input)',
              minHeight: 58,
              resize: 'vertical',
              outline: 'none'
            }}
          />
          <Images />
        </div>
      </div>
      <ModalFooter style={{ marginTop: 16 }}>
        <FooterNote tone={full || waiting ? 'info' : undefined}>
          {waiting
            ? `${waiting.key} hasn't started yet - this waits in the queue and starts from its branch once ${waiting.key} is in Review.`
            : full
              ? `${busy} agents are working (limit ${state.prefs.maxAgents}) - this waits in the queue and starts when one is free.`
              : parent && !parentFinished(task, state.tasks)
                ? `${parent.key} is still in progress - this starts from its branch as it is now; Update brings in its later commits.`
                : start.inPlace
                  ? `Launches ${agentName} in ${project.name}'s folder and opens the workspace.`
                  : start.existingWorktree
                    ? `Takes over the worktree, launches ${agentName} there, opens the workspace.`
                  : `Creates the worktree and branch, runs setup, launches ${agentName}, opens the workspace.`}
        </FooterNote>
        <Button size="lg" onClick={() => dispatch({ type: 'CLOSE_START_MODAL' })}>
          Cancel
        </Button>
        <Button size="lg" variant="primary" hint="⌘↵" onClick={() => dispatch({ type: 'LAUNCH_START' })}>
          {waiting ? `Queue after ${waiting.key} ·` : full ? 'Queue for' : 'Start with'} {agentName}
        </Button>
      </ModalFooter>
    </>
  )
}

/** The task's projects in the Start modal: home first, then the ones added here. */
function startRepos(state: { start: { repos: string[] } | null; projects: Project[] }, task: Task): Project[] {
  const ids = [task.projectId, ...(state.start?.repos ?? [])]
  return ids.map((id) => state.projects.find((p) => p.id === id)).filter((p): p is Project => !!p)
}

/** The Repos row: the home repository, the ones added (×), and "+ Add repo". */
function RepoPicker({ task, project, agentName }: { task: Task; project: Project; agentName: string }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const start = state.start!
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const repos = startRepos(state, task)
  const others = state.projects.filter((p) => p.repoPath && !repos.some((r) => r.id === p.id))
  const pill: React.CSSProperties = {
    height: 22,
    padding: '0 4px 0 8px',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    background: 'var(--bd-row)',
    border: '1px solid var(--bd-3)',
    boxSizing: 'border-box',
    color: 'var(--t1)',
    font: `12px ${MONO}`
  }
  return (
    <>
      <span style={{ color: 'var(--t4)', fontFamily: 'var(--font-ui)', alignSelf: 'start', lineHeight: '22px' }}>Repos</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minWidth: 0 }}>
        {repos.map((p) => (
          <span key={p.id} style={pill}>
            {p.name}
            {p.id === project.id ? (
              <span style={{ color: 'var(--t4)', font: '10.5px var(--font-ui)', padding: '0 4px 0 3px' }}>home</span>
            ) : (
              <HoverX onClick={() => dispatch({ type: 'SET_START_REPOS', repos: start.repos.filter((r) => r !== p.id) })} />
            )}
          </span>
        ))}
        {others.length ? (
          <HoverSpan
            onClick={(e) => {
              const el = e.currentTarget
              setMenu((m) => (m ? null : { el }))
            }}
            style={{ height: 22, padding: '0 8px', borderRadius: 4, border: '1px dashed var(--bd-4)', boxSizing: 'border-box', color: 'var(--t2)', font: '12px var(--font-ui)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            hover={{ color: 'var(--t1)', borderColor: 'var(--bd-6)' }}
          >
            + Add repo
          </HoverSpan>
        ) : null}
        {repos.length > 1 ? (
          <span style={{ font: '11.5px/1.4 var(--font-ui)', color: 'var(--t3)', flexBasis: '100%', marginTop: 2, textWrap: 'pretty' } as React.CSSProperties}>
            One branch in each repo, one {agentName} session that sees them as sibling folders.
          </span>
        ) : null}
      </div>
      {menu ? (
        <Menu
          anchor={menu}
          width={260}
          items={others.map((p) => ({ label: p.name, sub: p.lang ?? '', onClick: () => dispatch({ type: 'SET_START_REPOS', repos: [...start.repos, p.id] }) }))}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  )
}

function HoverX({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <HoverSpan onClick={onClick} title="Remove" style={{ color: 'var(--t3)', padding: '0 4px', borderRadius: 3, cursor: 'pointer', fontFamily: 'var(--font-ui)' }} hover={{ color: 'var(--t1)', background: 'color-mix(in srgb, var(--ov) 8%, transparent)' }}>
      ×
    </HoverSpan>
  )
}

function HoverSpan({
  onClick,
  title,
  style,
  hover,
  children
}: {
  onClick: (e: React.MouseEvent<HTMLSpanElement>) => void
  title?: string
  style: React.CSSProperties
  hover: React.CSSProperties
  children: React.ReactNode
}): React.JSX.Element {
  const [on, hoverProps] = useHover()
  return (
    <span onClick={onClick} title={title} {...hoverProps} style={{ ...style, ...(on ? hover : null) }}>
      {children}
    </span>
  )
}

interface AgentChoice {
  kind: AgentKind
  name: string
  note: string
  meta: string
  missing: boolean
}

/**
 * The agent: the chosen one as a row, the others in a dropdown (the number
 * keys pick them too, as the list shows).
 */
function AgentPicker({ agents, value, onChange }: { agents: AgentChoice[]; value: AgentKind; onChange: (k: AgentKind) => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const i = Math.max(0, agents.findIndex((a) => a.kind === value))
  const a = agents[i]
  return (
    <>
      <div
        role="button"
        aria-haspopup="listbox"
        aria-expanded={!!menu}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          const el = e.currentTarget
          setMenu((m) => (m ? null : { el }))
        }}
        {...hoverProps}
        style={{
          display: 'grid',
          gridTemplateColumns: '22px 1fr auto 12px',
          gap: 12,
          alignItems: 'center',
          padding: '9px 10px',
          borderRadius: 6,
          background: hover || menu ? 'var(--bd-row)' : 'color-mix(in srgb, var(--c-blue) 8%, transparent)',
          boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--c-blue) 45%, transparent)',
          cursor: 'pointer'
        }}
      >
        <span style={{ font: `500 11.5px ${MONO}`, color: 'var(--c-blue)', textAlign: 'center', border: '1px solid var(--bd-4)', borderRadius: 4, lineHeight: '18px' }}>{i + 1}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ font: '500 13.5px var(--font-ui)', color: 'var(--t1)' }}>{a?.name ?? value}</span>
          <span style={{ font: '12px var(--font-ui)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a?.note}</span>
        </div>
        <span style={{ font: `11.5px ${MONO}`, color: a?.missing ? 'var(--c-amber)' : 'var(--t4)' }}>{a?.meta}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ color: 'var(--t3)' }}>
          <path d="M2.5 3.8 5 6.3l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {menu ? (
        <Menu
          anchor={menu}
          width={(menu as { el: HTMLElement }).el.offsetWidth}
          initialActive={i}
          items={agents.map((x, n) => ({ label: x.name, sub: x.meta, shortcut: String(n + 1), checked: x.kind === value, onClick: () => onChange(x.kind) }))}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  )
}

function LaunchPhase({ task, project, head, wtPath, agentName }: PhaseProps): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const start = state.start!
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [])

  const setup = start.setup
  const setupFailed = setup?.status === 'failed'
  const setupDetail = !project.setupCmd
    ? 'no setup command'
    : setupFailed
      ? `exited with code ${setup.exitCode ?? '?'}${setup.line ? ' · ' + setup.line : ''}`
      : setup?.status === 'running' && setup.line
        ? setup.line
        : project.setupCmd

  const elapsed = start.launchedAt ? ((now - start.launchedAt) / 1000).toFixed(1) + 's' : '0.0s'
  const bi = start.branchInfo
  const branchDetail = !bi
    ? `${start.branch} from ${head}`
    : bi.existed
      ? `${start.branch} · already there, reused`
      : `${start.branch} from ${bi.base} @ ${bi.sha}${bi.behindRemote ? ` · ${bi.base} is ${bi.behindRemote} behind origin` : ''}`
  const steps: [string, string][] = [
    ['Create branch', start.inPlace ? 'none - it works on what’s checked out in the project folder' : start.existingWorktree ? `none - ${start.branch}, as it is in that worktree` : bi?.fromOrigin ? `${start.branch} · checked out from origin/${start.branch}` : branchDetail],
    ['Add worktree', start.inPlace ? `none - ${project.repoPath}` : start.existingWorktree ? `takes over ${start.existingWorktree}` : start.copied.length ? `${wtPath} · copied ${start.copied.join(', ')}` : wtPath],
    ['Run setup', start.inPlace ? 'skipped - the project folder is yours, set up already' : start.existingWorktree ? 'skipped - that worktree is set up already' : setupDetail],
    [`Launch ${agentName}`, `with first message from ${task.key}`],
    ['Open workspace', '']
  ]

  return (
    <>
      <ModalHeader kicker={`Starting · ${task.key} · ${agentName}`} hint={elapsed} title={task.title} />
      <div
        style={{
          padding: '18px 20px 8px',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {steps.map(([title, stepDetail], i) => {
          let detail = stepDetail
          const done = i < start.step
          const run = i === start.step
          const failed = run && ((i === 2 && setupFailed) || !!start.error)
          if (run && start.error) detail = start.error
          const c = failed ? 'var(--c-red)' : done ? 'var(--c-green)' : run ? 'var(--c-amber)' : 'var(--bd-5)'
          return (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '16px 1fr',
                gap: 12
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center'
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    border: `1.5px solid ${c}`,
                    background: failed ? 'var(--c-red)' : done ? 'var(--c-green)' : 'transparent',
                    color: 'var(--bg-app)',
                    font: `600 9px/11px ${MONO}`,
                    textAlign: 'center',
                    boxSizing: 'border-box',
                    flex: 'none',
                    transition: 'all .2s'
                  }}
                >
                  {failed ? '!' : done ? '✓' : ''}
                </span>
                <span
                  style={{
                    flex: 1,
                    width: 1,
                    background: 'var(--bd-3)',
                    minHeight: 10
                  }}
                />
              </div>
              <div style={{ paddingBottom: 14, minWidth: 0 }}>
                <div
                  style={{
                    font: '13.5px var(--font-ui)',
                    color: done || run ? 'var(--t1)' : 'var(--t3)'
                  }}
                >
                  {title}
                </div>
                <div
                  style={{
                    font: `12px ${MONO}`,
                    color: failed ? 'var(--c-red)' : 'var(--t3)',
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {detail}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <ModalFooter>
        {start.error ? (
          <>
            <FooterNote tone="danger">{steps[start.step]?.[0] ?? 'This step'} failed. Cancel removes what was created so far.</FooterNote>
            <Button size="lg" onClick={() => dispatch({ type: 'CLOSE_START_MODAL' })}>
              Cancel
            </Button>
            <Button size="lg" variant="primary" onClick={() => dispatch({ type: 'LAUNCH_RETRY' })}>
              Retry
            </Button>
          </>
        ) : setupFailed ? (
          <>
            <FooterNote tone="danger">Setup failed. Cancel removes the new worktree and branch.</FooterNote>
            <Button size="lg" onClick={() => dispatch({ type: 'CLOSE_START_MODAL' })}>
              Cancel
            </Button>
            <Button size="lg" variant="primary" onClick={() => dispatch({ type: 'LAUNCH_ANYWAY' })}>
              Launch anyway
            </Button>
          </>
        ) : (
          <>
            <FooterNote>The workspace opens when {agentName} is ready.</FooterNote>
            <Button size="lg" hint="esc" onClick={() => dispatch({ type: 'BACKGROUND_START' })}>
              Keep in background
            </Button>
          </>
        )}
      </ModalFooter>
    </>
  )
}

/** The model for this task (empty: the agent's default), and - for agents that can - plan first. */
function ModelField(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const start = state.start!
  const options = MODEL_SUGGESTIONS[start.agentKind] ?? []
  const set = (model: string): void => dispatch({ type: 'SET_START_OPTIONS', patch: { model } })
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <Combo
        value={start.model}
        onChange={set}
        placeholder="default"
        style={FIELD}
        items={() => [
          { label: 'Default', sub: "the agent's own", checked: !start.model.trim(), onClick: () => set('') },
          ...options.map((m, i) => ({ label: m, checked: m === start.model.trim(), separatorBefore: i === 0, onClick: () => set(m) }))
        ]}
      />
      {canPlanFirst(start.agentKind) ? (
        <label title="It plans first and waits for your go-ahead before changing anything (plan mode)" style={{ display: 'flex', alignItems: 'center', gap: 5, font: '12px var(--font-ui)', color: 'var(--t2)', cursor: 'pointer', flex: 'none' }}>
          <input type="checkbox" checked={start.planFirst} onChange={(e) => dispatch({ type: 'SET_START_OPTIONS', patch: { planFirst: e.target.checked } })} />
          Plan first
        </label>
      ) : null}
    </span>
  )
}

/** Images going with the first message: chips to remove, and Attach. */
function Images(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const start = state.start!
  const set = (images: string[]): void => dispatch({ type: 'SET_START_OPTIONS', patch: { images } })
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', font: '12px var(--font-ui)', color: 'var(--t3)' }}>
      {start.images.map((p) => (
        <span key={p} title={p} style={{ display: 'flex', alignItems: 'center', gap: 4, height: 22, padding: '0 4px 0 8px', borderRadius: 4, border: '1px solid var(--bd-3)', background: 'var(--bd-row)', color: 'var(--t2)', font: `11.5px ${MONO}` }}>
          {fileName(p)}
          <HoverX onClick={() => set(start.images.filter((x) => x !== p))} />
        </span>
      ))}
      <HoverSpan
        onClick={() => window.api.dialog.pickImages().then((paths) => paths.length && set([...start.images, ...paths]))}
        style={{ cursor: 'pointer', color: 'var(--t3)' }}
        hover={{ color: 'var(--t1)' }}
      >
        + Attach image
      </HoverSpan>
      {!start.images.length ? <span style={{ color: 'var(--t4)' }}>or paste a screenshot into the message</span> : null}
    </div>
  )
}

/** "main is 3 behind origin · Pull": brings the base branch up to date before the task branches from it. */
function PullBase({ projectId, behind }: { projectId: string; behind: number }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [busy, setBusy] = useState(false)
  const base = state.base[projectId]?.base ?? 'main'
  return (
    <span style={{ flex: 'none', font: '11.5px var(--font-ui)', color: 'var(--c-amber)' }}>
      {behind} behind origin ·{' '}
      <HoverSpan
        onClick={() => {
          if (busy) return
          setBusy(true)
          window.api.base
            .pull(projectId)
            .then((s) => {
              if (s) dispatch({ type: 'BASE_STATUS', statuses: [s] })
              dispatch({ type: 'TOAST', text: `Pulled ${base} - the task starts from the latest.` })
            })
            .catch((err: unknown) => dispatch({ type: 'TOAST', text: `Could not pull ${base}: ${errText(err)}` }))
            .finally(() => setBusy(false))
        }}
        style={{ cursor: 'pointer', textDecoration: 'underline' }}
        hover={{ color: 'var(--t1)' }}
      >
        {busy ? 'pulling…' : 'pull first'}
      </HoverSpan>
    </span>
  )
}

/** The underlined field look of the Start modal's rows. */
const FIELD: React.CSSProperties = { flex: 1, minWidth: 0, borderBottom: '1px dashed var(--bd-4)', color: 'var(--t1)', font: `12.5px ${MONO}`, padding: '0 0 1px' }

const normPath = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Who has a folder: an open task (not this one) that works in it. */
function holderOf(tasks: Task[], path: string, self: string): Task | undefined {
  const p = normPath(path)
  return tasks.find((t) => t.id !== self && t.col !== 'done' && [t.worktreePath, t.taskDir].some((x) => x && normPath(x) === p))
}

/** The project's branches, and the worktrees no open task holds (to take over). */
function useStartPlaces(project: Project, task: Task): { branches: BranchInfo[]; free: GitWorktreeInfo[] } {
  const { state } = useAppStore()
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [trees, setTrees] = useState<GitWorktreeInfo[]>([])
  const base = baseFor(task, project, state.tasks)
  useEffect(() => {
    let cancelled = false
    window.api.git.listBranches(project.repoPath, base).then((b) => !cancelled && setBranches(b)).catch(() => {})
    window.api.git.listWorktrees(project.repoPath).then((w) => !cancelled && setTrees(w)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [project.repoPath, base])
  const free = trees.filter((w) => !w.isMain && !w.prunable && !holderOf(state.tasks, w.path, task.id))
  return { branches, free }
}

/**
 * The branch: a new one (its name typed), or one that's there already -
 * picked from the list (local ones, then ones only on origin). One checked
 * out in a free worktree brings that worktree along; one checked out in the
 * project folder or another task's can't be used.
 */
function BranchField({ task, project, branches, free }: { task: Task; project: Project; branches: BranchInfo[]; free: GitWorktreeInfo[] }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const start = state.start!
  const fresh = branchFor(prefsFor(state, task.projectId).branchPattern, task.title, task.key)
  const base = baseFor(task, project, state.tasks)
  const set = (branch: string, existingWorktree: string | null = null): void => {
    dispatch({ type: 'SET_START_OPTIONS', patch: { existingWorktree } })
    dispatch({ type: 'SET_START_BRANCH', branch })
    if (existingWorktree && start.repos.length) dispatch({ type: 'SET_START_REPOS', repos: [] })
  }
  const item = (b: BranchInfo): MenuItem => {
    const freeTree = b.worktree ? free.find((w) => normPath(w.path) === normPath(b.worktree!)) : undefined
    // Another open task's branch (in its worktree - or its folder gone, the branch is still its).
    const holder = (b.worktree ? holderOf(state.tasks, b.worktree, task.id) : undefined) ?? state.tasks.find((t) => t.id !== task.id && t.col !== 'done' && t.branch === b.name && reposOf(t).includes(project.id))
    const blocked = b.mainCheckout || !!holder || (!!b.worktree && !freeTree)
    return {
      label: b.name,
      sub: b.mainCheckout ? 'out in the project folder' : holder ? `${holder.key}'s` : freeTree ? 'in a worktree · takes it over' : b.at ? `${timeAgo(b.at)} ago` : '',
      disabled: blocked,
      checked: b.name === start.branch.trim(),
      onClick: () => set(b.name, freeTree ? freeTree.path : null)
    }
  }
  const local = branches.filter((b) => b.local)
  const remote = branches.filter((b) => !b.local)
  return (
    <Combo
      value={start.branch}
      onChange={(v) => set(v)}
      disabled={!!start.existingWorktree}
      title={start.existingWorktree ? `The branch of ${start.existingWorktree} - pick New under Worktree for another` : 'A new branch, or pick one that’s there already'}
      style={{ ...FIELD, color: start.existingWorktree ? 'var(--t2)' : 'var(--t1)' }}
      menuWidth={460}
      items={() => [
        { label: fresh, sub: `new, from ${base}`, checked: start.branch.trim() === fresh, onClick: () => set(fresh) },
        ...(local.length ? [{ label: 'Branches here', heading: true, onClick: () => {} }, ...local.map(item)] : []),
        ...(remote.length ? [{ label: 'Only on origin', heading: true, onClick: () => {} }, ...remote.map(item)] : [])
      ]}
    />
  )
}
