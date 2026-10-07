import { app, BrowserWindow, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import * as team from './team'
import { spawn as spawnProcess } from 'child_process'
import { basename, join, resolve, sep } from 'path'
import { getComments, getProjects, getTasks, updateComments } from './store'
import * as ptyService from './pty'
import { freePort } from './ports'
import * as conflicts from './conflicts'
import { checkoutPath } from './conflicts'
import { commentsChanged } from './review'
import { parseEnv, COLUMN_LABEL } from '@shared/constants'
import { IPC } from '@shared/ipc'
import { baseFor, parentOf } from '@shared/stack'
import { checksMessage, prSummary, reviewMessage } from '@shared/pr'
import { prDetails } from './git'
import * as notes from './notes'
import type { AgentToolRequest, Project, Task } from '@shared/types'

/**
 * Switchyard's tools for the agents it runs, over MCP: each agent's server
 * is its task's (the URL says which), so "the preview", "the tests" and
 * "my review comments" need no arguments. Claude Code talks to it over
 * HTTP; others through a stdio relay (see hooks).
 */

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (task: Task, args: Record<string, unknown>) => Promise<Content[]>
}

const obj = (properties: Record<string, unknown> = {}, required: string[] = []): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false })
const text = (t: string): Content[] => [{ type: 'text', text: t }]
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Something the tool can't do, said to the agent (not a failure of the server). */
class ToolError extends Error {}

// ── The window: some tools act through it (the board is its state) ──
let seq = 0
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function window(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null
}

/** Asks the window to do something; resolves with what it says. */
function askWindow(req: AgentToolRequest): Promise<unknown> {
  const w = window()
  if (!w) return Promise.reject(new ToolError('Switchyard’s window is closed.'))
  const id = ++seq
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    w.webContents.send(IPC.agentToolsRequest, id, req)
    setTimeout(() => {
      if (waiting.delete(id)) reject(new ToolError('Switchyard didn’t answer.'))
    }, 15_000)
  })
}

/** Tells the window something happened (no answer needed). */
function tellWindow(req: AgentToolRequest): void {
  window()?.webContents.send(IPC.agentToolsRequest, 0, req)
}

export function registerWindowReplies(): void {
  ipcMain.handle(IPC.agentToolsReply, (_e, id: number, result: unknown, error?: string) => {
    const w = waiting.get(id)
    if (!w) return
    waiting.delete(id)
    if (error) w.reject(new ToolError(error))
    else w.resolve(result)
  })
}

// ── The task's repositories, dev server and tests ──
function reposOf(task: Task): { project: Project; path: string }[] {
  const projects = getProjects()
  return [task.projectId, ...(task.repos ?? []).filter((r) => r !== task.projectId)]
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is Project => !!p)
    .map((project) => ({ project, path: checkoutPath(task, project) ?? '' }))
    .filter((r) => r.path)
}

function pickRepo(task: Task, name: unknown): { project: Project; path: string } {
  const repos = reposOf(task)
  if (!repos.length) throw new ToolError('This task has no worktree yet.')
  if (!name) return repos[0]
  const n = String(name).toLowerCase()
  const hit = repos.find((r) => r.project.name.toLowerCase() === n || r.project.id.toLowerCase() === n || basename(r.path).toLowerCase() === n)
  if (!hit) throw new ToolError(`No repository "${name}" in this task - it has ${repos.map((r) => r.project.name).join(', ')}.`)
  return hit
}

const URL_RE = /(?:https?|tcp):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i

/** The dev server sessions of the task (the Preview tab's): home repo `preview-<id>`, others `preview-<id>~<repo>`. */
function previewSession(task: Task, project: Project): string {
  return project.id === task.projectId ? `preview-${task.id}` : `preview-${task.id}~${project.id}`
}

/** Where the task's running dev server is, from what it printed. */
function devServerUrl(task: Task, project?: Project): string | null {
  const ids = project ? [previewSession(task, project)] : ptyService.list(`preview-${task.id}`)
  for (const id of ids) {
    if (!ptyService.exists(id)) continue
    // eslint-disable-next-line no-control-regex
    const m = ptyService.getBuffer(id).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').match(URL_RE)
    if (m) return `http://localhost:${m[1]}`
  }
  return null
}

async function startDevServer(task: Task, repo: { project: Project; path: string }): Promise<string> {
  const running = devServerUrl(task, repo.project)
  if (running) return running
  if (!repo.project.devCmd) throw new ToolError(`${repo.project.name} has no dev command set (Project settings in Switchyard).`)
  const w = window()
  if (!w) throw new ToolError('Switchyard’s window is closed.')
  const id = previewSession(task, repo.project)
  const port = await freePort()
  ptyService.spawn(w.webContents, { id, cwd: repo.path, execCommand: repo.project.devCmd, env: { ...parseEnv(repo.project.env), PORT: String(port) }, cols: 120, rows: 12 })
  // Ready once it prints its address (or its port answers).
  const until = Date.now() + 90_000
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 500))
    const url = devServerUrl(task, repo.project)
    if (url) return url
    if (!ptyService.exists(id)) throw new ToolError(`The dev server exited:\n${tail(ptyService.getBuffer(id), 2000)}`)
  }
  throw new ToolError(`The dev server (${repo.project.devCmd}) didn't say where it's listening within 90s:\n${tail(ptyService.getBuffer(id), 2000)}`)
}

// eslint-disable-next-line no-control-regex
const tail = (s: string, n: number): string => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '').slice(-n).trim()

/** Loads the page in a hidden window and captures it - with what its console complained about. */
async function screenshot(url: string, opts: { width: number; height: number; fullPage: boolean; selector: string }): Promise<Content[]> {
  const win = new BrowserWindow({ show: false, width: opts.width, height: opts.height, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } })
  const errors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3 && errors.length < 10) errors.push(message.slice(0, 300))
  })
  try {
    win.webContents.setFrameRate(30)
    await Promise.race([win.loadURL(url), new Promise((_, rej) => setTimeout(() => rej(new ToolError(`${url} didn't load within 30s.`)), 30_000))])
    // Let the page render (frameworks mount after load).
    await new Promise((r) => setTimeout(r, 900))
    let rect: Electron.Rectangle | undefined
    if (opts.selector) {
      const r = (await win.webContents.executeJavaScript(
        `(() => { const el = document.querySelector(${JSON.stringify(opts.selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.left - 16)), y: Math.max(0, Math.floor(r.top - 16)), width: Math.ceil(r.width + 32), height: Math.ceil(r.height + 32) } })()`
      )) as Electron.Rectangle | null
      if (!r) throw new ToolError(`Nothing on ${url} matches ${opts.selector}.`)
      await new Promise((res) => setTimeout(res, 150))
      rect = r
    } else if (opts.fullPage) {
      const h = (await win.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)')) as number
      win.setContentSize(opts.width, Math.min(Math.max(opts.height, h), 6000))
      await new Promise((res) => setTimeout(res, 400))
    }
    let img = await win.webContents.capturePage(rect)
    const size = img.getSize()
    if (size.width > 1600) img = img.resize({ width: 1600 })
    const title = win.webContents.getTitle()
    const info = [`${url} - "${title}" at ${opts.width}px wide${rect ? `, ${opts.selector}` : opts.fullPage ? ', full page' : ''}.`, errors.length ? `Console errors:\n${errors.map((e) => `- ${e}`).join('\n')}` : 'No console errors.']
    return [{ type: 'image', data: img.toPNG().toString('base64'), mimeType: 'image/png' }, { type: 'text', text: info.join('\n') }]
  } finally {
    win.destroy()
  }
}

const testing = new Set<string>()

/** Runs the test commands of the task's repositories (or one), one after another; the output's end and each exit code. */
async function runTests(task: Task, repoName: unknown): Promise<Content[]> {
  const repos = (repoName ? [pickRepo(task, repoName)] : reposOf(task)).filter((r) => r.project.testCmd)
  if (!repos.length) throw new ToolError('No test command is set for this task’s repositories (Project settings in Switchyard).')
  if (testing.has(task.id)) throw new ToolError('Tests are already running for this task.')
  testing.add(task.id)
  try {
    const out: string[] = []
    let failed: number | null = 0
    for (const r of repos) {
      const res = await new Promise<{ code: number | null; output: string }>((resolve) => {
        let output = ''
        const p = spawnProcess(r.project.testCmd!, { cwd: r.path, shell: true, windowsHide: true, env: { ...process.env, ...parseEnv(r.project.env), CI: '1', FORCE_COLOR: '0' } })
        const add = (d: Buffer): void => {
          output = (output + d.toString()).slice(-60_000)
        }
        p.stdout.on('data', add)
        p.stderr.on('data', add)
        const timer = setTimeout(() => {
          output += '\n[stopped after 10 minutes]'
          p.kill()
        }, 600_000)
        p.on('close', (code) => {
          clearTimeout(timer)
          resolve({ code, output })
        })
        p.on('error', (err) => {
          clearTimeout(timer)
          resolve({ code: null, output: String(err) })
        })
      })
      out.push(`## ${r.project.name}: ${r.project.testCmd} → ${res.code === 0 ? 'passed' : `failed (exit ${res.code ?? '?'})`}\n${tail(res.output, repos.length > 1 ? 4000 : 8000)}`)
      if (res.code !== 0 && failed === 0) failed = res.code
    }
    tellWindow({ kind: 'tests-finished', taskId: task.id, exitCode: failed })
    return text(out.join('\n\n'))
  } finally {
    testing.delete(task.id)
  }
}

/** Where acceptance criteria's screenshots are kept. */
const evidenceDir = (): string => join(app.getPath('userData'), 'evidence')

/** An evidence screenshot as a data: URL - only files in the evidence folder. */
export async function evidenceImage(path: string): Promise<string | null> {
  const p = resolve(path)
  if (!p.startsWith(resolve(evidenceDir()) + sep)) return null
  try {
    return `data:image/png;base64,${(await fs.readFile(p)).toString('base64')}`
  } catch {
    return null
  }
}

// ── The task's terminals: its shell tabs, and the dev server, tests and setup runs ──
interface Terminal {
  id: string
  name: string
  kind: 'shell' | 'dev server' | 'tests' | 'setup'
}

const shellPrefix = (task: Task): string => `${task.id}-shell-`

async function terminalsOf(task: Task): Promise<Terminal[]> {
  // The shell tabs' names are the window's (renamed tabs too).
  const named = ((await askWindow({ kind: 'list-terminals', taskId: task.id }).catch(() => [])) as { id: string; name: string }[]) ?? []
  const shells = ptyService.list(shellPrefix(task)).map((id, i): Terminal => ({ id, name: named.find((n) => n.id === id)?.name ?? `shell ${i + 1}`, kind: 'shell' }))
  const dev = ptyService.list(`preview-${task.id}`).map((id): Terminal => ({ id, name: id.includes('~') ? `dev server (${id.split('~')[1]})` : 'dev server', kind: 'dev server' }))
  const runs = [
    { id: `tests-${task.id}`, name: 'tests', kind: 'tests' as const },
    { id: `setup-${task.id}`, name: 'setup', kind: 'setup' as const }
  ].filter((r) => ptyService.info(r.id))
  return [...shells, ...dev, ...runs]
}

function pickTerminal(list: Terminal[], which: unknown): Terminal | undefined {
  const w = str(which).trim().toLowerCase()
  if (!w) return list.find((t) => t.kind === 'shell')
  return list.find((t) => t.id.toLowerCase() === w || t.name.toLowerCase() === w) ?? (/^\d+$/.test(w) ? list.filter((t) => t.kind === 'shell')[Number(w) - 1] : undefined)
}

/** A terminal's output as text: no colors or cursor moves, and the empty lines those left (a prompt's redraws) squeezed. */
const plain = (s: string): string =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>]/g, '')
    .replace(/\r(?!\n)/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')

/** The last `lines` lines a terminal printed, as text. */
function lastLines(id: string, lines: number): string {
  const all = plain(ptyService.getBuffer(id)).split('\n')
  return all.slice(-lines).join('\n').trim()
}

/** A shell tab of the task's, made for the agent: started here, and shown in the workspace. */
function openShell(task: Task): string {
  const w = window()
  if (!w) throw new ToolError('Switchyard’s window is closed.')
  const cwd = task.taskDir || task.worktreePath
  if (!cwd) throw new ToolError('This task has no worktree yet.')
  const id = `${shellPrefix(task)}${Date.now().toString(36)}`
  ptyService.spawn(w.webContents, { id, cwd, cols: 120, rows: 30 })
  tellWindow({ kind: 'terminal-opened', taskId: task.id, id, name: 'agent shell' })
  return id
}

/** Types a command into a terminal and waits for its output to settle (or `wait` seconds). */
async function runIn(id: string, command: string, wait: number): Promise<{ output: string; settled: boolean }> {
  const before = ptyService.getBuffer(id).length
  ptyService.write(id, command.replace(/\r?\n/g, '\r') + '\r')
  const until = Date.now() + wait * 1000
  let last = before
  let quietSince = Date.now()
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 250))
    if (!ptyService.exists(id)) break
    const len = ptyService.getBuffer(id).length
    if (len !== last) {
      last = len
      quietSince = Date.now()
    } else if (len > before && Date.now() - quietSince > 1500) {
      return { output: plain(ptyService.getBuffer(id).slice(before)), settled: true }
    }
  }
  return { output: plain(ptyService.getBuffer(id).slice(before)), settled: !ptyService.exists(id) }
}

/** A note in full: its id, then its text (which starts with its heading, usually). */
const full = (n: { id: string; title: string; body: string }): string => {
  const body = n.body.trim()
  return `[note ${n.id}]\n${body.startsWith('#') ? body : `# ${n.title}\n\n${body}`}`
}

const statusText = (t: Task): string =>
  t.queued ? 'queued' : t.st === 'working' ? 'working' : t.st === 'waiting' ? (t.askKind === 'permission' ? 'waiting for approval' : 'waiting for a message') : t.st === 'failed' ? 'failed' : t.st === 'paused' ? 'paused' : 'not running'

const TOOLS: Tool[] = [
  {
    name: 'list_active_tasks',
    description:
      'The other tasks being worked on in parallel (other agents, other worktrees): their key, title, agent, status, branch and the files they change - to know who else is in the code, and whom to message with send_message.',
    inputSchema: obj(),
    run: async (task) => {
      const touched = conflicts.report().touched ?? {}
      const others = getTasks().filter((t) => t.id !== task.id && t.col !== 'done' && (t.agentKind || t.worktreePath))
      if (!others.length) return text('No other task is being worked on.')
      return text(
        others
          .map((t) => {
            const files = touched[t.id] ?? []
            return `${t.key} "${t.title}" - ${COLUMN_LABEL[t.col]}, ${t.agentKind ?? 'no agent'} (${statusText(t)}), branch ${t.branch ?? '-'}${files.length ? `\n  changes: ${files.slice(0, 25).join(', ')}${files.length > 25 ? ` (+${files.length - 25})` : ''}` : ''}`
          })
          .join('\n')
      )
    }
  },
  {
    name: 'send_message',
    description:
      "Sends a message to the agent working on another task (by its key, e.g. \"SYT-5\") - to coordinate: who changes which file, an API you are changing that they use, a finding that affects them. It reaches them when their current turn ends. Keep it short and concrete; don't start long back-and-forths.",
    inputSchema: obj({ to: { type: 'string', description: "The other task's key." }, text: { type: 'string', description: 'The message.' } }, ['to', 'text']),
    run: async (task, a) => {
      try {
        const m = team.send(task.id, str(a.to), str(a.text))
        return text(m.state === 'held' ? 'Held: you two have exchanged many messages in the last hour - the user decides whether it goes through.' : `Sent to ${str(a.to)}${m.state === 'delivered' ? '' : ' - they get it when their current turn ends'}.`)
      } catch (err) {
        throw new ToolError(err instanceof Error ? err.message : String(err))
      }
    }
  },
  {
    name: 'read_messages',
    description: "Your Team channel: the latest messages to you from other tasks' agents, the user and Switchyard, and the ones you sent.",
    inputSchema: obj(),
    run: async (task) => {
      const tasks = getTasks()
      const who = (id: string): string => (id === task.id ? 'you' : id === 'user' ? 'the user' : id === 'switchyard' ? 'Switchyard' : (tasks.find((t) => t.id === id)?.key ?? id))
      const mine = team.readFor(task.id)
      if (!mine.length) return text('No messages.')
      return text(mine.map((m) => `${new Date(m.at).toLocaleTimeString()} ${who(m.from)} -> ${who(m.to)}: ${m.text}`).join('\n'))
    }
  },
  {
    name: 'acceptance_criteria',
    description: "The task's acceptance criteria - what \"done\" means - and which are verified. Verify each with verify_criterion before you say you are done.",
    inputSchema: obj(),
    run: async (task) => {
      const list = task.criteria ?? []
      if (!list.length) return text('This task has no acceptance criteria.')
      return text(list.map((c, i) => `${i + 1}. [${c.status === 'passed' ? 'verified' : c.status === 'failed' ? 'FAILED' : 'open'}] ${c.text}${c.note ? ` - ${c.note}` : ''}`).join('\n'))
    }
  },
  {
    name: 'verify_criterion',
    description:
      'Records that you checked an acceptance criterion - passed or failed - and how, as evidence the user sees on the task: what you checked (test names, what you clicked, what you saw), and for anything visible a screenshot of the running app.',
    inputSchema: obj(
      {
        number: { type: 'number', description: "The criterion's number (1, 2, ...) from acceptance_criteria." },
        passed: { type: 'boolean', description: 'Whether it holds.' },
        how: { type: 'string', description: 'What you did to check it, and what you saw.' },
        screenshot: {
          type: 'object',
          description: 'Attach a screenshot of the running app as proof: a page path, optionally one element (CSS selector) and a width.',
          properties: { path: { type: 'string' }, selector: { type: 'string' }, width: { type: 'number' } },
          additionalProperties: false
        }
      },
      ['number', 'passed', 'how']
    ),
    run: async (task, a) => {
      const list = task.criteria ?? []
      const i = Number(a.number) - 1
      if (!list[i]) throw new ToolError(list.length ? `No criterion ${a.number} - there are ${list.length}.` : 'This task has no acceptance criteria.')
      let image: string | null = null
      const out: Content[] = []
      const shot = a.screenshot as { path?: string; selector?: string; width?: number } | undefined
      if (shot && typeof shot === 'object') {
        const base = await startDevServer(task, pickRepo(task, undefined))
        const path = str(shot.path) || '/'
        const captured = await screenshot(base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`), {
          width: Math.min(3000, Math.max(320, Number(shot.width) || 1280)),
          height: 800,
          fullPage: false,
          selector: str(shot.selector)
        })
        const img = captured.find((c) => c.type === 'image') as { data: string } | undefined
        if (img) {
          await fs.mkdir(join(evidenceDir(), task.id), { recursive: true })
          image = join(evidenceDir(), task.id, `${list[i].id}-${Date.now()}.png`)
          await fs.writeFile(image, Buffer.from(img.data, 'base64'))
          out.push(...captured)
        }
      }
      await askWindow({ kind: 'verify-criterion', taskId: task.id, index: i, passed: a.passed === true, note: str(a.how).slice(0, 1000), image })
      const left = list.filter((c, j) => j !== i && c.status !== 'passed').length + (a.passed === true ? 0 : 1)
      out.push({ type: 'text', text: `Recorded criterion ${i + 1} as ${a.passed === true ? 'verified' : 'failed'}${image ? ', with the screenshot' : ''}. ${left ? `${left} not verified yet.` : 'All criteria are verified.'}` })
      return out
    }
  },
  {
    name: 'task_info',
    description: 'The Switchyard task you are working on: its title, description, board column, branch, repositories (with their test and dev commands) and dev server.',
    inputSchema: obj(),
    run: async (task) => {
      const tasks = getTasks()
      const parent = parentOf(task, tasks)
      const lines = [
        `${task.key}: ${task.title}`,
        task.desc ? `Description: ${task.desc}` : '',
        task.scratch
          ? "This is the project's scratchpad, not a task: you work in the project's own folder, on whatever is checked out there. Do what you're asked; there's nothing to merge or hand in."
          : task.inPlace
            ? `Board column: ${COLUMN_LABEL[task.col]}. No branch of its own: you work in the project's own folder, on whatever is checked out there (the person works there too - don't switch branches or commit unless asked).`
            : `Board column: ${COLUMN_LABEL[task.col]}. Branch: ${task.branch ?? '-'}.`,
        parent
          ? parent.col === 'done'
            ? `It built on ${parent.key} "${parent.title}", which is merged now.`
            : `It builds on ${parent.key} "${parent.title}" (branch ${parent.branch ?? 'not started'}, ${COLUMN_LABEL[parent.col]}): your branch started from that one, which already has its changes - don't redo them.`
          : '',
        'Repositories:',
        ...reposOf(task).map((r) => `- ${r.project.name}: ${r.path} (base ${baseFor(task, r.project, tasks)}; tests: ${r.project.testCmd || 'none'}; dev server: ${r.project.devCmd || 'none'}${devServerUrl(task, r.project) ? `, running at ${devServerUrl(task, r.project)}` : ''})`)
      ]
      return text(lines.filter(Boolean).join('\n'))
    }
  },
  {
    name: 'preview_screenshot',
    description:
      'Screenshot of the running app (the task\'s dev server), to check UI changes yourself. Starts the dev server if it isn\'t running. Also reports the page\'s console errors. Use after changing anything visible.',
    inputSchema: obj({
      path: { type: 'string', description: 'Page path, e.g. "/settings". Default "/".' },
      selector: { type: 'string', description: 'CSS selector: capture just that element (with a little room around it).' },
      width: { type: 'number', description: 'Viewport width in px (e.g. 375 for a phone). Default 1280.' },
      height: { type: 'number', description: 'Viewport height in px. Default 800.' },
      fullPage: { type: 'boolean', description: 'Capture the whole page, not just the first screen.' },
      repo: { type: 'string', description: 'For a task in several repositories: whose dev server. Default: the main one.' }
    }),
    run: async (task, a) => {
      const repo = pickRepo(task, a.repo)
      const base = await startDevServer(task, repo)
      const path = str(a.path) || '/'
      const url = /^https?:/i.test(path) ? path : base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`)
      if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url + '/')) throw new ToolError('Only the task’s own dev server (localhost) can be captured.')
      const width = Math.min(3000, Math.max(320, Number(a.width) || 1280))
      const height = Math.min(3000, Math.max(240, Number(a.height) || 800))
      return screenshot(url, { width, height, fullPage: a.fullPage === true, selector: str(a.selector) })
    }
  },
  {
    name: 'start_dev_server',
    description: 'Starts the task\'s dev server (its project\'s dev command, in your worktree, on a free port) - or says where it already runs. It shows in Switchyard\'s Preview tab.',
    inputSchema: obj({ repo: { type: 'string', description: 'For a task in several repositories: which one. Default: the main one.' } }),
    run: async (task, a) => text(`Running at ${await startDevServer(task, pickRepo(task, a.repo))}`)
  },
  {
    name: 'run_tests',
    description: 'Runs the project\'s test command in your worktree (each repository\'s, for a task in several) and returns the result and the end of the output. The result also shows on the task\'s card.',
    inputSchema: obj({ repo: { type: 'string', description: 'Only this repository\'s tests.' } }),
    run: (task, a) => runTests(task, a.repo)
  },
  {
    name: 'check_conflicts',
    description:
      'Whether other tasks running in parallel (other agents, other worktrees) change the same files as you, and whether your changes still merge with them and with the base branch. Uncommitted changes count. Check before big refactors and before finishing.',
    inputSchema: obj(),
    run: async (task) => {
      const r = await conflicts.scan()
      const tasks = getTasks()
      const name = (id: string | null): string => {
        if (!id) return 'the base branch'
        const t = tasks.find((x) => x.id === id)
        return t ? `${t.key} "${t.title}" (branch ${t.branch})` : id
      }
      // A task in several repositories works in its folder: paths start with the repository's folder.
      const projects = getProjects()
      const at = (repoId: string, f: string): string => {
        const p = projects.find((x) => x.id === repoId)
        const path = p && task.taskDir ? checkoutPath(task, p) : null
        return path ? `${basename(path)}/${f}` : f
      }
      const inRepo = (repoId: string): string => {
        const p = projects.find((x) => x.id === repoId)
        const path = p && task.taskDir ? checkoutPath(task, p) : null
        return path ? `-C ${basename(path)} ` : ''
      }
      const mine = r.pairs.filter((p) => p.a === task.id || p.b === task.id).map((p) => ({ ...p, files: p.files.map((f) => at(p.repoId, f)), conflicts: p.conflicts.map((f) => at(p.repoId, f)) }))
      if (!mine.length) return text('No other running task changes the same files as you, and your changes merge cleanly with the base branch.')
      return text(
        mine
          .map((p) => {
            const other = p.a === task.id ? p.b : p.a
            if (!other && p.b === null) return `Your changes conflict with ${name(null)} in: ${p.conflicts.join(', ')} - rebase or merge the base branch in and resolve them.`
            return `${name(other)} also changes: ${p.files.join(', ')}.${p.conflicts.length ? ` These won't merge cleanly with yours: ${p.conflicts.join(', ')}.` : ' The edits still merge cleanly.'} See theirs with: git ${inRepo(p.repoId)}diff ${baseFor(tasks.find((x) => x.id === other) ?? {}, projects.find((x) => x.id === p.repoId) ?? { id: p.repoId }, tasks)}...${tasks.find((x) => x.id === other)?.branch ?? ''} -- <file>`
          })
          .join('\n')
      )
    }
  },
  {
    name: 'review_comments',
    description: 'The review comments the user left on your changes that are still open, with their numbers, files, lines, and the conversation on each.',
    inputSchema: obj(),
    run: async (task) => {
      const open = getComments().filter((c) => c.taskId === task.id && !c.pending && !c.resolved)
      if (!open.length) return text('No open review comments.')
      return text(
        open
          .map((c) => {
            const where = c.newLine != null ? `${c.path} line ${c.newLine}${c.toLine != null && c.toLine !== c.newLine ? `-${c.toLine}` : ''}` : c.oldLine != null ? `${c.path} (removed line ${c.oldLine})` : c.path
            const thread = (c.thread ?? []).map((r) => `  ${r.from === 'agent' ? 'you' : 'user'}: ${r.text}`).join('\n')
            return `[${c.ref ?? '?'}] ${where}: ${c.text}${thread ? `\n${thread}` : ''}`
          })
          .join('\n')
      )
    }
  },
  {
    name: 'reply_to_review_comment',
    description: 'Answers one of the user\'s review comments (by its number) - it shows in the comment\'s thread in Switchyard. Say what you changed, or why not.',
    inputSchema: obj({ ref: { type: 'number', description: 'The comment\'s number, e.g. 3 for [3].' }, text: { type: 'string', description: 'Your answer.' } }, ['ref', 'text']),
    run: async (task, a) => {
      const c = getComments().find((x) => x.taskId === task.id && x.ref === Number(a.ref))
      if (!c) throw new ToolError(`No review comment [${a.ref}] on this task.`)
      const reply = str(a.text).trim()
      if (!reply) throw new ToolError('The answer is empty.')
      updateComments([{ id: c.id, patch: { awaiting: false, thread: [...(c.thread ?? []), { from: 'agent', text: reply.slice(0, 2000), at: Date.now() }] } }])
      commentsChanged({ taskId: task.id, replies: 1 })
      return text(`Answered [${c.ref}].`)
    }
  },
  {
    name: 'create_task',
    description:
      'Adds a task to the project\'s board in Switchyard - for follow-up work you find that is outside this task (a bug elsewhere, a refactor for later). The user decides when it starts.',
    inputSchema: obj({ title: { type: 'string', description: 'Short title.' }, description: { type: 'string', description: 'What to do and why - enough for another agent to start from.' }, ready: { type: 'boolean', description: 'Put it in Ready (clear enough to start) rather than Backlog.' }, builds_on_this: { type: 'boolean', description: 'It needs your changes: its branch will start from yours (a follow-up step), instead of from the base branch.' } }, ['title']),
    run: async (task, a) => {
      const title = str(a.title).trim()
      if (!title) throw new ToolError('The title is empty.')
      const buildsOn = a.builds_on_this === true
      const key = (await askWindow({ kind: 'create-task', taskId: task.id, title: title.slice(0, 200), description: str(a.description).slice(0, 4000), ready: a.ready === true, buildsOn })) as string
      return text(`Created ${key} on the board${buildsOn ? `, building on ${task.key}: its branch starts from yours` : ''}.`)
    }
  },
  {
    name: 'list_terminals',
    description:
      "The task's terminals in Switchyard - the shell tabs the user (or you) opened, its dev server, its tests and setup runs: their names, whether they run, and their last line. Read one with read_terminal; type into a shell with run_in_terminal.",
    inputSchema: obj(),
    run: async (task) => {
      const list = await terminalsOf(task)
      if (!list.length) return text('No terminals are open for this task. run_in_terminal opens a shell.')
      return text(list.map((t) => `- ${t.name} [${t.kind}] ${ptyService.exists(t.id) ? 'running' : `exited (${ptyService.info(t.id)?.exitCode ?? '?'})`}: ${lastLines(t.id, 1).slice(0, 200) || '(no output yet)'}`).join('\n'))
    }
  },
  {
    name: 'read_terminal',
    description: "What one of the task's terminals printed lately (its name from list_terminals: a shell tab, \"dev server\", \"tests\", \"setup\") - e.g. the dev server's errors, or a command the user ran.",
    inputSchema: obj({ terminal: { type: 'string', description: 'Its name or number from list_terminals. Default: the first shell tab.' }, lines: { type: 'number', description: 'How many of the last lines (default 80, at most 500).' } }),
    run: async (task, a) => {
      const list = await terminalsOf(task)
      const t = pickTerminal(list, a.terminal)
      if (!t) throw new ToolError(list.length ? `No terminal "${str(a.terminal)}" - there are: ${list.map((x) => x.name).join(', ')}.` : 'No terminals are open for this task.')
      const n = Math.min(500, Math.max(1, Number(a.lines) || 80))
      return text(`${t.name} (${ptyService.exists(t.id) ? 'running' : 'exited'}), last ${n} lines:\n${lastLines(t.id, n) || '(nothing yet)'}`)
    }
  },
  {
    name: 'run_in_terminal',
    description:
      "Types a command into one of the task's shell tabs in Switchyard (the user sees it there) and returns what it printed once the output settles. For things that keep running and that the user should see - a watcher, a REPL, a server - or to use a shell the user set up. Opens a shell tab when there's none (or new_terminal). For ordinary commands your own shell tool is simpler.",
    inputSchema: obj(
      {
        command: { type: 'string', description: 'The command line to type (Enter is pressed after it).' },
        terminal: { type: 'string', description: 'A shell tab by name or number (list_terminals). Default: the first one.' },
        new_terminal: { type: 'boolean', description: 'Open a new shell tab for it.' },
        wait_seconds: { type: 'number', description: 'How long to wait for output at most (default 15, at most 120).' }
      },
      ['command']
    ),
    run: async (task, a) => {
      const command = str(a.command)
      if (!command.trim()) throw new ToolError('The command is empty.')
      const shells = (await terminalsOf(task)).filter((t) => t.kind === 'shell' && ptyService.exists(t.id))
      let id: string
      if (a.new_terminal === true || !shells.length) {
        id = openShell(task)
        // Its prompt first (a profile script, oh-my-posh…).
        const until = Date.now() + 8000
        let len = -1
        while (Date.now() < until) {
          await new Promise((r) => setTimeout(r, 400))
          const now = ptyService.getBuffer(id).length
          if (now > 0 && now === len) break
          len = now
        }
      } else {
        const t = pickTerminal(shells, a.terminal)
        if (!t) throw new ToolError(`No running shell "${str(a.terminal)}" - there are: ${shells.map((x) => x.name).join(', ')}.`)
        id = t.id
      }
      const r = await runIn(id, command, Math.min(120, Math.max(1, Number(a.wait_seconds) || 15)))
      const out = r.output.trim().slice(-8000)
      return text(`${out || '(no output)'}${r.settled ? '' : '\n[still running - read_terminal shows more later]'}`)
    }
  },
  {
    name: 'stop_dev_server',
    description: "Stops the task's dev server (started by start_dev_server or the Preview tab) - e.g. to restart it after changing its config.",
    inputSchema: obj({ repo: { type: 'string', description: 'For a task in several repositories: which one. Default: the main one.' } }),
    run: async (task, a) => {
      const id = previewSession(task, pickRepo(task, a.repo).project)
      if (!ptyService.exists(id)) return text('The dev server isn’t running.')
      ptyService.kill(id)
      return text('Stopped the dev server.')
    }
  },
  {
    name: 'read_notes',
    description: "The user's notes for this task (Markdown, often decisions and context) in full, and the titles of the project's other notes. Pass an id to read one of those.",
    inputSchema: obj({ id: { type: 'string', description: "A note's id (from the list) to read in full." } }),
    run: async (task, a) => {
      const all = await notes.list()
      if (str(a.id)) {
        const n = all.find((x) => x.id === str(a.id))
        if (!n) throw new ToolError(`No note "${str(a.id)}".`)
        return text(full(n))
      }
      const mine = all.filter((n) => n.taskId === task.id)
      const project = all.filter((n) => n.projectId === task.projectId && n.taskId !== task.id)
      if (!mine.length && !project.length) return text('No notes for this task or its project.')
      return text(
        [
          ...mine.map(full),
          project.length ? `Other notes in the project (read_notes with an id):\n${project.map((n) => `- ${n.title} (${n.id})`).join('\n')}` : ''
        ]
          .filter(Boolean)
          .join('\n\n---\n\n')
      )
    }
  },
  {
    name: 'write_note',
    description: "Writes a note linked to this task in the user's notes (Markdown) - decisions, findings, a plan, a handover - for the user and for later agents. With an id, replaces that note's text.",
    inputSchema: obj({ title: { type: 'string', description: 'Its title (becomes its first heading).' }, text: { type: 'string', description: 'The note, in Markdown.' }, id: { type: 'string', description: 'Update this note (one of this task’s) instead of writing a new one.' } }, ['title', 'text']),
    run: async (task, a) => {
      const title = str(a.title).trim()
      if (!title) throw new ToolError('The title is empty.')
      const id = (await askWindow({ kind: 'write-note', taskId: task.id, title: title.slice(0, 200), body: str(a.text).slice(0, 50_000), id: str(a.id) || null })) as string
      return text(`Saved the note "${title}" (${id}), linked to ${task.key}.`)
    }
  },
  {
    name: 'pull_request',
    description: "The task's pull request on GitHub: its state, CI checks (with the failing ones), review decision and the reviewers' comments - to fix what CI or reviewers found.",
    inputSchema: obj(),
    run: async (task) => {
      if (!task.pr) return text('This task has no pull request yet.')
      const cwd = task.worktreePath ?? reposOf(task)[0]?.path
      if (!cwd) throw new ToolError('This task has no worktree.')
      const d = await prDetails(cwd, task.pr.url)
      if (!d) throw new ToolError(`Couldn't read ${task.pr.url} - is the GitHub CLI installed and signed in?`)
      return text(
        [`${d.url} - ${d.state}${d.reviewDecision ? `, review: ${d.reviewDecision.toLowerCase().replace(/_/g, ' ')}` : ''}. ${prSummary(d).text}`, checksMessage(d), reviewMessage(d)].filter(Boolean).join('\n\n')
      )
    }
  },
  {
    name: 'ready_for_review',
    description: "Tells Switchyard you're done: the task moves to Review on the board and the user is told, with your summary. Use when the work is complete (and its acceptance criteria verified).",
    inputSchema: obj({ summary: { type: 'string', description: 'What you did, briefly - shown to the user.' } }, ['summary']),
    run: async (task, a) => {
      if (task.scratch) throw new ToolError("The scratchpad isn't a task - there's no review.")
      if (task.col !== 'progress') return text(`${task.key} is in ${COLUMN_LABEL[task.col]} already.`)
      await askWindow({ kind: 'ready-for-review', taskId: task.id, summary: str(a.summary).slice(0, 2000) })
      return text(`${task.key} is in Review now.`)
    }
  },
  {
    name: 'ask_user',
    description:
      'Asks the user a question through Switchyard\'s notifications (they may be away from the terminal). Their answer arrives as your next message - after asking, finish your turn unless you can go on without it.',
    inputSchema: obj({ question: { type: 'string', description: 'The question - self-contained, with the options if there are any.' } }, ['question']),
    run: async (task, a) => {
      const q = str(a.question).trim()
      if (!q) throw new ToolError('The question is empty.')
      await askWindow({ kind: 'ask-user', taskId: task.id, question: q.slice(0, 2000) })
      return text('Asked. The answer will come as your next message.')
    }
  }
]

export const TOOL_NAMES = TOOLS.map((t) => t.name)

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

/** One JSON-RPC message from an agent's MCP client; null for notifications (no answer). */
async function handleOne(taskId: string, msg: Message): Promise<Record<string, unknown> | null> {
  if (msg.id === undefined || msg.id === null) return null
  const ok = (result: unknown): Record<string, unknown> => ({ jsonrpc: '2.0', id: msg.id, result })
  const fail = (code: number, message: string): Record<string, unknown> => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } })
  switch (msg.method) {
    case 'initialize': {
      const asked = str(msg.params?.protocolVersion)
      return ok({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'switchyard', version: app.getVersion() },
        instructions:
          'Switchyard runs this task, alongside other tasks and agents. Use preview_screenshot to look at UI changes yourself, run_tests to check your work, check_conflicts before large changes or finishing, and review_comments / reply_to_review_comment for the user\'s review. If the task has acceptance criteria (acceptance_criteria), prove each with verify_criterion before you finish. list_active_tasks shows who else works in parallel; send_message / read_messages coordinate with them. Use ask_user when you need a decision while the user may be away. The task\'s terminals (the user\'s shell tabs, the dev server) are list_terminals / read_terminal / run_in_terminal; its notes read_notes / write_note; its pull request\'s checks and reviews pull_request. When you\'re done, ready_for_review.'
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    case 'tools/call': {
      const name = str(msg.params?.name)
      const tool = TOOLS.find((t) => t.name === name)
      if (!tool) return fail(-32602, `Unknown tool: ${name}`)
      const task = getTasks().find((t) => t.id === taskId)
      if (!task) return ok({ content: text('This task is no longer on Switchyard’s board.'), isError: true })
      try {
        return ok({ content: await tool.run(task, (msg.params?.arguments as Record<string, unknown>) ?? {}) })
      } catch (err) {
        const message = err instanceof ToolError ? err.message : `Switchyard couldn't do it: ${err instanceof Error ? err.message : String(err)}`
        return ok({ content: text(message), isError: true })
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`)
  }
}

/** A request body (a message, or a batch of them); null when nothing needs an answer. */
export async function handleMcp(taskId: string, body: unknown): Promise<unknown> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleOne(taskId, m as Message)))).filter(Boolean)
    return out.length ? out : null
  }
  return handleOne(taskId, (body ?? {}) as Message)
}
