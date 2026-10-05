import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Switchyard's log: logs/main.log in the data folder (Help → Open Logs
 * Folder). Errors that used to vanish - a failed background git command, a
 * crash in the page - land here, so a problem can be traced afterwards.
 * Rotates at 5 MB (one older file kept).
 */

const MAX = 5 * 1024 * 1024
let file: string | null = null

export function logsDir(): string {
  return join(app.getPath('userData'), 'logs')
}

function target(): string {
  if (!file) {
    mkdirSync(logsDir(), { recursive: true })
    file = join(logsDir(), 'main.log')
  }
  return file
}

function detail(err: unknown): string {
  if (err instanceof Error) return err.stack || `${err.name}: ${err.message}`
  if (err === undefined) return ''
  try {
    return typeof err === 'string' ? err : JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function write(level: 'info' | 'warn' | 'error', scope: string, message: string, err?: unknown): void {
  const extra = detail(err)
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${extra ? `\n    ${extra.replace(/\n/g, '\n    ')}` : ''}\n`
  if (level === 'error') console.error(line.trimEnd())
  else if (level === 'warn') console.warn(line.trimEnd())
  try {
    const f = target()
    if (existsSync(f) && statSync(f).size > MAX) renameSync(f, join(logsDir(), 'main.old.log'))
    appendFileSync(f, line)
  } catch {
    // no log file - the console has it
  }
}

export const log = {
  info: (scope: string, message: string): void => write('info', scope, message),
  warn: (scope: string, message: string, err?: unknown): void => write('warn', scope, message, err),
  error: (scope: string, message: string, err?: unknown): void => write('error', scope, message, err)
}

/** Uncaught errors and crashed processes, written down (the app keeps going where it can). */
export function catchCrashes(): void {
  process.on('uncaughtException', (err) => log.error('main', 'Uncaught exception', err))
  process.on('unhandledRejection', (reason) => log.error('main', 'Unhandled promise rejection', reason))
  app.on('render-process-gone', (_e, wc, details) => log.error('renderer', `A page process ended: ${details.reason} (exit ${details.exitCode}) - ${wc.getURL().slice(0, 120)}`))
  app.on('child-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') log.error('process', `${details.type} process ended: ${details.reason} (exit ${details.exitCode})`)
  })
}
