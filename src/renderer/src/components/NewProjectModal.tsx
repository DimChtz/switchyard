import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { LANGUAGES, prefixFor } from '@shared/constants'
import type { BrowseEntry, BrowsePlace, Project, RepoScan } from '@shared/types'
import { errText } from '../lib/errors'
import { Button, Modal, ModalFooter, Select, TextInput } from './ui'

const MONO = "var(--font-mono)"
const T1 = 'var(--t1)'
const T2 = 'var(--t2)'
const T3 = 'var(--t3)'
const G = 'var(--c-green)'
const B = 'var(--c-blue)'
const AMBER = 'var(--c-amber)'

const HOME = window.api.sys.homeDir
const SEP = window.electron.process.platform === 'win32' ? '\\' : '/'

/** Home-relative path for display: "~\code\app". */
function tildify(p: string): string {
  return p.toLowerCase().startsWith(HOME.toLowerCase()) ? '~' + p.slice(HOME.length) : p
}

function baseName(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/:]/).pop() || p
}

function parentOf(p: string): string | null {
  const t = p.replace(/[\\/]+$/, '')
  const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/'))
  if (i < 0) return null
  const parent = t.slice(0, i)
  return /^[A-Za-z]:$/.test(parent) ? parent + '\\' : parent || '/'
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith('\\') || dir.endsWith('/') ? dir + name : dir + SEP + name
}

const slug = (v: string): string => v.toLowerCase().replace(/[^a-z0-9-]/g, '')

interface Form {
  name: string
  lang: string
  prefix: string
  defaultBranch: string
  setupCmd: string
  testCmd: string
  devCmd: string
}

type Phase =
  | { kind: 'input' }
  | { kind: 'browse' }
  | { kind: 'scan'; input: string; clone: boolean; step: number; scan: RepoScan | null }
  | { kind: 'form'; scan: RepoScan; det: Form; form: Form }

export function NewProjectModal(): React.JSX.Element | null {
  const { state } = useAppStore()
  if (!state.addProjectOpen) return null
  return <Body />
}

function Body(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [phase, setPhase] = useState<Phase>({ kind: 'input' })
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [codeDir, setCodeDir] = useState(joinPath(HOME, 'code'))
  const scanToken = useRef(0)

  useEffect(() => {
    window.api.repos.recent().then(setRecent)
    window.api.repos.cloneDir().then(setCodeDir)
  }, [])

  const close = useCallback((): void => {
    scanToken.current++
    dispatch({ type: 'CLOSE_ADD_PROJECT' })
  }, [dispatch])

  const isAdded = (p: string): boolean => state.projects.some((x) => x.repoPath.toLowerCase() === p.replace(/[\\/]+$/, '').toLowerCase())

  const scan = async (input: string): Promise<void> => {
    const value = input.trim()
    if (!value) return setError('Enter a folder or Git URL')
    setError(null)
    setPath(value)
    const token = ++scanToken.current
    const clone = await window.api.repos.isUrl(value)
    setPhase({ kind: 'scan', input: value, clone, step: 0, scan: null })
    try {
      const dir = clone ? await window.api.repos.clone(value) : value
      if (token !== scanToken.current) return
      // The steps show as running while the scan (one quick pass) reads them.
      if (clone) setPhase({ kind: 'scan', input: value, clone, step: 1, scan: null })
      const s = await window.api.repos.scan(dir)
      if (token !== scanToken.current) return
      if (isAdded(s.path)) throw new Error(`${tildify(s.path)} is already in Switchyard`)
      const name = slug(baseName(s.path)) || 'project'
      const det: Form = {
        name,
        lang: s.meta.lang,
        prefix: prefixFor(name, state.projects.map((p) => p.prefix)),
        defaultBranch: s.defaultBranch,
        setupCmd: s.meta.setupCmd ?? '',
        testCmd: s.meta.testCmd ?? '',
        devCmd: s.meta.devCmd ?? ''
      }
      setPhase({ kind: 'form', scan: s, det, form: det })
    } catch (err) {
      if (token !== scanToken.current) return
      setError(errText(err))
      setPhase({ kind: 'input' })
    }
  }

  const add = async (): Promise<void> => {
    if (phase.kind !== 'form') return
    const f = phase.form
    const s = phase.scan
    if (!f.name) return dispatch({ type: 'TOAST', text: 'Give the project a name' })
    if (state.projects.some((p) => p.id === f.name)) return dispatch({ type: 'TOAST', text: `${f.name} is already in Switchyard` })
    if (!f.prefix) return dispatch({ type: 'TOAST', text: 'Task prefix is required' })
    try {
      if (!s.isGit) await window.api.repos.init(s.path, f.defaultBranch || 'main')
      const project: Project = {
        id: f.name,
        name: f.name,
        repoPath: s.path,
        repo: s.isGit ? s.repo : f.name,
        lang: f.lang,
        prefix: f.prefix,
        defaultBranch: f.defaultBranch || 'main',
        setupCmd: f.setupCmd || undefined,
        testCmd: f.testCmd || undefined,
        devCmd: f.devCmd || undefined
      }
      await window.api.store.addProject(project)
      dispatch({ type: 'PROJECT_ADDED', project })
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not add the project: ${errText(err)}` })
    }
  }

  // This dialog owns the keyboard while it's open.
  const browseChoose = useRef<() => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        e.preventDefault()
        if (phase.kind === 'browse') setPhase({ kind: 'input' })
        else close()
      } else if (phase.kind === 'input' && mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        setPhase({ kind: 'browse' })
      } else if (phase.kind === 'form' && mod && e.key === 'Enter') {
        e.preventDefault()
        add()
      } else if (phase.kind === 'browse' && e.key === 'Enter') {
        e.preventDefault()
        browseChoose.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const kicker =
    phase.kind === 'input'
      ? 'New project'
      : phase.kind === 'browse'
        ? 'New project · choose a folder'
        : phase.kind === 'scan'
          ? `${phase.clone && phase.step === 0 ? 'Cloning' : 'Scanning'} · ${phase.clone ? phase.input : tildify(phase.input)}`
          : `New project · ${phase.scan.repo}`
  const heading =
    phase.kind === 'input' || phase.kind === 'browse' ? 'Add a repository' : phase.kind === 'scan' ? slug(baseName(phase.scan?.path ?? phase.input)) : 'Review detected settings'

  return (
    <Modal width={600} onClose={close} kicker={kicker} title={heading}>

        {phase.kind === 'input' ? (
          <InputPhase
            path={path}
            setPath={(v) => {
              setPath(v)
              setError(null)
            }}
            error={error}
            recent={recent}
            codeDir={codeDir}
            onScan={scan}
            onBrowse={() => setPhase({ kind: 'browse' })}
            onCancel={close}
          />
        ) : null}
        {phase.kind === 'browse' ? (
          <BrowsePhase isAdded={isAdded} registerChoose={(fn) => (browseChoose.current = fn)} onChoose={scan} onCancel={() => setPhase({ kind: 'input' })} />
        ) : null}
        {phase.kind === 'scan' ? <ScanPhase phase={phase} /> : null}
        {phase.kind === 'form' ? (
          <FormPhase
            det={phase.det}
            form={phase.form}
            onChange={(patch) => setPhase({ ...phase, form: { ...phase.form, ...patch } })}
            onBack={() => {
              scanToken.current++
              setPhase({ kind: 'input' })
            }}
            onAdd={add}
          />
        ) : null}
    </Modal>
  )
}

function Footer({ note, noteColor, noteMono, children }: { note: string; noteColor?: string; noteMono?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <ModalFooter>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          font: `12px/1.45 ${noteMono ? MONO : 'var(--font-ui)'}`,
          color: noteColor ?? T3,
          whiteSpace: noteMono ? 'nowrap' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textWrap: 'pretty'
        } as React.CSSProperties}
      >
        {note}
      </span>
      {children}
    </ModalFooter>
  )
}


function InputPhase({
  path,
  setPath,
  error,
  recent,
  codeDir,
  onScan,
  onBrowse,
  onCancel
}: {
  path: string
  setPath: (v: string) => void
  error: string | null
  recent: string[]
  codeDir: string
  onScan: (p: string) => void
  onBrowse: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <>
      <div style={{ padding: '16px 20px 6px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ font: '12px var(--font-ui)', color: T3 }}>Local folder or Git URL</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            autoFocus
            value={path}
            spellCheck={false}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onScan(path)
              }
            }}
            placeholder={`${tildify(joinPath(codeDir, 'app'))}  or  github.com/org/repo`}
            style={{
              flex: 1,
              minWidth: 0,
              height: 36,
              boxSizing: 'border-box',
              background: 'var(--bg-input)',
              border: `1px solid ${error ? 'color-mix(in srgb, var(--c-red) 60%, transparent)' : 'color-mix(in srgb, var(--c-blue) 60%, transparent)'}`,
              borderRadius: 6,
              padding: '0 12px',
              color: T1,
              font: `13px ${MONO}`,
              outline: 'none'
            }}
          />
          <Button hint="⌘O" onClick={onBrowse} style={{ height: 36, borderRadius: 6, color: T1 }}>
            Browse…
          </Button>
        </div>
        {error ? <div style={{ font: '12.5px var(--font-ui)', color: 'var(--c-red)' }}>{error}</div> : null}
      </div>
      {recent.length ? (
        <div style={{ padding: '10px 12px 6px', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <div style={{ font: `500 11px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)', padding: '0 8px 6px' }}>Recent folders</div>
          {recent.map((r) => (
            <HoverRow key={r} onClick={() => onScan(r)} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 32, padding: '0 8px', borderRadius: 6 }}>
              <span style={{ font: '500 13px var(--font-ui)', color: T1, width: 130, flex: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{baseName(r)}</span>
              <span style={{ flex: 1, minWidth: 0, font: `12px ${MONO}`, color: T3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tildify(r)}</span>
              <span style={{ font: `11px ${MONO}`, color: 'var(--t4)' }}>scan →</span>
            </HoverRow>
          ))}
        </div>
      ) : null}
      <div style={{ marginTop: 12 }}>
        <Footer note="Switchyard reads the repo to fill in language, branch and commands. Everything stays editable.">
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn primary hint="↵" onClick={() => onScan(path)}>
            Scan repository
          </Btn>
        </Footer>
      </div>
    </>
  )
}

function HoverRow({ onClick, style, children }: { onClick: () => void; style: React.CSSProperties; children: React.ReactNode }): React.JSX.Element {
  const [hover, setHover] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ ...style, cursor: 'pointer', background: hover ? 'var(--bd-row)' : 'transparent' }}>
      {children}
    </div>
  )
}

function BrowsePhase({
  isAdded,
  registerChoose,
  onChoose,
  onCancel
}: {
  isAdded: (p: string) => boolean
  registerChoose: (fn: () => void) => void
  onChoose: (p: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const { dispatch } = useAppStore()
  const [places, setPlaces] = useState<BrowsePlace[]>([])
  const [dir, setDir] = useState<string | null>(null)
  const [entries, setEntries] = useState<BrowseEntry[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)

  useEffect(() => {
    window.api.repos.places().then((p) => {
      setPlaces(p)
      // Start where the user keeps code (next to existing projects) if known.
      setDir((p[1] ?? p[0])?.path ?? HOME)
    })
  }, [])

  useEffect(() => {
    if (!dir) return
    let cancelled = false
    setEntries(null)
    setSel(null)
    setReadError(null)
    window.api.repos
      .browse(dir)
      .then((list) => !cancelled && setEntries(list))
      .catch(() => {
        if (cancelled) return
        setEntries([])
        setReadError("Can't read this folder")
      })
    return () => {
      cancelled = true
    }
  }, [dir])

  const list = [...(entries ?? [])].sort((a, b) => Number(!a.isDir) - Number(!b.isDir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  const selE = list.find((e) => e.name === sel)
  const target = selE ? selE.path : dir ?? ''
  const tAdded = !!selE && isAdded(target)

  const choose = (): void => {
    if (!selE) return dispatch({ type: 'TOAST', text: 'Select a folder first' })
    if (tAdded) return dispatch({ type: 'TOAST', text: `${tildify(target)} is already in Switchyard` })
    onChoose(target)
  }
  registerChoose(choose)

  const note = !dir
    ? ''
    : tAdded
      ? `${tildify(target)} is already in Switchyard`
      : selE
        ? selE.git
          ? `${tildify(target)} · git repository`
          : `${tildify(target)} · not a git repo — git init on add`
        : readError
          ? `${tildify(dir)} · ${readError.toLowerCase()}`
          : `${tildify(dir)} · select a folder`

  // Crumbs: "~" stands for the home folder.
  const crumbs: { label: string; path: string }[] = []
  if (dir) {
    const home = dir.toLowerCase().startsWith(HOME.toLowerCase())
    const rest = home ? dir.slice(HOME.length) : dir
    let acc = home ? HOME : ''
    if (home) crumbs.push({ label: '~', path: HOME })
    for (const part of rest.split(/[\\/]/).filter(Boolean)) {
      acc = acc ? joinPath(acc, part) : /^[A-Za-z]:$/.test(part) ? part + '\\' : '/' + part
      crumbs.push({ label: part, path: acc })
    }
    if (!crumbs.length) crumbs.push({ label: dir, path: dir })
  }
  const parent = dir ? parentOf(dir) : null
  const canUp = !!parent && parent !== dir

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr)', height: 340, borderBottom: '1px solid var(--bd-2)' }}>
        <div style={{ borderRight: '1px solid var(--bd-2)', background: 'var(--bg-panel-3)', padding: '10px 6px', display: 'flex', flexDirection: 'column', gap: 1, overflow: 'auto' }}>
          <div style={{ font: `500 11px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)', padding: '2px 8px 6px' }}>Places</div>
          {places.map((pl) => {
            const lower = dir?.toLowerCase() ?? ''
            const pLower = pl.path.toLowerCase()
            // Highlight the most specific place containing the current folder.
            const best = places
              .filter((x) => lower === x.path.toLowerCase() || lower.startsWith(x.path.toLowerCase().replace(/[\\/]$/, '') + SEP))
              .sort((a, b) => b.path.length - a.path.length)[0]
            const on = best?.path.toLowerCase() === pLower
            return <PlaceRow key={pl.path} label={pl.label} on={on} onClick={() => setDir(pl.path)} />
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <div style={{ height: 36, flex: 'none', display: 'flex', alignItems: 'center', gap: 2, padding: '0 10px', borderBottom: '1px solid var(--bd-2)', font: `12px ${MONO}`, overflow: 'hidden' }}>
            <span
              onClick={() => canUp && setDir(parent)}
              title="Up"
              style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, color: canUp ? T2 : 'var(--bd-5)', cursor: 'pointer', marginRight: 4, flex: 'none' }}
            >
              ↑
            </span>
            {crumbs.map((c, i) => (
              <span key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>
                <span onClick={() => setDir(c.path)} style={{ padding: '2px 5px', borderRadius: 3, color: i === crumbs.length - 1 ? T1 : T2, cursor: 'pointer' }}>
                  {c.label}
                </span>
                {i < crumbs.length - 1 ? <span style={{ color: 'var(--t5)' }}>{SEP === '\\' ? '\\' : '/'}</span> : null}
              </span>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 6 }}>
            {list.map((e) => {
              const added = e.isDir && isAdded(e.path)
              const selected = sel === e.name
              return (
                <EntryRow
                  key={e.name}
                  entry={e}
                  added={added}
                  selected={selected}
                  onClick={() => e.isDir && setSel(e.name)}
                  onDouble={() => {
                    if (!e.isDir) return
                    if (e.git || e.items === 0) {
                      if (!added) onChoose(e.path)
                    } else setDir(e.path)
                  }}
                />
              )
            })}
            {entries && list.length === 0 ? <div style={{ padding: '14px 10px', font: '12.5px var(--font-ui)', color: T3 }}>{readError ?? 'This folder is empty'}</div> : null}
          </div>
        </div>
      </div>
      <div style={{ padding: '12px 20px', background: 'var(--bg-panel-3)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1, minWidth: 0, font: `12px/1.45 ${MONO}`, color: tAdded ? AMBER : selE ? T2 : T3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note}</span>
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn primary hint="↵" disabled={!selE || tAdded} onClick={choose}>
          Choose folder
        </Btn>
      </div>
    </>
  )
}

function PlaceRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): React.JSX.Element {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: 26,
        padding: '0 8px',
        borderRadius: 5,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: on ? 'color-mix(in srgb, var(--ov) 7%, transparent)' : 'transparent',
        color: on || hover ? T1 : T2,
        fontSize: 12.5,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        overflow: 'hidden'
      }}
    >
      <span style={{ width: 12, height: 9, border: `1.5px solid ${on ? B : 'var(--t5)'}`, borderRadius: 2, boxSizing: 'border-box', flex: 'none' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </div>
  )
}

function EntryRow({ entry: e, added, selected, onClick, onDouble }: { entry: BrowseEntry; added: boolean; selected: boolean; onClick: () => void; onDouble: () => void }): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const meta = !e.isDir ? '' : added ? 'in Switchyard' : e.git ? `git · ${e.git}` : e.items != null && e.items > 0 ? `${e.items} items` : ''
  const hov = !e.isDir ? 'transparent' : selected ? 'color-mix(in srgb, var(--c-blue) 16%, transparent)' : 'var(--bd-row)'
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDouble}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: 30,
        padding: '0 10px',
        borderRadius: 5,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: hover ? hov : selected ? 'color-mix(in srgb, var(--c-blue) 12%, transparent)' : 'transparent',
        boxShadow: `inset 0 0 0 1px ${selected ? 'color-mix(in srgb, var(--c-blue) 45%, transparent)' : 'transparent'}`,
        cursor: e.isDir ? 'pointer' : 'default',
        userSelect: 'none'
      }}
    >
      {e.isDir ? (
        <span
          style={{
            width: 14,
            height: 11,
            border: `1.5px solid ${e.git ? B : 'var(--t4)'}`,
            borderRadius: 2,
            boxSizing: 'border-box',
            flex: 'none',
            background: e.git ? 'color-mix(in srgb, var(--c-blue) 12%, transparent)' : 'transparent'
          }}
        />
      ) : (
        <span style={{ width: 10, height: 13, border: '1.5px solid var(--bd-5)', borderRadius: 2, boxSizing: 'border-box', flex: 'none', margin: '0 2px' }} />
      )}
      <span style={{ flex: 1, minWidth: 0, font: '13px var(--font-ui)', color: !e.isDir || added ? T3 : T1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
      <span style={{ font: `11px ${MONO}`, color: e.git && !added ? G : 'var(--t4)', whiteSpace: 'nowrap' }}>{meta}</span>
      {e.isDir ? <span style={{ font: `11px ${MONO}`, color: 'var(--t5)', width: 10, textAlign: 'right' }}>›</span> : null}
    </div>
  )
}

function ScanPhase({ phase }: { phase: Extract<Phase, { kind: 'scan' }> }): React.JSX.Element {
  const s = phase.scan
  const m = s?.meta
  const found = (cmd?: string, src?: string): string => (cmd ? `${cmd} · ${src ?? 'repository'}` : 'none found')
  const steps: [string, string][] = [
    ...(phase.clone ? [['Cloning repository', s ? tildify(s.path) : phase.input] as [string, string]] : []),
    ['Reading repository', s ? (s.isGit ? `${s.repo} · HEAD → ${s.defaultBranch}` : 'not a git repository · git init on add') : ''],
    ['Detecting language', m ? (m.lang ? `${m.lang} · ${m.src.lang}` : 'nothing recognised · set it below') : ''],
    ['Setup command', found(m?.setupCmd, m?.src.setupCmd)],
    ['Test runner', found(m?.testCmd, m?.src.testCmd)],
    ['Dev server', found(m?.devCmd, m?.src.devCmd)]
  ]
  return (
    <div style={{ padding: '18px 20px 8px', display: 'flex', flexDirection: 'column' }}>
      {steps.map(([t, d], i) => {
        const done = i < phase.step
        const cur = i === phase.step
        const c = done ? G : cur ? B : 'var(--bd-4)'
        return (
          <div key={t} style={{ display: 'grid', gridTemplateColumns: '16px 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  border: `1.5px solid ${c}`,
                  background: done ? G : 'transparent',
                  color: 'var(--bg-app)',
                  font: `600 9px/11px ${MONO}`,
                  textAlign: 'center',
                  boxSizing: 'border-box',
                  flex: 'none',
                  transition: 'all .2s'
                }}
              >
                {done ? '✓' : ''}
              </span>
              <span style={{ flex: 1, width: 1, background: 'var(--bd-3)', minHeight: 10 }} />
            </div>
            <div style={{ paddingBottom: 14, minWidth: 0 }}>
              <div style={{ font: '13.5px var(--font-ui)', color: done || cur ? T1 : 'var(--t3)' }}>{t}</div>
              <div style={{ font: `12px ${MONO}`, color: T3, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {done ? d : cur ? (phase.clone && i === 0 ? 'cloning…' : 'scanning…') : ''}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FormPhase({ det, form, onChange, onBack, onAdd }: { det: Form; form: Form; onChange: (p: Partial<Form>) => void; onBack: () => void; onAdd: () => void }): React.JSX.Element {
  const field = (label: string, key: keyof Form, o: { select?: string[]; ph?: string; noTag?: boolean; fmt?: (v: string) => string } = {}): React.JSX.Element => {
    const v = form[key]
    const same = v === det[key]
    const tag = o.noTag ? '' : same ? (v ? 'detected' : '') : 'edited'
    const input = {
      height: 30,
      boxSizing: 'border-box' as const,
      width: '100%',
      background: 'var(--bg-input)',
      border: '1px solid var(--bd-3)',
      borderRadius: 5,
      color: T1,
      outline: 'none'
    }
    return (
      <div key={key} style={{ display: 'contents' }}>
        <span style={{ font: '12.5px var(--font-ui)', color: T2 }}>{label}</span>
        <div style={{ minWidth: 0 }}>
          {o.select ? (
            <Select
              value={v}
              onChange={(x) => onChange({ [key]: x })}
              options={[...new Set([v, ...o.select].filter(Boolean))].map((x) => [x, x] as [string, string])}
              style={{ ...input, width: '100%', padding: '0 10px', font: '12.5px var(--font-ui)' }}
            />
          ) : (
            <FocusInput value={v} placeholder={o.ph} onChange={(x) => onChange({ [key]: o.fmt ? o.fmt(x) : x })} style={{ ...input, padding: '0 10px', font: `12.5px ${MONO}` }} />
          )}
        </div>
        <span style={{ font: `11px ${MONO}`, color: same ? G : AMBER, textAlign: 'right' }}>{tag}</span>
      </div>
    )
  }
  return (
    <>
      <div style={{ padding: '16px 20px 4px', display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 64px', columnGap: 12, rowGap: 8, alignItems: 'center' }}>
        {field('Name', 'name', { noTag: true, fmt: slug })}
        {field('Language', 'lang', { select: LANGUAGES })}
        {field('Task prefix', 'prefix', { fmt: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) })}
        {field('Default branch', 'defaultBranch')}
        {field('Setup', 'setupCmd', { ph: 'none' })}
        {field('Test', 'testCmd', { ph: 'none' })}
        {field('Dev server', 'devCmd', { ph: 'none' })}
      </div>
      <div style={{ marginTop: 14 }}>
        <Footer note="Change anything now, or later in Project settings.">
          <Btn onClick={onBack}>Back</Btn>
          <Btn primary hint="⌘↵" onClick={onAdd}>
            Add project
          </Btn>
        </Footer>
      </div>
    </>
  )
}

function FocusInput({ value, placeholder, onChange, style }: { value: string; placeholder?: string; onChange: (v: string) => void; style: React.CSSProperties }): React.JSX.Element {
  // The kit input draws the border (and its focus ring).
  const { border: _border, borderColor: _borderColor, ...rest } = style
  return <TextInput value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={rest} />
}

function Btn({ primary, hint, disabled, onClick, children }: { primary?: boolean; hint?: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <Button size="lg" variant={primary ? 'primary' : 'secondary'} hint={hint} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  )
}
