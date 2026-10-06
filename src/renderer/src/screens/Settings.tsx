import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { plural } from '../lib/summary'
import { codeTheme } from '../lib/codeTheme'
import CodeMirror from '@uiw/react-codemirror'
import { EditorState } from '@codemirror/state'
import { editorBasicSetup, editorExtensions, installedEditorFonts } from '../lib/editorPrefs'
import { languageFor } from '../lib/fileLang'
import { nextTaskKey } from '../lib/derive'
import { TrustStrip } from '../components/TrustStrip'
import { useAppStore } from '../store/AppStore'
import { removeProject } from '../lib/taskActions'
import { prefsFor } from '../lib/projectPrefs'
import { allKeyCommands, bindings, shortcut } from '../lib/shortcuts'
import { isMac } from '../lib/keys'
import { chordId, eventChord, formatKey, normalizeKey, type ResolvedBinding } from '@shared/keybindings'
import { errText } from '../lib/errors'
import { useHover } from '../lib/useHover'
import { useActiveTheme, useThemes } from '../lib/theme'
import type { Theme } from '@shared/themes'
import { priceOf, type ModelPrice } from '@shared/usage'
import { useUsage } from '../lib/usage'
import { Button, FooterNote, IconButton, Menu, Modal, Segmented, SectionLabel, Select as MenuSelect, TextArea as UITextArea, TextInput, Toggle as UIToggle, confirm, type MenuAnchor } from '../components/ui'
import { askInstall, usePlugins } from '../lib/plugins'
import type { PluginInfo, PluginSource } from '@shared/plugins'
import { AGENTS, APP_PREF_KEYS, DEFAULT_MESSAGE_TEMPLATE, LANGUAGES, PROJECT_SETTING_KEYS, firstMessage, parseEnv } from '@shared/constants'
import type { AgentKind, EditorOption, NoticeKind, Prefs, Project, ProjectSettingKey, ProjectSettingScope, RepoScan, ShellOption } from '@shared/types'

const MONO = "var(--font-mono)"
const G = 'var(--c-green)'

const SECTIONS: [string, string][] = [
  ['general', 'General'],
  ['appearance', 'Appearance'],
  ['agents', 'Agents'],
  ['git', 'Git & worktrees'],
  ['terminal', 'Terminal & editor'],
  ['editor', 'File editor'],
  ['keys', 'Keyboard shortcuts'],
  ['plugins', 'Plugins']
]

export function Settings(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const sec = state.settingsSection
  const project = sec.startsWith('project:') ? state.projects.find((p) => p.id === sec.slice(8)) : undefined
  // Preferences for everyone (settings.json) or one project (its .switchyard files).
  const [scopeId, setScopeId] = useState('')
  const scopeProject = state.projects.find((p) => p.id === scopeId) ?? null

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)' }}>
      <div style={{ borderRight: '1px solid var(--bd-1)', padding: '22px 10px', display: 'flex', flexDirection: 'column', gap: 1, overflow: 'auto' }}>
        <NavHeading first>Preferences</NavHeading>
        {SECTIONS.map(([k, l]) => (
          <NavRow key={k} label={l} active={sec === k} onClick={() => dispatch({ type: 'OPEN_SETTINGS', section: k })} />
        ))}
        <NavHeading>Projects</NavHeading>
        {state.projects.map((p) => (
          <NavRow key={p.id} label={p.name} active={sec === `project:${p.id}`} onClick={() => dispatch({ type: 'OPEN_SETTINGS', section: `project:${p.id}` })} />
        ))}
        <HoverText onClick={() => dispatch({ type: 'OPEN_ADD_PROJECT' })} style={{ height: 28, padding: '0 10px', display: 'flex', alignItems: 'center', fontSize: 13, marginTop: 4 }}>
          + Add project…
        </HoverText>
      </div>
      <div style={{ overflow: 'auto', padding: '28px 40px 64px', minWidth: 0 }}>
        <div style={{ maxWidth: 780, display: 'flex', flexDirection: 'column', gap: 26 }}>
          {project ? (
            <ProjectSettings key={project.id} project={project} />
          ) : sec === 'keys' ? (
            <KeyboardShortcuts />
          ) : sec === 'plugins' ? (
            <PluginsSettings />
          ) : sec === 'appearance' ? (
            <Appearance />
          ) : (
            <GlobalSettings section={sec} scope={scopeProject} onScope={setScopeId} />
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- global preferences ---------- */

function GlobalSettings({ section, scope, onScope }: { section: string; scope: Project | null; onScope: (id: string) => void }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  // For a project: its own values over the user's, saved in its settings file.
  const pf = scope ? prefsFor(state, scope.id) : state.prefs
  const saveToProject = (p: Project, patch: Partial<Prefs>, targets: (k: keyof Prefs) => 'shared' | 'local' | undefined): void => {
    const groups: Record<'shared' | 'local', Record<string, unknown>> = { shared: {}, local: {} }
    const prefs: Record<string, unknown> = { ...p.prefs }
    const sources = { ...p.sources }
    for (const [k, v] of Object.entries(patch) as [keyof Prefs, unknown][]) {
      const to = targets(k)
      if (to) {
        groups[to][k] = v
        prefs[k] = v
        sources[k] = to
      } else {
        // Removed: back to the user's value.
        const from = p.sources?.[k]
        if (from) groups[from][k] = undefined
        delete prefs[k]
        delete sources[k]
      }
    }
    dispatch({ type: 'UPDATE_PROJECT', id: p.id, patch: { prefs: Object.keys(prefs).length ? (prefs as Partial<Prefs>) : undefined, sources } })
    ;(async () => {
      let latest: Project | null = null
      for (const to of ['shared', 'local'] as const) if (Object.keys(groups[to]).length) latest = await window.api.projects.setSettings(p.id, to, groups[to])
      if (latest) dispatch({ type: 'UPDATE_PROJECT', id: p.id, patch: latest })
    })().catch((err: unknown) => {
      toastErr(err)
      window.api.store.getProjects().then((projects) => dispatch({ type: 'PROJECTS_LOADED', projects }))
    })
  }
  const set = (patch: Partial<Prefs>): void => {
    if (!scope) return dispatch({ type: 'SET_PREFS', patch })
    // A value stays in the file it's in; a new one goes to the shared file, like .vscode/settings.json.
    saveToProject(scope, patch, (k) => scope.sources?.[k] ?? 'shared')
  }
  const scopeValue: PrefScopeValue = {
    project: scope,
    overriddenIn: (k) => state.projects.filter((p) => p.prefs && k in p.prefs),
    reset: (k) => scope && saveToProject(scope, { [k]: undefined } as Partial<Prefs>, () => undefined),
    move: (k, to) => {
      if (!scope) return
      const from = scope.sources?.[k]
      if (!from || from === to) return
      ;(async () => {
        await window.api.projects.setSettings(scope.id, to, { [k]: scope.prefs?.[k] })
        const latest = await window.api.projects.setSettings(scope.id, from, { [k]: undefined })
        if (latest) dispatch({ type: 'UPDATE_PROJECT', id: scope.id, patch: latest })
      })().catch(toastErr)
    },
    pick: onScope
  }
  // Everything here is kept in settings.json - or, for a project, its .switchyard/settings.json.
  const userFile = scope
    ? {
        label: '.switchyard/settings.json',
        title: `Open ${scope.name}'s shared settings file`,
        open: () => window.api.projects.openSettingsFile(scope.id, 'shared').catch(toastErr)
      }
    : {
        label: 'settings.json',
        title: 'Open settings.json - the settings of this machine, as JSON',
        open: () => window.api.settings.openUserFile().catch(toastErr)
      }
  const scopePicker = (
    <ScopePicker scope={scope} projects={state.projects} onScope={onScope} />
  )
  const scopeSub = `For ${scope?.name}, over your user settings`
  const wrap = (page: React.JSX.Element): React.JSX.Element => <PrefScope.Provider value={scopeValue}>{page}</PrefScope.Provider>
  const tog = (label: string, sub: string, key: keyof Prefs): React.JSX.Element => (
    <Row label={label} sub={sub} k={key}>
      <Toggle on={!!pf[key]} onChange={(v) => set({ [key]: v } as Partial<Prefs>)} />
    </Row>
  )

  const [installed, setInstalled] = useState<Partial<Record<AgentKind, boolean>>>({})
  const [versions, setVersions] = useState<Partial<Record<AgentKind, string | null>>>({})
  const [shells, setShells] = useState<ShellOption[]>([])
  const [editors, setEditors] = useState<EditorOption[]>([])
  const [cloneDir, setCloneDir] = useState('')
  // The default notes folder, shown while none is set.
  const [notesDir, setNotesDir] = useState('')
  useEffect(() => {
    if (!pf.notesDir) window.api.notes.dir().then(setNotesDir)
  }, [pf.notesDir])

  useEffect(() => {
    window.api.agents.detectInstalled().then((inst) => {
      setInstalled(inst)
      for (const a of AGENTS) if (inst[a.kind]) window.api.agents.version(a.kind).then((v) => setVersions((cur) => ({ ...cur, [a.kind]: v })))
    })
    window.api.sys.shells().then(setShells)
    window.api.sys.editors().then(setEditors)
    window.api.repos.cloneDir().then(setCloneDir)
  }, [])

  const enabledAgents = AGENTS.filter((a) => !pf.agentsOff.includes(a.kind))
  const installedAgents = AGENTS.filter((a) => installed[a.kind])

  if (section === 'agents') {
    return wrap(
      <>
        <Head file={userFile} title="Agents" sub={scope ? scopeSub : `${installedAgents.length} installed · detected on PATH`}>
          {scopePicker}
        </Head>
        <Group title="Installed">
          {AGENTS.map((a) => (
            <Row
              key={a.kind}
              label={a.name}
              sub={installed[a.kind] === false ? `Not found on PATH · install the ${a.bin} CLI to use it` : `${versions[a.kind] ? versions[a.kind] + ' · ' : ''}${a.note}`}
            >
              <Toggle
                on={!!installed[a.kind] && !pf.agentsOff.includes(a.kind)}
                disabled={!installed[a.kind]}
                onChange={(v) => set({ agentsOff: v ? pf.agentsOff.filter((k) => k !== a.kind) : [...pf.agentsOff, a.kind] })}
              />
            </Row>
          ))}
        </Group>
        <Group
          title="Queue"
          note="Agents working or waiting on an approval take a slot; one that finished its turn doesn't. Queue tasks from a card's menu or Ready's “queue all”."
        >
          <Row k="maxAgents" label="Working at once" sub={pf.maxAgents ? `A start beyond ${pf.maxAgents} waits in the queue and launches when one is free` : 'Every start launches right away'}>
            <Seg
              value={String(pf.maxAgents)}
              options={[['0', 'No limit'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['6', '6']]}
              onChange={(v) => set({ maxAgents: Number(v) })}
            />
          </Row>
        </Group>
        <Group
          title="Permissions"
          note="Claude Code gets these as they are. Codex maps them to its sandbox and approval policy (it has no allowlist - listed commands still ask), Gemini CLI to its approval mode."
        >
          <Row k="editPerm" label="File edits" sub="Agent default keeps the CLI's own setting. Auto accepts edits inside the task's worktree">
            <Seg value={pf.editPerm} options={[['agent', 'Agent default'], ['ask', 'Ask'], ['auto', 'Auto in worktree']]} onChange={(v) => set({ editPerm: v as Prefs['editPerm'] })} />
          </Row>
          <Row k="shellPerm" label="Shell commands" sub="With Allowlist, anything outside the list asks first">
            <Seg
              value={pf.shellPerm}
              options={[['agent', 'Agent default'], ['ask', 'Ask'], ['allowlist', 'Allowlist'], ['auto', 'Auto']]}
              onChange={(v) => set({ shellPerm: v as Prefs['shellPerm'] })}
            />
          </Row>
          <Row k="allowlist" label="Command allowlist" sub="Comma-separated command prefixes">
            <TextField value={pf.allowlist} onChange={(v) => set({ allowlist: v })} />
          </Row>
        </Group>
        {!scope ? (
          <Group
            title="Switchyard tools"
            note="An MCP server for the agents Switchyard starts that can take one (Claude Code, Codex, OpenCode, Copilot CLI), about their own task: preview_screenshot, start_dev_server, run_tests, check_conflicts, acceptance_criteria, verify_criterion, list_active_tasks, send_message, read_messages, review_comments, reply_to_review_comment, create_task, ask_user and task_info. Claude Code may use them without asking. Applies from the next start."
          >
            <Row k="agentTools" label="Give agents Switchyard's tools" sub="So an agent can look at the running app, run the tests and see other tasks' conflicts itself">
              <Toggle on={pf.agentTools} onChange={(v) => set({ agentTools: v })} />
            </Row>
            <Row k="teamIntroduce" label="Introduce agents whose changes clash" sub="When the conflict radar finds two running tasks clashing, both agents hear about each other on the Team channel">
              <Toggle on={pf.teamIntroduce} onChange={(v) => set({ teamIntroduce: v })} />
            </Row>
          </Group>
        ) : null}
        <Group title="Launch arguments" note="Added to every start, e.g. --model opus. Applies from the next start.">
          {(installedAgents.length ? installedAgents : AGENTS).map((a) => (
            <Row key={a.kind} k="agentArgs" label={a.name} sub={`${a.bin} <message> …`}>
              <TextField value={pf.agentArgs[a.kind] ?? ''} placeholder="none" onChange={(v) => set({ agentArgs: { ...pf.agentArgs, [a.kind]: v } })} />
            </Row>
          ))}
        </Group>
        {!scope ? <ModelPrices prices={pf.modelPrices} onChange={(modelPrices) => set({ modelPrices })} /> : null}
        {!scope ? (
          <Group title="Spending" note="At API prices, from Claude Code sessions (see Usage). Each alert is said once in its period; weeks start on Monday.">
            {(
              [
                ['spendAlert', 'Daily alert', "A notice once a day's agent cost reaches this - empty for none", '$ per day'],
                ['spendAlertWeek', 'Weekly alert', "The same for the week's cost", '$ per week'],
                ['spendAlertMonth', 'Monthly alert', "The same for the month's cost", '$ per month']
              ] as const
            ).map(([k, label, sub, placeholder]) => (
              <Row key={k} label={label} sub={sub}>
                <TextField value={pf[k] ? String(pf[k]) : ''} placeholder={placeholder} onChange={(v) => dollars(v, (n) => set({ [k]: n }))} />
              </Row>
            ))}
          </Group>
        ) : null}
        {!scope && state.projects.length ? (
          <Group title="Project budgets" note="A monthly budget for a project's agents: a notice once its cost this month reaches it, and a bar in Usage. Empty for none.">
            {state.projects.map((p) => (
              <Row key={p.id} label={p.name} sub={p.repo}>
                <TextField
                  value={pf.projectBudgets[p.id] ? String(pf.projectBudgets[p.id]) : ''}
                  placeholder="$ per month"
                  onChange={(v) =>
                    dollars(v, (n) => {
                      const next = { ...pf.projectBudgets }
                      if (n) next[p.id] = n
                      else delete next[p.id]
                      set({ projectBudgets: next })
                    })
                  }
                />
              </Row>
            ))}
          </Group>
        ) : null}
      </>
    )
  }

  if (section === 'git') {
    return wrap(
      <>
        <Head file={userFile} title="Git & worktrees" sub={scope ? scopeSub : 'How tasks map to branches and folders'}>
          {scopePicker}
        </Head>
        <Group title="Worktrees">
          <Row k="worktreeRoot" label="Worktree root" sub={pf.worktreeRoot ? 'Each task gets its own folder here, under the project name' : 'Each task gets its own folder in .worktrees inside the repository'}>
            <TextField value={pf.worktreeRoot} placeholder="<repo>/.worktrees" onChange={(v) => set({ worktreeRoot: v })} />
          </Row>
          <Row k="branchPattern" label="Branch name pattern" sub="{slug} and {key} come from the task">
            <TextField value={pf.branchPattern} placeholder="feature/{slug}" onChange={(v) => set({ branchPattern: v })} />
          </Row>
          {tog('Prune worktree after merge', 'Off keeps the folder and branch after Merge & finish', 'pruneAfterMerge')}
          {tog('Finish tasks when their pull request is merged', "Merged on GitHub: the task goes to Done and its worktree is removed - not while its agent is working, and never with work that isn't in the PR", 'finishOnPrMerge')}
          <Row k="prMergeMethod" label="Merge pull requests with" sub="When Done merges a task's pull request on GitHub (it asks first; the repository may allow fewer)">
            <Seg value={pf.prMergeMethod} options={[['squash', 'Squash'], ['merge', 'Merge commit'], ['rebase', 'Rebase']]} onChange={(v) => set({ prMergeMethod: v as Prefs['prMergeMethod'] })} />
          </Row>
          {tog('Confirm before removing a worktree', '', 'confirmRemove')}
        </Group>
        <Group title="Keeping up with main">
          <Row k="syncMode" label="Update branches with" sub="Used by Rebase in Worktrees">
            <Seg value={pf.syncMode} options={[['rebase', 'Rebase'], ['merge', 'Merge']]} onChange={(v) => set({ syncMode: v as Prefs['syncMode'] })} />
          </Row>
          {tog('Warn when 10+ commits behind', '', 'warnBehind')}
          <Row k="fetchMinutes" label="Fetch origin every" sub="In the background, so the board says when main is behind - new tasks would start from old code">
            <Seg value={String(pf.fetchMinutes)} options={[['0', 'Never'], ['5', '5 min'], ['10', '10 min'], ['30', '30 min'], ['60', '1 hour']]} onChange={(v) => set({ fetchMinutes: Number(v) })} />
          </Row>
          {tog('Pull main automatically', "After a fetch, fast-forward the base branch when that's all it needs - never a merge, and not while its checkout has changes", 'autoPullBase')}
        </Group>
        <Group title="Clean up" note="Worktrees no open task uses.">
          <Row k="staleDays" label="Stale after" sub="With no task, a worktree is stale once its branch has nothing new, or no commits for this long">
            <Seg value={String(pf.staleDays)} options={['3', '7', '14', '30'].map((d): [string, string] => [d, `${d} days`])} onChange={(v) => set({ staleDays: Number(v) })} />
          </Row>
          {tog(
            'Prune stale worktrees automatically',
            'Checks hourly. Skips any with uncommitted changes, and keeps branches that have commits - nothing is lost',
            'autoPrune'
          )}
          <Row label="Clean up now" sub="The same check, once, whether or not it's automatic">
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                onClick={() =>
                  window.api.git.pruneStaleNow().then((pruned) => {
                    if (!pruned.length) dispatch({ type: 'TOAST', text: 'Nothing to clean up.' })
                  })
                }
              >
                Run now
              </Button>
            </div>
          </Row>
        </Group>
        <Group title="Cloning">
          <Row k="cloneDir" label="Clone new repositories into" sub="Where New project puts a Git URL">
            <TextField value={pf.cloneDir} placeholder={cloneDir} onChange={(v) => set({ cloneDir: v })} />
          </Row>
        </Group>
      </>
    )
  }

  if (section === 'editor') {
    const fonts = installedEditorFonts()
    return wrap(
      <>
        <Head file={userFile} title="File editor" sub={scope ? scopeSub : "The editor in each workspace's Files tab"}>
          {scopePicker}
        </Head>
        <EditorPreview prefs={pf} />
        <Group title="Text">
          <Row k="editorFont" label="Font" sub={`${fonts.length} monospace fonts found on this machine`}>
            <Select value={pf.editorFont || 'Geist Mono'} options={fonts.map((f): [string, string] => [f, f])} onChange={(v) => set({ editorFont: v === 'Geist Mono' ? '' : v })} />
          </Row>
          <Row k="editorFontSize" label="Font size">
            <Seg
              value={String(pf.editorFontSize)}
              options={['12', '12.5', '13', '14', '15', '16'].map((v): [string, string] => [v, v])}
              onChange={(v) => set({ editorFontSize: Number(v) })}
            />
          </Row>
          <Row k="editorLineHeight" label="Line height">
            <Seg value={String(pf.editorLineHeight)} options={['1.4', '1.5', '1.6', '1.8'].map((v): [string, string] => [v, v])} onChange={(v) => set({ editorLineHeight: Number(v) })} />
          </Row>
          {tog('Font ligatures', 'For fonts that have them, like Fira Code and Cascadia Code', 'editorLigatures')}
        </Group>
        <Group title="Indentation">
          <Row k="editorTabSize" label="Tab size">
            <Seg value={String(pf.editorTabSize)} options={['2', '4', '8'].map((v): [string, string] => [v, v])} onChange={(v) => set({ editorTabSize: Number(v) })} />
          </Row>
          <Row k="editorUseTabs" label="Indent with" sub="What Tab and auto-indent insert">
            <Seg value={pf.editorUseTabs ? 'tabs' : 'spaces'} options={[['spaces', 'Spaces'], ['tabs', 'Tabs']]} onChange={(v) => set({ editorUseTabs: v === 'tabs' })} />
          </Row>
          {tog('Follow .editorconfig', "A repository's .editorconfig wins over these for its files: indentation, line endings, trimming, final newline", 'editorConfig')}
        </Group>
        <Group title="Display">
          {tog('Word wrap', 'Wrap long lines instead of scrolling sideways', 'editorWordWrap')}
          {tog('Line numbers', '', 'editorLineNumbers')}
          {tog('Highlight current line', '', 'editorActiveLine')}
          {tog('Highlight matching brackets', '', 'editorBracketMatching')}
          {tog('Show whitespace', 'Dots for spaces, arrows for tabs', 'editorWhitespace')}
        </Group>
        <Group title="Saving">
          <Row k="editorAutoSave" label="Auto save" sub="Off saves with Ctrl+S or the Save button">
            <Seg
              value={pf.editorAutoSave}
              options={[['off', 'Off'], ['delay', 'After a second'], ['blur', 'When leaving the editor']]}
              onChange={(v) => set({ editorAutoSave: v as Prefs['editorAutoSave'] })}
            />
          </Row>
          {tog('Trim trailing whitespace', 'On every save', 'editorTrimOnSave')}
          {tog('End files with a newline', 'On every save', 'editorFinalNewline')}
        </Group>
      </>
    )
  }

  if (section === 'terminal') {
    return wrap(
      <>
        <Head file={userFile} title="Terminal & editor" sub={scope ? scopeSub : 'Shell tabs and external tools'}>
          {scopePicker}
        </Head>
        <Group title="Terminal">
          <Row k="shell" label="Default profile" sub="What a new terminal tab runs - the + menu next to the tabs opens any of them">
            <Select
              value={pf.shell}
              options={[['', window.electron.process.platform === 'win32' ? 'Default (PowerShell)' : 'Default (login shell)'], ...shells.map((s): [string, string] => [s.id ?? s.path, s.label])]}
              onChange={(v) => set({ shell: v })}
            />
          </Row>
          <Row k="termFont" label="Font">
            <Select value={pf.termFont || 'Geist Mono'} options={installedEditorFonts().map((f): [string, string] => [f, f])} onChange={(v) => set({ termFont: v === 'Geist Mono' ? '' : v })} />
          </Row>
          <Row k="termFontSize" label="Font size">
            <Seg value={String(pf.termFontSize)} options={[['12', '12'], ['13', '13'], ['14', '14']]} onChange={(v) => set({ termFontSize: Number(v) })} />
          </Row>
          <Row k="termScrollback" label="Scrollback" sub="Lines kept for scrolling back">
            <Seg
              value={String(pf.termScrollback)}
              options={[['1000', '1k'], ['5000', '5k'], ['10000', '10k'], ['50000', '50k']]}
              onChange={(v) => set({ termScrollback: Number(v) })}
            />
          </Row>
          <Row k="termCursor" label="Cursor">
            <Seg value={pf.termCursor} options={[['block', 'Block'], ['bar', 'Bar'], ['underline', 'Underline']]} onChange={(v) => set({ termCursor: v as Prefs['termCursor'] })} />
          </Row>
          {tog('Blinking cursor', '', 'termCursorBlink')}
          {tog('Copy on select', 'Selecting text copies it, like many Linux terminals', 'termCopyOnSelect')}
          {tog('Draw with the GPU', 'Faster with lots of output (WebGL); turn off if text looks wrong', 'termGpu')}
        </Group>
        <Group title="Editor">
          <Row k="editor" label="External editor" sub="Used by File → Open in editor">
            {editors.length ? (
              <Seg value={pf.editor || editors[0].bin} options={editors.map((e): [string, string] => [e.bin, e.label])} onChange={(v) => set({ editor: v })} />
            ) : (
              <ReadValue>None found on PATH</ReadValue>
            )}
          </Row>
        </Group>
      </>
    )
  }

  return wrap(
    <>
      <Head file={userFile} title="General" sub={scope ? scopeSub : 'Applies to every project'}>
        {scopePicker}
      </Head>
      <Group title="Agents">
        <Row k="defaultAgent" label="Default agent" sub="Used when a project doesn't set its own">
          <Select value={pf.defaultAgent} options={enabledAgents.map((a): [string, string] => [a.kind, a.name])} onChange={(v) => set({ defaultAgent: v as AgentKind })} />
        </Row>
        {tog('Open workspace after start', 'Off launches agents in the background', 'openAfterStart')}
      </Group>
      <Group title="Notifications" note="Shown while Switchyard isn't the window in front.">
        {tog('Agent needs input', 'Waiting or failed agents raise a system notification', 'notifyInput')}
        {tog('Task ready for review', 'When an agent finishes or its tests pass', 'notifyDone')}
        {tog('Play a sound', '', 'sound')}
      </Group>
      {!scope ? (
        <Group title="Daily summary" note={`What the agents did, what needs you and what's next - Summary in the sidebar${shortcut('nav-summary') ? ` (${shortcut('nav-summary')})` : ''}.`}>
          {tog('Say when it’s ready', 'Once a day, when something happened since you last looked', 'dailySummary')}
          <Row k="summaryAt" label="At" sub="Or when Switchyard opens after that">
            <Select
              value={pf.summaryAt}
              options={[...new Set(['07:00', '08:00', '08:30', '09:00', '09:30', '10:00', '11:00', '13:00', pf.summaryAt])].sort().map((v): [string, string] => [v, v])}
              onChange={(v) => set({ summaryAt: v })}
            />
          </Row>
        </Group>
      ) : null}
      {!scope ? (
        <Group title="Notification center" note={`What the bell keeps${shortcut('notifications') ? ` (${shortcut('notifications')})` : ''} - window in front or not`}>
          {NOTICE_GROUPS.map(([label, sub, kinds]) => (
            <Row key={label} label={label} sub={sub}>
              <Toggle
                on={kinds.every((k) => pf.noticeKinds.includes(k))}
                onChange={(on) => set({ noticeKinds: on ? [...new Set([...pf.noticeKinds, ...kinds])] : pf.noticeKinds.filter((k) => !kinds.includes(k)) })}
              />
            </Row>
          ))}
          <Row label="Muted projects" sub="Nothing from their tasks - neither here nor the system's notifications. Mute one from its menu in the sidebar.">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
              {pf.mutedProjects.length ? (
                pf.mutedProjects.map((id) => (
                  <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 24, padding: '0 4px 0 10px', border: '1px solid var(--bd-3)', borderRadius: 12, font: '12px var(--font-ui)', color: 'var(--t2)' }}>
                    {state.projects.find((p) => p.id === id)?.name ?? id}
                    <span onClick={() => set({ mutedProjects: pf.mutedProjects.filter((x) => x !== id) })} title="Unmute" style={{ cursor: 'pointer', padding: '0 5px', color: 'var(--t4)' }}>
                      ×
                    </span>
                  </span>
                ))
              ) : (
                <span style={{ font: '12px var(--font-mono)', color: 'var(--t4)' }}>none</span>
              )}
            </div>
          </Row>
        </Group>
      ) : null}
      <Group title="Notes" note="Plain Markdown files - edit them anywhere, sync the folder with anything.">
        <Row k="notesDir" label="Notes folder" sub={`${state.notes.length} note${state.notes.length === 1 ? '' : 's'} · changes made outside Switchyard show up live`}>
          <div style={{ display: 'flex', gap: 8 }}>
            <TextField value={pf.notesDir} placeholder={notesDir} onChange={(v) => set({ notesDir: v })} />
            <Button onClick={() => window.api.notes.dir().then((d) => window.api.sys.reveal(d))}>Open</Button>
          </div>
        </Row>
      </Group>
      <Group title="Quitting">{tog('Confirm before quitting while agents run', 'Quitting stops every running agent', 'confirmQuit')}</Group>
      <Group title="Updates">
        {tog('Download updates automatically', 'The installed app checks now and then and installs a new version when you quit', 'autoUpdate')}
        <Row label="Check now" sub="Help → Check for updates does the same">
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => window.api.log.openDir()}>Open logs folder</Button>
            <Button onClick={() => window.api.updates.check().then((r) => dispatch({ type: 'TOAST', text: r.message }))}>Check for updates</Button>
          </div>
        </Row>
      </Group>
    </>
  )
}

/* ---------- per-project settings ---------- */

type DetKey = 'lang' | 'defaultBranch' | 'setupCmd' | 'testCmd' | 'devCmd'

function ProjectSettings({ project: p }: { project: Project }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [scan, setScan] = useState<RepoScan | null>(null)

  const rescan = (): Promise<RepoScan | null> =>
    window.api.repos
      .scan(p.repoPath)
      .then((s) => {
        setScan(s)
        return s
      })
      .catch(() => null)

  useEffect(() => {
    rescan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.repoPath])

  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  const sources = p.sources ?? {}
  const sharedKeys = Object.keys(sources).filter((k) => sources[k as ProjectSettingKey] === 'shared')
  // Where new values go: this machine (Switchyard's own storage) or the
  // repository's shared .switchyard/settings.json.
  const [scope, setScope] = useState<ProjectSettingScope>(sharedKeys.length ? 'shared' : 'machine')

  // Each value is saved where it's kept now (a file's value stays in that
  // file, or the edit would be overridden by it); a new one where `scope` says.
  // Environment variables go to a shared file only on purpose - they're often secrets.
  const targetOf = (k: string): 'machine' | 'shared' | 'local' => {
    const from = sources[k as ProjectSettingKey]
    if (from) return from
    if (!(PROJECT_SETTING_KEYS as string[]).includes(k) || k === 'env') return 'machine'
    return scope
  }
  const save = async (groups: [target: 'machine' | 'shared' | 'local', patch: Partial<Project>][]): Promise<void> => {
    let latest: Project | null = null
    try {
      for (const [target, patch] of groups) if (Object.keys(patch).length) latest = await window.api.projects.setSettings(p.id, target, patch)
    } catch (err) {
      toastErr(err)
    }
    if (latest) dispatch({ type: 'UPDATE_PROJECT', id: p.id, patch: latest })
  }
  const update = (patch: Partial<Project>): void => {
    dispatch({ type: 'UPDATE_PROJECT', id: p.id, patch })
    const groups: Record<'machine' | 'shared' | 'local', Partial<Project>> = { machine: {}, shared: {}, local: {} }
    for (const [k, v] of Object.entries(patch)) (groups[targetOf(k)] as Record<string, unknown>)[k] = v
    save(Object.entries(groups) as [('machine' | 'shared' | 'local'), Partial<Project>][])
  }
  /** Moves a value between this machine and the shared file. */
  const move = (k: ProjectSettingKey, to: 'machine' | 'shared'): Promise<void> =>
    save([
      [to, { [k]: p[k] }],
      [to === 'shared' ? 'machine' : 'shared', { [k]: undefined }]
    ])
  const openFile = (which: 'shared' | 'local'): void => {
    window.api.projects.openSettingsFile(p.id, which).catch(toastErr)
  }
  /** Puts the project's current settings (not its environment) in the shared file. */
  const shareAll = (): Promise<void> => {
    const patch: Partial<Record<ProjectSettingKey, unknown>> = {}
    for (const k of PROJECT_SETTING_KEYS) if (k !== 'env' && !sources[k] && p[k] !== undefined && p[k] !== '') patch[k] = p[k]
    setScope('shared')
    return save([['shared', patch as Partial<Project>]])
  }

  /** Where a value is kept, under its field - and a way to move it. */
  const where = (k: ProjectSettingKey): React.JSX.Element | null => {
    const from = sources[k]
    const link = { color: 'var(--c-blue)', cursor: 'pointer', marginLeft: 'auto', whiteSpace: 'nowrap' } as const
    // (No moving while a file has an error - it couldn't be written.)
    const movable = !p.settingsError
    if (from === 'shared') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: `11px ${MONO}`, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--c-blue)', flex: 'none' }} />
          <span title=".switchyard/settings.json in the repository - committed, the same for the whole team">Shared with team</span>
          {movable ? (
            <span onClick={() => move(k, 'machine')} style={link}>
              Keep on this machine only
            </span>
          ) : null}
        </div>
      )
    }
    if (from === 'local') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: `11px ${MONO}`, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--t3)', flex: 'none' }} />
          <span title=".switchyard/settings.local.json - this checkout only, never committed">This checkout only</span>
        </div>
      )
    }
    if (movable && scope === 'shared' && k !== 'env' && p[k] !== undefined && p[k] !== '') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: `11px ${MONO}`, color: 'var(--t4)', whiteSpace: 'nowrap' }}>
          On this machine only
          <span onClick={() => move(k, 'shared')} style={link}>
            Share with team
          </span>
        </div>
      )
    }
    return null
  }

  const detected = (s: RepoScan | null): Record<DetKey, string> | null =>
    s ? { lang: s.meta.lang, defaultBranch: s.defaultBranch, setupCmd: s.meta.setupCmd ?? '', testCmd: s.meta.testCmd ?? '', devCmd: s.meta.devCmd ?? '' } : null
  const det = detected(scan)
  const src: Record<DetKey, string | undefined> = {
    lang: scan?.meta.src.lang,
    defaultBranch: scan?.branchSrc,
    setupCmd: scan?.meta.src.setupCmd,
    testCmd: scan?.meta.src.testCmd,
    devCmd: scan?.meta.src.devCmd
  }

  const onRescan = async (): Promise<void> => {
    const d = detected(await rescan())
    if (!d) return dispatch({ type: 'TOAST', text: `Could not read ${p.repoPath}` })
    const keys = Object.keys(d) as DetKey[]
    const changed = keys.filter((k) => (p[k] ?? '') !== d[k])
    const patch: Partial<Project> = {}
    for (const k of keys) patch[k] = d[k] || undefined
    patch.lang = d.lang || p.lang
    update(patch)
    dispatch({
      type: 'TOAST',
      text: changed.length
        ? `Re-scanned ${p.name} · restored ${changed.length} detected value${changed.length > 1 ? 's' : ''}`
        : `Re-scanned ${p.name} · everything matches the repo`
    })
  }

  const field = (label: string, key: DetKey, sub?: string, placeholder?: string, select?: string[]): React.JSX.Element => {
    const v = p[key] ?? ''
    const d = det?.[key] ?? ''
    const edited = !!det && v !== d
    return (
      <Row label={label} sub={sub}>
        {select ? <Select value={v} options={[...new Set([v, d, ...select].filter(Boolean))].map((x): [string, string] => [x, x])} onChange={(x) => update({ [key]: x })} /> : <TextField value={v} placeholder={placeholder} onChange={(x) => update({ [key]: x || undefined })} />}
        {edited ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: `11px ${MONO}`, color: 'var(--c-amber)' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--c-amber)', flex: 'none' }} />
            {!d ? 'Nothing detected' : v ? 'Edited' : 'Not set'}
            {d ? (
              <span onClick={() => update({ [key]: d })} title={d} style={{ color: 'var(--c-blue)', cursor: 'pointer', marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {v ? 'Reset to detected' : `Use ${d}`}
              </span>
            ) : null}
          </div>
        ) : d ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: `11px ${MONO}`, color: 'var(--t3)' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: G, flex: 'none' }} />
            Detected from {src[key] ?? 'repository'}
          </div>
        ) : null}
        {where(key)}
      </Row>
    )
  }

  // The key New task gives next (keys are never given out twice).
  const nextKey = p.prefix ? nextTaskKey(state.tasks, p) : '?'
  const prefixTaken = state.projects.find((o) => o.id !== p.id && o.prefix.toUpperCase() === p.prefix.toUpperCase())
  const enabledAgents = AGENTS.filter((a) => !state.prefs.agentsOff.includes(a.kind))
  const globalName = AGENTS.find((a) => a.kind === state.prefs.defaultAgent)?.name ?? state.prefs.defaultAgent
  const live = state.tasks.filter((t) => t.projectId === p.id && t.agentKind && t.col !== 'done')
  const sampleTask = state.tasks.find((t) => t.projectId === p.id) ?? { key: `${p.prefix}-1`, title: 'Add dark mode', desc: '' }
  const envCount = Object.keys(parseEnv(p.env)).length
  const [suggested, setSuggested] = useState<string[]>([])
  useEffect(() => {
    window.api.git.copySuggestions(p.repoPath).then(setSuggested)
  }, [p.repoPath])
  const missing = suggested.filter((f) => !(p.copyFiles ?? []).includes(f))

  const remove = (): Promise<boolean> => removeProject(p, state.tasks, dispatch)

  return (
    <>
      <Head title={p.name} sub={`${p.repo}${p.lang ? ` · ${p.lang}` : ''}`}>
        <Button onClick={onRescan}>Re-scan repository</Button>
      </Head>
      {p.untrusted ? (
        <div style={{ margin: '0 0 18px', border: '1px solid var(--bd-2)', borderRadius: 6, overflow: 'hidden' }}>
          <TrustStrip project={p} />
        </div>
      ) : null}
      <Group title="Settings file" note="Like .vscode/settings.json - commit it and your team gets the same commands.">
        <Row
          label="Save changes to"
          sub={
            scope === 'shared'
              ? 'The repository: .switchyard/settings.json. Environment variables stay on this machine unless you share one.'
              : 'Switchyard on this machine. Values already in the repository’s settings file are still saved there.'
          }
        >
          <Seg
            value={scope}
            options={[
              ['machine', 'This machine'],
              ['shared', 'Shared with team']
            ]}
            onChange={(v) => setScope(v as ProjectSettingScope)}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', columnGap: 14, rowGap: 4, font: `11px ${MONO}`, whiteSpace: 'nowrap' }}>
            {scope === 'shared' && !p.settingsError && PROJECT_SETTING_KEYS.some((k) => k !== 'env' && !sources[k] && p[k] !== undefined && p[k] !== '') ? (
              <span onClick={shareAll} title="Put this project's current settings (not its environment) in .switchyard/settings.json" style={{ color: 'var(--c-blue)', cursor: 'pointer' }}>
                Share current settings
              </span>
            ) : null}
            <span onClick={() => openFile('shared')} style={{ color: 'var(--c-blue)', cursor: 'pointer' }}>
              Open settings.json ↗
            </span>
            <span onClick={() => openFile('local')} title="Your own values for this checkout - never committed" style={{ color: 'var(--t3)', cursor: 'pointer' }}>
              settings.local.json ↗
            </span>
          </div>
          {p.settingsError ? <div style={{ font: `11px/1.45 ${MONO}`, color: 'var(--c-red)' }}>{p.settingsError} - the file is ignored until it’s fixed.</div> : null}
        </Row>
      </Group>
      <Group title="Repository">
        <Row label="Remote">
          <ReadValue>{p.repo}</ReadValue>
        </Row>
        <Row label="Local path">
          <ReadValue>{p.repoPath}</ReadValue>
        </Row>
        {field('Language', 'lang', undefined, undefined, LANGUAGES)}
        {field('Default branch', 'defaultBranch', 'Worktrees branch from here; diffs compare against it')}
      </Group>
      <Group title="Tasks">
        <Row label="Task prefix" sub={prefixTaken ? `${prefixTaken.name} uses ${p.prefix} too - pick another, task keys must tell the projects apart` : `Next task will be ${nextKey}`}>
          <TextField
            value={p.prefix}
            onChange={(v) => {
              const prefix = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
              // Two projects with one prefix would hand out the same task keys.
              if (prefix && state.projects.some((o) => o.id !== p.id && o.prefix.toUpperCase() === prefix)) {
                dispatch({ type: 'TOAST', text: `${state.projects.find((o) => o.prefix.toUpperCase() === prefix)?.name} already uses ${prefix}.` })
                return
              }
              if (prefix) update({ prefix })
            }}
          />
          {where('prefix')}
        </Row>
        <Row label="Default agent" sub={`Global default is ${globalName}`}>
          <Select
            value={p.agentKind ?? ''}
            options={[['', 'Global default'], ...enabledAgents.map((a): [string, string] => [a.kind, a.name])]}
            onChange={(v) => update({ agentKind: (v || undefined) as AgentKind | undefined })}
          />
          {where('agentKind')}
        </Row>
        <Row label="First message" sub={`What the Start modal fills in. {key} {title} {desc} {branch} · e.g. "${firstMessage(p.messageTemplate, sampleTask, 'feature/…')}"`}>
          <TextArea value={p.messageTemplate ?? ''} placeholder={DEFAULT_MESSAGE_TEMPLATE} rows={2} onChange={(v) => update({ messageTemplate: v.trim() ? v : undefined })} />
          {where('messageTemplate')}
        </Row>
      </Group>
      <Group title="Worktrees">
        <Row label="Copy into new worktrees" sub="Files git doesn't track that the project needs to run, copied from this checkout when a task starts. Comma-separated; * works in the last part">
          <TextField value={(p.copyFiles ?? []).join(', ')} placeholder=".env, config/master.key" onChange={(v) => update({ copyFiles: splitList(v) })} />
          {missing.length ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, font: `11px ${MONO}`, color: 'var(--t3)' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={missing.join(', ')}>
                Found, ignored by git: {missing.join(', ')}
              </span>
              <span onClick={() => update({ copyFiles: [...(p.copyFiles ?? []), ...missing] })} style={{ color: 'var(--c-blue)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {missing.length > 1 ? 'Add all' : 'Add'}
              </span>
            </div>
          ) : null}
          {where('copyFiles')}
        </Row>
      </Group>
      <Group title="Environment" note="Kept on this machine - these are often secrets. A value in the repository’s settings file is shown as shared.">
        <Row label="Environment variables" sub={`KEY=value per line. Set for setup, tests, the dev server, agents and terminals in this project's worktrees${envCount ? ` · ${envCount} set` : ''}`}>
          <TextArea value={p.env ?? ''} placeholder={'DATABASE_URL=postgres://localhost/app_dev\nRAILS_ENV=development'} rows={4} onChange={(v) => update({ env: v.trim() ? v : undefined })} />
          {where('env')}
        </Row>
      </Group>
      <Group title="Commands">
        {field('Setup', 'setupCmd', 'Runs in every new worktree before the agent starts', 'none')}
        {field('Test', 'testCmd', 'Used by the Tests check in the workspace', 'none')}
        {field('Dev server', 'devCmd', 'Powers the Preview tab (gets a free port as PORT)', 'none')}
      </Group>
      <Group title="Remove">
        <Row
          label="Remove from Switchyard"
          sub={`Deletes its ${plural(state.tasks.filter((t) => t.projectId === p.id).length, 'task')} from the board${live.length ? ` and stops ${live.length} agent${live.length > 1 ? 's' : ''}` : ''}. The repository, branches and worktrees stay on disk.`}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button tone="danger" onClick={remove}>
              Remove project…
            </Button>
          </div>
        </Row>
      </Group>
    </>
  )
}

/* ---------- building blocks (design: settings rows) ---------- */

function Head({
  title,
  sub,
  file,
  noSaveNote,
  children
}: {
  title: string
  sub: string
  /** The settings file this page saves to, opened by clicking its name. */
  file?: { label: string; title: string; open: () => void }
  /** A page that isn't a form of settings (Plugins): no "Saved…" note. */
  noSaveNote?: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ font: '600 20px var(--font-ui)', letterSpacing: '-0.01em' }}>{title}</div>
        <div style={{ font: `12.5px ${MONO}`, color: 'var(--t3)' }}>{sub}</div>
      </div>
      <span style={{ font: `11.5px ${MONO}`, color: 'var(--t5)', whiteSpace: 'nowrap', display: noSaveNote ? 'none' : undefined }}>
        {file ? (
          <>
            Saved to{' '}
            <span onClick={file.open} title={file.title} style={{ color: 'var(--c-blue)', cursor: 'pointer' }}>
              {file.label} ↗
            </span>
          </>
        ) : (
          'Saved automatically'
        )}
      </span>
      {children}
    </div>
  )
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }): React.JSX.Element | null {
  const scope = useContext(PrefScope)
  // For a project, only what a project can set - a group left empty isn't shown.
  const rows = React.Children.toArray(children).filter((r) => !(scope?.project && React.isValidElement(r) && r.type === Row && !projectCanSet((r.props as { k?: keyof Prefs }).k)))
  if (!rows.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <SectionLabel note={note} style={{ paddingBottom: 8 }}>
        {title}
      </SectionLabel>
      <div style={{ border: '1px solid var(--bd-2)', borderRadius: 8, background: 'var(--bg-panel-2)', display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ borderTop: `1px solid ${i ? 'var(--bd-1)' : 'transparent'}` }}>
            {r}
          </div>
        ))}
      </div>
    </div>
  )
}

function Row({ label, sub, k, children }: { label: string; sub?: string; k?: keyof Prefs; children: React.ReactNode }): React.JSX.Element | null {
  const scope = useContext(PrefScope)
  if (scope?.project && !projectCanSet(k)) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,340px)', gap: 24, alignItems: 'center', padding: '12px 16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ font: '500 13px var(--font-ui)', color: 'var(--t1)' }}>{label}</span>
        {sub ? <span style={{ font: '12px/1.45 var(--font-ui)', color: 'var(--t3)', textWrap: 'pretty' } as React.CSSProperties}>{sub}</span> : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {children}
        {scope && k ? <PrefNote k={k} scope={scope} /> : null}
      </div>
    </div>
  )
}

/* ---------- preferences for one project ---------- */

interface PrefScopeValue {
  /** The project being edited; null: the user's settings. */
  project: Project | null
  overriddenIn: (k: keyof Prefs) => Project[]
  /** Back to the user's value. */
  reset: (k: keyof Prefs) => void
  move: (k: keyof Prefs, to: 'shared' | 'local') => void
  pick: (projectId: string) => void
}

const PrefScope = createContext<PrefScopeValue | null>(null)

const projectCanSet = (k: keyof Prefs | undefined): boolean => !!k && !APP_PREF_KEYS.includes(k)

/** User settings or one project's, like VS Code's User / Workspace tabs. */
function ScopePicker({ scope, projects, onScope }: { scope: Project | null; projects: Project[]; onScope: (id: string) => void }): React.JSX.Element | null {
  if (!projects.length) return null
  return (
    <div style={{ width: 210, flex: 'none' }}>
      <Select value={scope?.id ?? ''} options={[['', 'User - all projects'], ...projects.map((p): [string, string] => [p.id, `Project: ${p.name}`])]} onChange={onScope} />
    </div>
  )
}

/** Under a field: where a project's own value is kept (or, for the user's, which projects override it). */
function PrefNote({ k, scope }: { k: keyof Prefs; scope: PrefScopeValue }): React.JSX.Element | null {
  const link = { color: 'var(--c-blue)', cursor: 'pointer', whiteSpace: 'nowrap' } as const
  const line = { display: 'flex', alignItems: 'center', gap: 6, font: `11px ${MONO}`, color: 'var(--t3)', whiteSpace: 'nowrap', minWidth: 0 } as const
  const p = scope.project
  if (!p) {
    const over = scope.overriddenIn(k)
    if (!over.length) return null
    return (
      <div style={line}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--c-amber)', flex: 'none' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Overridden in{' '}
          {over.map((o, i) => (
            <React.Fragment key={o.id}>
              {i ? ', ' : ''}
              <span onClick={() => scope.pick(o.id)} title={`Show ${o.name}'s settings`} style={link}>
                {o.name}
              </span>
            </React.Fragment>
          ))}
        </span>
      </div>
    )
  }
  const from = p.sources?.[k]
  if (!p.prefs || !(k in p.prefs) || !from) return null
  // (No moving while a file has an error - it couldn't be written.)
  const movable = !p.settingsError
  return (
    <div style={{ ...line, flexWrap: 'wrap', columnGap: 10, rowGap: 2 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: from === 'shared' ? 'var(--c-blue)' : 'var(--t3)', flex: 'none' }} />
        <span title={from === 'shared' ? '.switchyard/settings.json - committed, the same for the whole team' : '.switchyard/settings.local.json - this checkout only, never committed'}>
          {from === 'shared' ? 'Shared with team' : 'This checkout only'}
        </span>
      </span>
      {movable ? (
        <span
          onClick={() => scope.move(k, from === 'shared' ? 'local' : 'shared')}
          title={from === 'shared' ? 'Move it to settings.local.json - not committed' : 'Move it to settings.json - committed, for the whole team'}
          style={{ ...link, marginLeft: 'auto' }}
        >
          {from === 'shared' ? 'Only here' : 'Share'}
        </span>
      ) : null}
      {movable ? (
        <span onClick={() => scope.reset(k)} title="Remove it from the project's file - your user setting applies again" style={link}>
          Reset
        </span>
      ) : null}
    </div>
  )
}

/** The notification center's toggles: a label, what it covers, and its kinds. */
const NOTICE_GROUPS: [string, string, NoticeKind[]][] = [
  ['Needs your approval', 'An agent asks before it goes on', ['permission']],
  ['Waiting for you', 'An agent finished its turn - this can be often', ['waiting']],
  ['Failed', 'An agent exited with an error', ['failed']],
  ['Ready for review', 'An agent is done with the task', ['done']],
  ['Tests', 'A test run passed or failed', ['tests-passed', 'tests-failed']],
  ['Merged and finished', 'A task was finished or its pull request merged', ['finished', 'pr-merged']],
  ['Pull requests', 'Checks failed or a reviewer asked for changes (GitHub CLI)', ['pr']],
  ['Review answers', 'An agent answered your review comments (Claude Code)', ['review-reply']],
  ['Agent questions', 'An agent asked you something through Switchyard (ask_user)', ['agent-question']],
  ['Team', 'Two agents kept messaging each other and the rest was held', ['team']],
  ['Usage limits', 'An agent hit its usage limit and sleeps until it resets', ['limit']],
  ['Spending', 'Agent cost reached one of your alerts or a project budget (Agents → Spending)', ['spend']]
]

/* ---------- model prices ---------- */

/**
 * Prices per million tokens, for the costs in Usage: each model sessions
 * have used (and any priced here), built-in prices as placeholders.
 */
function ModelPrices({ prices, onChange }: { prices: Record<string, ModelPrice>; onChange: (p: Record<string, ModelPrice>) => void }): React.JSX.Element {
  const usage = useUsage()
  const [adding, setAdding] = useState('')
  // Edits come quickly one after another (tab from input to output): each builds on the last.
  const latest = useRef(prices)
  latest.current = prices
  const save = (next: Record<string, ModelPrice>): void => {
    latest.current = next
    onChange(next)
  }
  const seen = new Set<string>()
  for (const e of usage) for (const models of Object.values(e.days)) for (const m of Object.keys(models)) seen.add(m)
  const models = [...new Set([...seen, ...Object.keys(prices)])].sort()
  const setPrice = (model: string, k: 'input' | 'output', v: string): void => {
    const all = latest.current
    const n = Number(v.replace(/[$\s]/g, ''))
    const cur = all[model] ?? priceOf(model) ?? { input: 0, output: 0 }
    if (!v.trim()) {
      // Emptied: back to the built-in price (or none).
      const next = { ...all }
      delete next[model]
      return save(next)
    }
    if (!Number.isFinite(n) || n < 0 || cur[k] === n) return
    save({ ...all, [model]: { ...cur, [k]: n } })
  }
  return (
    <Group title="Model prices" note="US dollars per million tokens, for the costs in Usage. Cache writes cost 1.25× input, cache reads 0.1×.">
      {models.map((m) => {
        const own = prices[m]
        const known = priceOf(m, {})
        return (
          <Row key={m} label={m} sub={own ? 'your price' : known ? 'built-in price' : 'no price - its tokens show without a cost'}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <TextField value={own ? String(own.input) : ''} placeholder={known ? `in ${known.input}` : 'in $'} onChange={(v) => setPrice(m, 'input', v)} />
              <TextField value={own ? String(own.output) : ''} placeholder={known ? `out ${known.output}` : 'out $'} onChange={(v) => setPrice(m, 'output', v)} />
            </div>
          </Row>
        )
      })}
      <Row label="Another model" sub="Its id, or the start of it (claude-opus-5 prices every claude-opus-5 model)">
        <TextField
          value={adding}
          placeholder="model id"
          onChange={(v) => {
            const id = v.trim()
            setAdding('')
            if (id && !latest.current[id]) save({ ...latest.current, [id]: priceOf(id) ?? { input: 0, output: 0 } })
          }}
        />
      </Row>
    </Group>
  )
}

/* ---------- appearance ---------- */

/** Themes: the built-in ones and the user's (JSON files in the themes folder), picked here. */
function Appearance(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const { themes, problems, dir } = useThemes()
  const active = useActiveTheme()
  const pref = state.prefs.theme || 'dark'
  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  const pick = (id: string): void => dispatch({ type: 'SET_PREFS', patch: { theme: id } })
  const duplicate = async (): Promise<void> => {
    try {
      const path = await window.api.themes.duplicate(active, `My ${active.name}`)
      const id = (path.split(/[\\/]/).pop() ?? '').replace(/\.json$/, '')
      dispatch({ type: 'TOAST', text: `Made ${path} - edit it and save to see the changes at once.`, tone: 'done' })
      // The folder's watcher reports the new file; pick it once it's there.
      setTimeout(() => pick(id), 500)
    } catch (err) {
      toastErr(err)
    }
  }
  const install = async (): Promise<void> => {
    try {
      const r = await window.api.themes.install()
      if (r) dispatch({ type: 'TOAST', text: [`Installed ${r.count} theme${r.count === 1 ? '' : 's'}`, ...r.problems].join(' · '), tone: r.count ? 'done' : undefined })
    } catch (err) {
      toastErr(err)
    }
  }
  const home = window.api.sys.homeDir
  const shownDir = dir.toLowerCase().startsWith(home.toLowerCase()) ? '~' + dir.slice(home.length).replace(/\\/g, '/') : dir
  const light = themes.find((t) => t.id === 'light')
  const dark = themes.find((t) => t.id === 'dark')
  return (
    <>
      <Head title="Appearance" sub="Themes color the whole app - the terminal and code editors too" />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <SectionLabel style={{ paddingBottom: 10 }}>Theme</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
          {dark && light ? <ThemeCard name="Match system" note="Light or dark, as the OS is" selected={pref === 'system'} left={dark} right={light} onClick={() => pick('system')} /> : null}
          {themes.map((t) => (
            <ThemeCard
              key={t.id}
              name={t.name}
              note={t.source === 'builtin' ? 'Built in' : t.source === 'override' ? `Built in · changed by ${t.file}` : (t.file ?? 'Custom')}
              selected={pref === t.id}
              left={t}
              onClick={() => pick(t.id)}
            />
          ))}
        </div>
      </div>
      {problems.length ? (
        <div
          style={{
            border: '1px solid color-mix(in srgb, var(--c-red) 40%, transparent)',
            background: 'color-mix(in srgb, var(--c-red) 6%, transparent)',
            borderRadius: 8,
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}
        >
          <div style={{ font: '500 12.5px var(--font-ui)', color: 'var(--c-red-soft)' }}>Some theme files have problems - what&apos;s wrong is left out, the rest applies</div>
          {problems.map((p) => (
            <div key={p} style={{ font: `12px ${MONO}`, color: 'var(--t2)', wordBreak: 'break-word' }}>
              {p}
            </div>
          ))}
        </div>
      ) : null}
      <Group title="Your themes" note="JSON files; saving one applies it at once">
        <Row label="Themes folder" sub={`${shownDir || 'themes'} - a theme with the id dark, light or retro replaces that one; README.md there lists every color`}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => window.api.themes.openDir().catch(toastErr)} title={dir}>
              Open folder
            </Button>
          </div>
        </Row>
        <Row label="Start a theme" sub={`A copy of ${active.name} with every color spelled out, to change`}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={duplicate}>Duplicate {active.name}</Button>
          </div>
        </Row>
        <Row label="Install a theme" sub="Copies .json theme files into the folder">
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={install}>Install…</Button>
          </div>
        </Row>
      </Group>
    </>
  )
}

/** A theme as a small picture of the app in its colors (two halves: "system"). */
function ThemeCard({ name, note, selected, left, right, onClick }: { name: string; note: string; selected: boolean; left: Theme; right?: Theme; onClick: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const half = (t: Theme, clip?: string): React.JSX.Element => {
    const c = t.colors
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', background: c['bg-app'], clipPath: clip, fontFamily: t.fonts.ui }}>
        <div style={{ width: 38, background: c['bg-chrome'], borderRight: `1px solid ${c['bd-1']}`, padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[0.9, 0.6, 0.7].map((w, i) => (
            <div key={i} style={{ height: 4, width: `${w * 100}%`, borderRadius: 2, background: i === 0 ? c.t2 : c.t4 }} />
          ))}
        </div>
        <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: c.t1, whiteSpace: 'nowrap' }}>Aa</div>
          <div style={{ background: c['bg-panel'], border: `1px solid ${c['bd-2']}`, borderRadius: 4, padding: 5, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: c['c-green'] }} />
              <div style={{ height: 3, flex: 1, borderRadius: 2, background: c.t2 }} />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: c['c-amber'] }} />
              <div style={{ height: 3, width: '60%', borderRadius: 2, background: c.t3 }} />
            </div>
          </div>
          <div style={{ height: 8, width: 34, borderRadius: 3, background: c['c-blue'] }} />
        </div>
        {t.effects.scanlines ? <div style={{ position: 'absolute', inset: 0, background: `repeating-linear-gradient(to bottom, transparent 0, transparent 2px, color-mix(in srgb, ${c.sh} 25%, transparent) 3px, transparent 4px)` }} /> : null}
      </div>
    )
  }
  return (
    <div onClick={onClick} {...hoverProps} style={{ display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' }}>
      <div
        style={{
          position: 'relative',
          height: 96,
          borderRadius: 8,
          overflow: 'hidden',
          border: `1.5px solid ${selected ? 'var(--c-blue)' : hover ? 'var(--bd-5)' : 'var(--bd-3)'}`,
          boxShadow: selected ? '0 0 0 3px color-mix(in srgb, var(--c-blue) 22%, transparent)' : 'none'
        }}
      >
        {half(left)}
        {right ? half(right, 'polygon(62% 0, 100% 0, 100% 100%, 38% 100%)') : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ font: '500 13px var(--font-ui)', color: selected ? 'var(--t1)' : 'var(--t2)' }}>{name}</span>
        <span style={{ font: `11px ${MONO}`, color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={note}>
          {note}
        </span>
      </div>
    </div>
  )
}

/* ---------- keyboard shortcuts ---------- */

/** Every command and its keys - keybindings.json over the defaults, changed here or in the file. */
function KeyboardShortcuts(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  const all = bindings()
  // Commands keybindings.json changes ("-cmd" entries included).
  const changed = new Set(state.keybindings.map((b) => b.command.replace(/^-/, '')))
  const save = (command: string, key: string | null): void => {
    setRecording(null)
    window.api.keybindings
      .set(command, key)
      .then((k) => dispatch({ type: 'KEYBINDINGS_LOADED', bindings: k.bindings }))
      .catch(toastErr)
  }
  const keysOf = (id: string): ResolvedBinding[] => all.filter((b) => b.command === id)
  const commands = allKeyCommands()
  const title = (id: string): string => commands.find((c) => c.id === id)?.title ?? id
  /** Other commands on the same key that can apply at the same time. */
  const clashes = (b: ResolvedBinding): string[] =>
    all.filter((o) => o.command !== b.command && normalizeKey(o.key) === normalizeKey(b.key) && whenOverlaps(o.when, b.when)).map((o) => title(o.command))

  const q = query.trim().toLowerCase()
  const shown = commands.filter(
    (c) => !q || c.title.toLowerCase().includes(q) || c.id.includes(q) || keysOf(c.id).some((b) => formatKey(b.key, isMac).toLowerCase().includes(q))
  )
  const categories = [...new Set(shown.map((c) => c.category))]
  const link = { color: 'var(--c-blue)', cursor: 'pointer', whiteSpace: 'nowrap', font: `11px ${MONO}` } as const

  return (
    <>
      <Head
        file={{ label: 'keybindings.json', title: 'Open keybindings.json - your shortcuts, as JSON', open: () => window.api.keybindings.openFile().catch(toastErr) }}
        title="Keyboard shortcuts"
        sub={`${commands.length} commands · ${changed.size ? `${changed.size} changed by you` : 'all defaults'}`}
      />
      <TextInput mono value={query} placeholder="Search by name or key" onChange={(e) => setQuery(e.target.value)} />
      {categories.map((cat) => (
        <Group key={cat} title={cat}>
          {shown
            .filter((c) => c.category === cat)
            .map((c) => {
              const keys = keysOf(c.id)
              const clash = [...new Set(keys.flatMap(clashes))]
              return (
                <Row key={c.id} label={c.title} sub={`${c.id}${c.when ? ` · when ${c.when}` : ''}`}>
                  {recording === c.id ? (
                    <KeyRecorder onKey={(key) => save(c.id, key)} onCancel={() => setRecording(null)} />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {keys.length ? (
                        keys.map((b, i) => (
                          <span key={i} title={b.when ? `when ${b.when}` : undefined} style={KEYCAP}>
                            {formatKey(b.key, isMac)}
                          </span>
                        ))
                      ) : (
                        <span style={{ font: `12px ${MONO}`, color: 'var(--t5)' }}>none</span>
                      )}
                      <span style={{ flex: 1 }} />
                      <span onClick={() => setRecording(c.id)} style={link}>
                        {keys.length ? 'Change' : 'Add'}
                      </span>
                      {keys.length ? (
                        <span onClick={() => save(c.id, null)} title="No key for this command" style={{ ...link, color: 'var(--t3)' }}>
                          Remove
                        </span>
                      ) : null}
                      {changed.has(c.id) ? (
                        <span onClick={() => save(c.id, c.key ?? null)} title={c.key ? `Back to ${formatKey(c.key, isMac)}` : 'Back to no key'} style={link}>
                          Reset
                        </span>
                      ) : null}
                    </div>
                  )}
                  {clash.length ? <div style={{ font: `11px ${MONO}`, color: 'var(--c-amber)' }}>Same key as {clash.join(', ')} - the one set last wins</div> : null}
                </Row>
              )
            })}
        </Group>
      ))}
      {!shown.length ? <div style={{ font: '13px var(--font-ui)', color: 'var(--t3)' }}>No command matches “{query}”.</div> : null}
    </>
  )
}

const KEYCAP: React.CSSProperties = {
  font: `11.5px ${MONO}`,
  color: 'var(--t1)',
  padding: '2px 7px',
  borderRadius: 4,
  border: '1px solid var(--bd-3)',
  background: 'var(--bg-app)',
  whiteSpace: 'nowrap'
}

/** Could both "when" clauses hold at once? (Roughly: they share a screen, or either always holds.) */
function whenOverlaps(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a === b) return true
  const names = (w: string): string[] =>
    w
      .split(/\|\||&&/)
      .map((t) => t.trim())
      .filter((t) => t && !t.startsWith('!'))
  const bs = names(b)
  return names(a).some((n) => bs.includes(n))
}

/** Takes the next key pressed (with its modifiers) as the new shortcut; Esc cancels. */
function KeyRecorder({ onKey, onCancel }: { onKey: (key: string) => void; onCancel: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div
      ref={ref}
      tabIndex={0}
      onBlur={onCancel}
      onKeyDown={(e) => {
        // Not a shortcut of the app while choosing one.
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') return onCancel()
        const chord = eventChord(e.nativeEvent)
        if (chord) onKey(chordId(chord))
      }}
      style={{
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 5,
        border: '1px solid color-mix(in srgb, var(--c-blue) 60%, transparent)',
        background: 'color-mix(in srgb, var(--c-blue) 8%, transparent)',
        font: `12px ${MONO}`,
        color: 'var(--t2)',
        outline: 'none'
      }}
    >
      Press the new key… · Esc cancels
    </div>
  )
}

function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <UIToggle on={on} disabled={disabled} onChange={onChange} />
    </div>
  )
}

function Seg({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Segmented value={value} options={options} onChange={onChange} style={{ justifyContent: 'flex-end' }} />
    </div>
  )
}

/** Saves as you type (debounced), like the rest of the page. */
function TextField({ value, placeholder, onChange }: { value: string; placeholder?: string; onChange: (v: string) => void }): React.JSX.Element {
  const [local, setLocal] = useState(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setLocal(value)
  }, [value, focused])
  useEffect(() => {
    if (local === value) return
    const t = setTimeout(() => onChange(local), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local])
  return (
    <TextInput
      mono
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        if (local !== value) onChange(local)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

/** A dollar amount typed in ("$5", "12.5"): 0 when it's empty; nothing when it isn't a number. */
function dollars(v: string, apply: (n: number) => void): void {
  const n = Number(v.replace(/[$\s,]/g, ''))
  if (!v.trim()) apply(0)
  else if (Number.isFinite(n) && n >= 0) apply(n)
}

function splitList(v: string): string[] | undefined {
  const list = v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  return list.length ? list : undefined
}

/** Multi-line field; saves as you type (debounced) like TextField. */
function TextArea({ value, placeholder, rows, onChange }: { value: string; placeholder?: string; rows: number; onChange: (v: string) => void }): React.JSX.Element {
  const [local, setLocal] = useState(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setLocal(value)
  }, [value, focused])
  useEffect(() => {
    if (local === value) return
    const t = setTimeout(() => onChange(local), 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local])
  return (
    <UITextArea
      mono
      value={local}
      placeholder={placeholder}
      rows={rows}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        if (local !== value) onChange(local)
      }}
    />
  )
}

function Select({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <MenuSelect
      value={value}
      options={options}
      onChange={onChange}
      style={{
        height: 30,
        width: '100%',
        background: 'var(--bg-app)',
        border: '1px solid var(--bd-3)',
        borderRadius: 5,
        padding: '0 10px',
        color: 'var(--t1)',
        font: '12.5px var(--font-ui)'
      }}
    />
  )
}

function ReadValue({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      title={typeof children === 'string' ? children : undefined}
      style={{ height: 30, display: 'flex', alignItems: 'center', padding: '0 10px', font: `12.5px ${MONO}`, color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
    </div>
  )
}

function NavHeading({ first, children }: { first?: boolean; children: React.ReactNode }): React.JSX.Element {
  return <SectionLabel style={{ padding: first ? '0 10px 8px' : '20px 10px 8px' }}>{children}</SectionLabel>
}

function NavRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <HoverText
      onClick={onClick}
      active={active}
      style={{ height: 28, padding: '0 10px', borderRadius: 5, display: 'flex', alignItems: 'center', background: active ? 'color-mix(in srgb, var(--ov) 7%, transparent)' : 'transparent', fontSize: 13 }}
    >
      {label}
    </HoverText>
  )
}

function HoverText({ onClick, active, style, children }: { onClick: () => void; active?: boolean; style: React.CSSProperties; children: React.ReactNode }): React.JSX.Element {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...style, color: active || hover ? 'var(--t1)' : active === undefined ? 'var(--t3)' : 'var(--t2)', cursor: 'pointer' }}
    >
      {children}
    </div>
  )
}

const PREVIEW = `import { z } from 'zod'

// Tab size, fonts and ligatures show up here: => !== <= >= ===
export const checkoutSchema = z.object({
  email: z.string().email(),
	quantity: z.number().int().min(1),   
  coupon: z.string().optional()
})

export function total(items: { price: number; qty: number }[]): number {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0) // a long comment to show how word wrap handles lines that run past the edge
}
`

/** The file editor as it will look, updating as settings change. */
function EditorPreview({ prefs }: { prefs: Prefs }): React.JSX.Element {
  const extensions = useMemo(() => [...languageFor('preview.ts'), ...editorExtensions(prefs), EditorState.readOnly.of(true)], [prefs])
  return (
    <div style={{ border: '1px solid var(--bd-2)', borderRadius: 8, background: 'var(--bg-console)', overflow: 'hidden', height: 250, display: 'flex', flexDirection: 'column' }}>
      <CodeMirror value={PREVIEW} height="250px" theme={codeTheme} extensions={extensions} basicSetup={editorBasicSetup(prefs)} editable={false} />
    </div>
  )
}

/* ---------- plugins ---------- */

const PLUGIN_STATUS: Record<PluginInfo['status'], [string, string]> = {
  off: ['off', 'var(--t4)'],
  starting: ['starting…', 'var(--c-amber)'],
  running: ['running', 'var(--c-green)'],
  ready: ['on', 'var(--c-green)'],
  error: ['problem', 'var(--c-red)']
}

const SOURCE_TAG: Record<PluginSource['kind'], [string, string]> = {
  installed: ['installed', 'var(--t3)'],
  local: ['local', 'var(--t3)'],
  development: ['development', 'var(--c-blue)']
}

function PluginsSettings(): React.JSX.Element {
  const { dispatch } = useAppStore()
  const plugins = usePlugins()
  const [urlOpen, setUrlOpen] = useState(false)
  const [more, setMore] = useState<MenuAnchor | null>(null)
  const [dropping, setDropping] = useState(false)
  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  const toast = (text: string): void => dispatch({ type: 'TOAST', text })

  const turn = async (p: PluginInfo, on: boolean): Promise<void> => {
    const m = p.manifest!
    // An installed one was confirmed when it was installed; the others are asked about here.
    if (on && m.main && p.source.kind !== 'installed') {
      const ok = await confirm({
        title: `Turn on ${m.name}?`,
        body: `Its script (${m.main}) runs on this computer with your permissions - it can read and change files and run programs, like a VS Code extension. Only turn on plugins you trust.`,
        confirmLabel: 'Turn on'
      })
      if (!ok) return
    }
    window.api.plugins.setEnabled(m.id, on).catch(toastErr)
  }
  const pickFile = (): void => {
    window.api.plugins
      .pickPackage()
      .then((p) => p && askInstall(p))
      .catch(toastErr)
  }
  const packageFolder = (dir: string | null): void => {
    window.api.plugins
      .package(dir)
      .then((r) => r && toast(`Packaged ${r.files} file${r.files === 1 ? '' : 's'} (${Math.max(1, Math.round(r.bytes / 1024))} KB) → ${r.path}`))
      .catch(toastErr)
  }
  // A .syplugin dropped anywhere on this page.
  const packageIn = (e: React.DragEvent): File | undefined => [...e.dataTransfer.files].find((f) => f.name.toLowerCase().endsWith('.syplugin'))

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dropping) setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(e) => {
        setDropping(false)
        const f = packageIn(e)
        if (!f) return e.dataTransfer.files.length ? toast('Drop a plugin package (.syplugin) here to install it.') : undefined
        e.preventDefault()
        window.api.plugins.previewFile(window.api.fs.pathForFile(f)).then(askInstall).catch(toastErr)
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 26, position: 'relative', minHeight: 300 }}
    >
      <Head noSaveNote title="Plugins" sub={`Commands, card badges and agents · ${plugins.length ? `${plugins.length} installed` : 'none yet'}`}>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Install from file…
        </Button>
        <IconButton title="More" onClick={(e) => setMore({ el: e.currentTarget })}>
          ⋯
        </IconButton>
      </Head>
      {more ? (
        <Menu
          anchor={more}
          width={250}
          items={[
            { label: 'Install from URL…', onClick: () => setUrlOpen(true) },
            { label: 'Load from folder…', sub: 'development', separatorBefore: true, onClick: () => window.api.plugins.linkFolder().catch(toastErr) },
            {
              label: 'New plugin',
              sub: 'from the example',
              onClick: () =>
                window.api.plugins
                  .scaffold()
                  .then((dir) => {
                    toast(`Made an example plugin in ${dir.split(/[\\/]/).pop()} - its README says how it works.`)
                    return window.api.plugins.open(dir)
                  })
                  .catch(toastErr)
            },
            { label: 'Package a folder…', onClick: () => packageFolder(null) },
            { label: 'Open plugins folder', separatorBefore: true, onClick: () => window.api.plugins.openFolder().catch(toastErr) },
            { label: 'Reload plugins', onClick: () => window.api.plugins.reload().then(() => toast('Plugins reloaded.')).catch(toastErr) }
          ]}
          onClose={() => setMore(null)}
        />
      ) : null}
      {plugins.length === 0 ? (
        <div style={{ border: '1px dashed var(--bd-3)', borderRadius: 8, padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 8, font: '13px/1.55 var(--font-ui)', color: 'var(--t3)' }}>
          <span style={{ color: 'var(--t1)', fontWeight: 500 }}>No plugins yet</span>
          <span>
            Plugins add commands (to the palette, the Plugins menu and keys), put badges on cards, react to tasks changing and add agent CLIs. Install one from a{' '}
            <code style={{ font: `12px ${MONO}` }}>.syplugin</code> package - drop it here, double-click it, or use <b style={{ color: 'var(--t2)', fontWeight: 500 }}>Install from file</b>.
            To write your own, <b style={{ color: 'var(--t2)', fontWeight: 500 }}>⋯ → New plugin</b> makes a working example with a guide, and{' '}
            <b style={{ color: 'var(--t2)', fontWeight: 500 }}>Package</b> turns it into a file to share.
          </span>
        </div>
      ) : (
        <Group title="Installed">
          {plugins.map((p) => (
            <PluginRow key={p.dir} p={p} onTurn={(on) => void turn(p, on)} onPackage={() => packageFolder(p.dir)} />
          ))}
        </Group>
      )}
      {dropping ? (
        <div
          style={{
            position: 'absolute',
            inset: -12,
            border: '1px dashed color-mix(in srgb, var(--c-blue) 70%, transparent)',
            borderRadius: 10,
            background: 'color-mix(in srgb, var(--c-blue) 6%, transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: '13px var(--font-ui)',
            color: 'var(--t1)',
            pointerEvents: 'none'
          }}
        >
          <span style={{ background: 'var(--bg-menu)', border: '1px solid var(--bd-4)', borderRadius: 6, padding: '6px 12px' }}>Drop a .syplugin to install it</span>
        </div>
      ) : null}
      {urlOpen ? <InstallFromUrl onClose={() => setUrlOpen(false)} /> : null}
    </div>
  )
}

function InstallFromUrl({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { dispatch } = useAppStore()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = (): void => {
    setBusy(true)
    setError(null)
    window.api.plugins
      .previewUrl(url)
      .then((p) => {
        onClose()
        askInstall(p)
      })
      .catch((err: unknown) => {
        setBusy(false)
        setError(errText(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  void dispatch
  return (
    <Modal
      width={520}
      onClose={onClose}
      kicker="Install a plugin"
      title="From a link"
      footer={
        <>
          <FooterNote tone={error ? 'danger' : undefined}>{error ?? 'An https link to a .syplugin - you see what it holds before it installs.'}</FooterNote>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !url.trim()} onClick={go}>
            {busy ? 'Downloading…' : 'Download'}
          </Button>
        </>
      }
    >
      <div style={{ padding: '16px 20px' }}>
        <TextInput
          mono
          autoFocus
          value={url}
          placeholder="https://…/my-plugin-1.0.0.syplugin"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && url.trim() && !busy) go()
          }}
        />
      </div>
    </Modal>
  )
}

function PluginRow({ p, onTurn, onPackage }: { p: PluginInfo; onTurn: (on: boolean) => void; onPackage: () => void }): React.JSX.Element {
  const { dispatch } = useAppStore()
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const m = p.manifest
  const [label, color] = PLUGIN_STATUS[p.status]
  const [tag, tagColor] = SOURCE_TAG[p.source.kind]
  const name = m?.name ?? p.dir.split(/[\\/]/).pop() ?? p.dir
  const adds = [
    m?.commands?.length ? `${m.commands.length} command${m.commands.length > 1 ? 's' : ''}` : '',
    m?.agents?.length ? `${m.agents.length} agent${m.agents.length > 1 ? 's' : ''} (${m.agents.map((a) => a.name).join(', ')})` : '',
    m?.main ? 'a script' : ''
  ].filter(Boolean)
  const remove = async (): Promise<void> => {
    const dev = p.source.kind === 'development'
    const ok = await confirm({
      title: dev ? `Stop loading ${name}?` : `Uninstall ${name}?`,
      body: dev ? `Its folder stays where it is (${p.dir}).` : `Its folder is deleted (${p.dir}).`,
      confirmLabel: dev ? 'Remove' : 'Uninstall',
      danger: !dev
    })
    if (!ok) return
    window.api.plugins
      .uninstall(m?.id ?? p.dir.split(/[\\/]/).pop()!)
      .then(() => dispatch({ type: 'TOAST', text: dev ? `${name} isn't loaded any more.` : `Uninstalled ${name}.` }))
      .catch((err: unknown) => dispatch({ type: 'TOAST', text: errText(err) }))
  }
  const from = p.source.kind === 'installed' ? `Installed ${p.source.at ? new Date(p.source.at).toLocaleDateString() : ''} from ${p.source.from}` : p.source.kind === 'development' ? 'Loaded from this folder - edit it, then Reload plugins' : 'Made here (in the plugins folder)'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 14, alignItems: 'center', padding: '12px 12px 12px 16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
          <span style={{ font: '500 13px var(--font-ui)', color: 'var(--t1)' }}>{name}</span>
          {m ? <span style={{ font: `11px ${MONO}`, color: 'var(--t4)' }}>{m.version}</span> : null}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: '11.5px var(--font-ui)', color }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
            {label}
          </span>
          <span title={from} style={{ font: `10.5px ${MONO}`, color: tagColor, border: '1px solid var(--bd-3)', borderRadius: 4, padding: '0 5px' }}>
            {tag}
          </span>
        </span>
        {m?.description ? <span style={{ font: '12px/1.45 var(--font-ui)', color: 'var(--t3)' }}>{m.description}</span> : null}
        {p.error ? <span style={{ font: '12px/1.45 var(--font-ui)', color: 'var(--c-red)', overflowWrap: 'anywhere' }}>{p.error}</span> : null}
        {adds.length ? <span style={{ font: `11px ${MONO}`, color: 'var(--t4)' }}>adds {adds.join(' · ')}</span> : null}
      </div>
      <IconButton title="More" onClick={(e) => setMenu({ el: e.currentTarget })}>
        ⋯
      </IconButton>
      <UIToggle on={p.enabled} disabled={!m} onChange={onTurn} />
      {menu ? (
        <Menu
          anchor={menu}
          width={230}
          items={[
            { label: 'Package…', sub: '.syplugin', disabled: !m, onClick: onPackage },
            { label: 'Open folder', onClick: () => window.api.plugins.open(p.dir) },
            { label: p.source.kind === 'development' ? 'Stop loading it' : 'Uninstall…', danger: p.source.kind !== 'development', separatorBefore: true, onClick: () => void remove() }
          ]}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}
