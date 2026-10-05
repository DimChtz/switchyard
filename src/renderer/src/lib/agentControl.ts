import { AGENTS, parseEnv } from '@shared/constants'
import type { AgentKind, Prefs, Project, Task } from '@shared/types'

export function agentSessionId(taskId: string): string {
  return `agent-${taskId}`
}

export function setupSessionId(taskId: string): string {
  return `setup-${taskId}`
}

export function testsSessionId(taskId: string): string {
  return `tests-${taskId}`
}

/**
 * Runs a shell command as a terminal session (so its output can be watched
 * live and reopened later) and resolves with its exit code.
 */
export function runCommandSession(
  id: string,
  cwd: string,
  command: string,
  env: Record<string, string>,
  onData?: (data: string) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    const offData = onData
      ? window.api.pty.onData((dataId, data) => {
          if (dataId === id) onData(data)
        })
      : () => {}
    const offExit = window.api.pty.onExit((exitId, exitCode) => {
      if (exitId !== id) return
      offData()
      offExit()
      resolve(exitCode)
    })
    window.api.pty.spawn({ id, cwd, execCommand: command, env, cols: 120, rows: 30 }).catch((err) => {
      offData()
      offExit()
      reject(err)
    })
  })
}

/**
 * Stops every process this app runs in a task's worktree (agent, setup,
 * tests, dev server) - before the worktree is merged away or removed, so
 * nothing keeps running in (or locking) a deleted folder.
 */
export async function killTaskSessions(taskId: string): Promise<void> {
  await Promise.all([
    ...[agentSessionId(taskId), setupSessionId(taskId), testsSessionId(taskId), `preview-${taskId}`].map((id) => window.api.pty.kill(id)),
    window.api.pty.killPrefix(shellPrefix(taskId)),
    // A task in several repositories: the others' dev servers and setup runs.
    window.api.pty.killPrefix(`preview-${taskId}~`),
    window.api.pty.killPrefix(`${setupSessionId(taskId)}-`)
  ])
}

/** Session ids of a task's terminal tabs start with this. */
export function shellPrefix(taskId: string): string {
  return `${taskId}-shell-`
}

/** The project's environment variables (Project settings), for anything run in its worktrees. */
export function projectEnv(project: Project | undefined): Record<string, string> {
  return parseEnv(project?.env)
}

/** Agent TUIs submit on Enter, so multi-line text is sent as one line (where it can't go as a paste). */
export function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim()
}

/**
 * Each CLI's flag for the model, and whether it can plan before it acts
 * (the Start modal's per-task choices). Null: it has no such flag.
 */
export const MODEL_FLAG: Partial<Record<AgentKind, string>> = {
  claude: '--model',
  codex: '--model',
  gemini: '--model',
  aider: '--model',
  opencode: '--model',
  cursor: '--model',
  copilot: '--model'
}

/** Models offered for each agent (any other can be typed). */
export const MODEL_SUGGESTIONS: Partial<Record<AgentKind, string[]>> = {
  claude: ['opus', 'sonnet', 'haiku'],
  codex: ['gpt-5-codex', 'gpt-5', 'gpt-5-mini'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash']
}

/** Agents that can be told to plan first and wait for a go-ahead. */
export function canPlanFirst(kind: AgentKind | null | undefined): boolean {
  return kind === 'claude'
}

/** The task's own choices as arguments: its model, and plan mode. */
export function taskArgs(task: Pick<Task, 'agentKind' | 'model' | 'planFirst'>): string[] {
  const kind = task.agentKind
  if (!kind) return []
  const args: string[] = []
  const flag = MODEL_FLAG[kind]
  if (task.model?.trim() && flag) args.push(flag, task.model.trim())
  if (task.planFirst && canPlanFirst(kind)) args.push('--permission-mode', 'plan')
  return args
}

/** Short line describing what a blocked agent wants, for cards and banners. */
export function askText(task: Task): string {
  if (task.st === 'failed') return task.ask ?? 'The agent exited with an error.'
  if (task.askKind === 'permission') return task.ask ?? 'Waiting for your approval.'
  // With Claude Code's hooks, the activity is its last message.
  return task.activity ? `Finished its turn: ${task.activity}` : 'Finished its turn - waiting for your next message.'
}

/**
 * Starts the task's agent CLI in its worktree.
 *  - 'fresh': a new session with the task's first message.
 *  - 'resume': reopen the previous conversation when the CLI supports it
 *    (Claude's --continue), optionally with a follow-up message; otherwise
 *    a new session with the first message again.
 */
export async function startAgent(task: Task, project: Project, prefs: Prefs, mode: 'fresh' | 'resume', followUp?: string): Promise<void> {
  const def = AGENTS.find((a) => a.kind === task.agentKind)
  if (!def) throw new Error('This task has no agent.')
  if (!project.repoPath || !task.worktreePath) throw new Error('This task has no worktree.')
  const bin = (await window.api.agents.resolveBin(def.kind)) ?? def.bin
  // Options go after the message: some take several values and would
  // otherwise swallow it.
  // Plan first replaces the permission mode for the start (plan, then you approve the plan).
  const perms = task.planFirst && canPlanFirst(def.kind) && mode === 'fresh' ? permissionArgs(def.kind, prefs).filter((a, i, all) => a !== '--permission-mode' && all[i - 1] !== '--permission-mode') : permissionArgs(def.kind, prefs)
  const options = [...perms, ...splitArgs(prefs.agentArgs[def.kind] ?? ''), ...(mode === 'fresh' ? taskArgs(task) : taskArgs({ ...task, planFirst: false }))]
  // An agent that can't take a message at launch gets it typed in once it's ready.
  let typed: string | null = null
  const prompt = (msg: string | null | undefined): string[] => {
    if (!msg) return []
    if (def.typesPrompt) {
      typed = msg
      return []
    }
    return def.promptFlag ? [def.promptFlag, msg] : [msg]
  }

  // Claude Code reports its status through hooks (see main/services/hooks),
  // and its own session id lets Resume reopen exactly that conversation.
  if (def.kind === 'claude') options.push('--settings', await window.api.agents.hookSettings(task.id, prefs.agentTools))
  // Switchyard's tools for it (MCP): screenshots of the preview, tests, conflicts, review, the board.
  const tools = prefs.agentTools ? await window.api.agents.toolLaunch(task.id, def.kind) : { args: [], env: {} }
  options.push(...tools.args)
  // Its own conversation when it's known (Claude Code's from its hooks; one brought in from outside).
  const resumeArgs = task.session?.id && def.kind === 'claude' ? ['--resume', task.session.id] : task.session?.id && def.kind === 'codex' ? ['resume', task.session.id] : def.resumeArgs

  let args: string[]
  if (mode === 'resume' && resumeArgs) args = [...resumeArgs, ...prompt(followUp)]
  else if (followUp && mode === 'resume') args = prompt(followUp)
  else args = prompt(task.firstMessage)
  args = [...args, ...options]

  const id = agentSessionId(task.id)
  const env = { ...projectEnv(project), ...tools.env }
  // A task in several repositories works in its folder, where they sit side by side.
  const cwd = task.taskDir || task.worktreePath
  await window.api.pty.spawn({ id, cwd, cmd: bin, args, env })
  if (typed) await window.api.agents.typeWhenReady(task.id, typed)
  if (mode !== 'resume' || !resumeArgs) return

  // There may be no previous conversation to reopen (never saved, or
  // cleared): the CLI then says so and exits straight away - start a fresh
  // session with the task's message instead. Any other quick exit (you
  // quit it, it failed) is left as it is - a fresh start would redo the
  // whole task.
  const fresh = [task.firstMessage, followUp].filter(Boolean).join('\n\n')
  const off = window.api.pty.onExit(async (exitId) => {
    if (exitId !== id) return
    off()
    clearTimeout(timer)
    const out = await window.api.pty.getBuffer(id)
    if (!/no (previous |prior )?(conversation|session)s? (was |were )?(found|to (resume|continue))|no conversation found/i.test(out)) return
    typed = null
    await window.api.pty.spawn({ id, cwd, cmd: bin, args: [...prompt(fresh), ...options], env })
    if (typed) await window.api.agents.typeWhenReady(task.id, typed)
  })
  const timer = setTimeout(off, 15_000)
}

/**
 * Each CLI's flags for the permission settings (Settings → Agents).
 * "agent" leaves the CLI's own configuration alone.
 */
export function permissionArgs(kind: AgentKind, prefs: Prefs): string[] {
  if (kind === 'codex') return codexPermissionArgs(prefs)
  if (kind === 'gemini') return geminiPermissionArgs(prefs)
  if (kind === 'aider') return prefs.editPerm === 'auto' && prefs.shellPerm === 'auto' ? ['--yes-always'] : []
  if (kind === 'cursor') return prefs.shellPerm === 'auto' ? ['--force'] : []
  if (kind === 'copilot') return copilotPermissionArgs(prefs)
  // OpenCode keeps its permissions in its own configuration.
  if (kind === 'opencode') return []
  const args: string[] = []
  if (prefs.editPerm === 'auto') args.push('--permission-mode', 'acceptEdits')
  else if (prefs.editPerm === 'ask') args.push('--permission-mode', 'default')
  if (prefs.shellPerm === 'auto') args.push('--allowedTools', 'Bash')
  else if (prefs.shellPerm === 'allowlist') {
    const tools = prefs.allowlist
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => `Bash(${c}:*)`)
    if (tools.length) args.push('--allowedTools', ...tools)
  } else if (prefs.shellPerm === 'ask' && prefs.editPerm === 'agent') args.push('--permission-mode', 'default')
  return args
}

/**
 * Codex: file edits are governed by its sandbox, commands by its approval
 * policy. It has no per-command allow list, so "allowlist" asks for anything
 * it doesn't consider safe (untrusted).
 */
function codexPermissionArgs(prefs: Prefs): string[] {
  const args: string[] = []
  if (prefs.editPerm === 'auto') args.push('--sandbox', 'workspace-write')
  else if (prefs.editPerm === 'ask') args.push('--sandbox', 'read-only')
  const approval =
    prefs.shellPerm === 'auto'
      ? prefs.editPerm === 'ask'
        ? 'on-request'
        : 'never'
      : prefs.shellPerm === 'ask' || prefs.shellPerm === 'allowlist'
        ? 'untrusted'
        : prefs.editPerm === 'ask'
          ? 'on-request'
          : null
  if (approval) args.push('--ask-for-approval', approval)
  return args
}

/** Copilot CLI: tools allowed without asking - all of them, or file writes and the allowlist's commands. */
function copilotPermissionArgs(prefs: Prefs): string[] {
  if (prefs.shellPerm === 'auto' && prefs.editPerm !== 'ask') return ['--allow-all-tools']
  const args: string[] = []
  if (prefs.editPerm === 'auto') args.push('--allow-tool', 'write')
  if (prefs.shellPerm === 'allowlist')
    for (const c of prefs.allowlist
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean))
      args.push('--allow-tool', `shell(${c})`)
  return args
}

/** Gemini CLI: one approval mode covers edits and commands. */
function geminiPermissionArgs(prefs: Prefs): string[] {
  if (prefs.editPerm === 'auto' && prefs.shellPerm === 'auto') return ['--approval-mode', 'yolo']
  if (prefs.editPerm === 'auto') return ['--approval-mode', 'auto_edit']
  if (prefs.editPerm === 'ask' || prefs.shellPerm === 'ask' || prefs.shellPerm === 'allowlist') return ['--approval-mode', 'default']
  return []
}

/** Splits "--model opus --foo 'a b'" into arguments. */
export function splitArgs(s: string): string[] {
  return [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3])
}
