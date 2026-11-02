/**
 * Each worktree its own environment, so tasks running side by side don't
 * fight over port 3000 or one database: a slot number per open task (0 is
 * your own checkout), and a block of 10 ports per slot from the base port
 * (Settings → Git). Every process in a task's worktree gets
 * SWITCHYARD_SLOT, SWITCHYARD_PORT and SWITCHYARD_TASK, and these
 * placeholders in the project's environment variables are filled in:
 *   {port}  the slot's first port      {port+1} … {port+9}  the rest of its block
 *   {slot}  the slot number            {task}  the task key for names (syt_42; "main" outside a task)
 * e.g. PORT={port}, DATABASE_URL=postgres://localhost/app_{task}.
 */
export const PORTS_PER_SLOT = 10

export interface WorktreeEnvInfo {
  slot: number
  port: number
  /** The task's key, null outside a task. */
  task: string | null
}

export function slotPort(base: number, slot: number): number {
  return (base || 3100) + slot * PORTS_PER_SLOT
}

/** A task key as part of a name - a database, a cache folder: syt_42. */
export function nameSafe(key: string | null): string {
  return key ? key.toLowerCase().replace(/[^a-z0-9]+/g, '_') : 'main'
}

export function expandWorktreeEnv(env: Record<string, string>, info: WorktreeEnvInfo): Record<string, string> {
  const fill = (v: string): string =>
    v
      .replace(/\{port(?:\+(\d))?\}/g, (_m, n: string | undefined) => String(info.port + (n ? Number(n) : 0)))
      .replace(/\{slot\}/g, String(info.slot))
      .replace(/\{task\}/g, nameSafe(info.task))
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) out[k] = typeof v === 'string' ? fill(v) : v
  return { SWITCHYARD_SLOT: String(info.slot), SWITCHYARD_PORT: String(info.port), SWITCHYARD_TASK: info.task ?? '', ...out }
}

/** The line that gives each worktree its own PORT (Project settings' switch). */
export const OWN_PORT_LINE = 'PORT={port}'

export function hasOwnPort(envText: string | undefined): boolean {
  return (envText ?? '').split(/\r?\n/).some((l) => l.trim().replace(/\s+/g, '') === OWN_PORT_LINE)
}

export function withOwnPort(envText: string | undefined, on: boolean): string | undefined {
  const lines = (envText ?? '').split(/\r?\n/).filter((l) => l.trim().replace(/\s+/g, '') !== OWN_PORT_LINE)
  const next = on ? [OWN_PORT_LINE, ...lines.filter((l) => !/^\s*(export\s+)?PORT\s*=/.test(l))] : lines
  const text = next.join('\n').trim()
  return text ? text : undefined
}
