import { createServer, type Server } from 'http'
import { randomBytes } from 'crypto'
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { AGENTS } from '@shared/constants'

/**
 * Claude Code reports what it does through hooks: small commands it runs
 * on events (a prompt came in, a tool is about to run, it needs approval,
 * it finished its turn). Each agent Switchyard starts gets a settings file
 * (--settings, on top of the user's own) whose hooks send the event to this
 * local listener with curl. Only requests with this run's secret count.
 */

/** The JSON Claude Code gives a hook on stdin (the fields used here). */
export interface HookEvent {
  hook_event_name: string
  session_id?: string
  transcript_path?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  message?: string
  notification_type?: string
  last_assistant_message?: string
  /** UserPromptSubmit: what was asked. */
  prompt?: string
}

type Handler = (taskId: string, event: HookEvent) => Record<string, unknown> | null | void
type McpHandler = (taskId: string, body: unknown) => Promise<unknown>

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop']

let server: Server | null = null
let port = 0
const secret = randomBytes(16).toString('hex')
let handler: Handler = () => {}

export function onHookEvent(fn: Handler): void {
  handler = fn
}

let mcp: McpHandler | null = null
/** Switchyard's MCP tools answer on the same listener: /mcp/<secret>/<task id>. */
export function onMcpRequest(fn: McpHandler): void {
  mcp = fn
}

function serveMcp(req: import('http').IncomingMessage, res: import('http').ServerResponse, taskId: string): void {
  // Streamable HTTP, answering with plain JSON; no server-sent stream.
  if (req.method === 'GET') return void res.writeHead(405, { Allow: 'POST' }).end()
  if (req.method === 'DELETE') return void res.writeHead(200).end()
  if (req.method !== 'POST' || !mcp) return void res.writeHead(404).end()
  let body = ''
  req.setEncoding('utf8')
  req.on('data', (chunk) => {
    if (body.length < 5_000_000) body += chunk
  })
  req.on('end', async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return void res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
    }
    try {
      const out = await mcp!(taskId, parsed)
      if (out == null) return void res.writeHead(202).end()
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: String(err) } }))
    }
  })
}

function listen(): Promise<number> {
  if (server) return Promise.resolve(port)
  return new Promise((resolve, reject) => {
    const s = createServer((req, res) => {
      const tools = req.url?.match(/^\/mcp\/([0-9a-f]+)\/([^/?]+)$/)
      if (tools && tools[1] === secret) return serveMcp(req, res, decodeURIComponent(tools[2]))
      // /hook/<secret>/<task id>
      const m = req.url?.match(/^\/hook\/([0-9a-f]+)\/([^/?]+)$/)
      if (req.method !== 'POST' || !m || m[1] !== secret) {
        res.writeHead(404).end()
        return
      }
      const taskId = decodeURIComponent(m[2])
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (chunk) => {
        if (body.length < 1_000_000) body += chunk
      })
      req.on('end', () => {
        // No body back unless there's a decision (a refused edit): some
        // hooks' output goes into Claude's context.
        let out: Record<string, unknown> | null | void = null
        try {
          out = handler(taskId, JSON.parse(body) as HookEvent)
        } catch {
          // not JSON - ignore
        }
        if (out) res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out))
        else res.writeHead(204).end()
      })
    })
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      server = s
      port = (s.address() as { port: number }).port
      resolve(port)
    })
  })
}

/**
 * Writes the hooks settings file for one task's agent and returns its path,
 * for `claude --settings <path>`. Rewritten on every start - the port
 * changes between app runs.
 */
export async function settingsFileFor(taskId: string, tools = false): Promise<string> {
  const p = await listen()
  const url = `http://127.0.0.1:${p}/hook/${secret}/${encodeURIComponent(taskId)}`
  // curl ships with Windows 10+, macOS and Linux. It's quick to give up, so
  // a closed app never holds the agent up.
  const command = `curl -s -m 2 -X POST -H "Content-Type: application/json" --data-binary @- ${url}`
  const hook = { hooks: [{ type: 'command', command, timeout: 5 }] }
  const settings = {
    hooks: Object.fromEntries(EVENTS.map((ev) => [ev, [ev === 'PreToolUse' || ev === 'PostToolUse' ? { matcher: '*', ...hook } : hook]])),
    // Switchyard's own tools (MCP) need no approval each time.
    ...(tools ? { permissions: { allow: ['mcp__switchyard'] } } : {})
  }
  const dir = join(app.getPath('userData'), 'agent-hooks')
  await fs.mkdir(dir, { recursive: true })
  const file = join(dir, `${taskId.replace(/[^\w.-]/g, '_')}.json`)
  await fs.writeFile(file, JSON.stringify(settings, null, 2))
  return file
}

// Relays an MCP client's stdio to the HTTP endpoint, a message a line.
// Run by the app's own executable as Node (ELECTRON_RUN_AS_NODE), so
// nothing needs installing.
const RELAY = `const http = require('http')
const url = process.argv[2]
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (line) send(line)
  }
})
process.stdin.on('end', () => setTimeout(() => process.exit(0), 200))
function send(line) {
  const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }, (res) => {
    let out = ''
    res.setEncoding('utf8')
    res.on('data', (c) => (out += c))
    res.on('end', () => { if (out.trim()) process.stdout.write(out.trim() + '\\n') })
  })
  req.on('error', (e) => {
    try {
      const m = JSON.parse(line)
      if (m.id != null) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'Switchyard is not running (' + e.message + ')' } }) + '\\n')
    } catch {}
  })
  req.end(line)
}
`

/**
 * What gives an agent Switchyard's tools (MCP) at launch - arguments, and
 * for some an environment variable: Claude Code and Copilot CLI get a
 * config file naming the HTTP endpoint; OpenCode a config file through
 * OPENCODE_CONFIG; Codex a stdio relay through -c overrides. Others: none.
 */
export async function toolLaunchFor(taskId: string, kind: string): Promise<{ args: string[]; env: Record<string, string> }> {
  const how = AGENTS.find((a) => a.kind === kind)?.tools
  if (!how) return { args: [], env: {} }
  const p = await listen()
  const url = `http://127.0.0.1:${p}/mcp/${secret}/${encodeURIComponent(taskId)}`
  const dir = join(app.getPath('userData'), 'agent-hooks')
  await fs.mkdir(dir, { recursive: true })
  const file = (ext: string): string => join(dir, `${taskId.replace(/[^\w.-]/g, '_')}.${ext}`)
  if (how === 'claude') {
    await fs.writeFile(file('mcp.json'), JSON.stringify({ mcpServers: { switchyard: { type: 'http', url } } }, null, 2))
    return { args: ['--mcp-config', file('mcp.json')], env: {} }
  }
  if (how === 'copilot') {
    await fs.writeFile(file('copilot-mcp.json'), JSON.stringify({ mcpServers: { switchyard: { type: 'http', url, tools: ['*'] } } }, null, 2))
    return { args: ['--additional-mcp-config', `@${file('copilot-mcp.json')}`], env: {} }
  }
  if (how === 'opencode') {
    await fs.writeFile(file('opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { switchyard: { type: 'remote', url, enabled: true } } }, null, 2))
    return { args: [], env: { OPENCODE_CONFIG: file('opencode.json') } }
  }
  return { args: await codexArgs(url, dir), env: {} }
}

async function codexArgs(url: string, dir: string): Promise<string[]> {
  {
    const relay = join(dir, 'mcp-relay.cjs')
    await fs.writeFile(relay, RELAY)
    // TOML literal strings: backslashes in Windows paths stay as they are.
    return [
      '-c',
      `mcp_servers.switchyard.command='${process.execPath}'`,
      '-c',
      `mcp_servers.switchyard.args=['${relay}', '${url}']`,
      '-c',
      "mcp_servers.switchyard.env={ELECTRON_RUN_AS_NODE='1'}"
    ]
  }
}
