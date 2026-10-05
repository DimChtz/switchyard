import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, renameSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

/**
 * Switchyard's data, in SQLite (switchyard.db in the data folder): each
 * collection - projects, tasks, comments, checkpoints… - is a set of rows,
 * one JSON document per item. Reads come from a copy kept in memory; a write
 * changes only the rows that differ, in one transaction, so a crash can't
 * leave a half-written file and a big store doesn't get rewritten on every
 * change. Uses Node's built-in SQLite (no native module to rebuild).
 */

export type Coll = 'projects' | 'tasks' | 'comments' | 'notices' | 'checkpoints' | 'team' | 'activity' | 'viewedFiles' | 'usage'

interface Row {
  body: string
  ord: number
}

let db: DatabaseSync | null = null
let dir = ''
const cache = new Map<Coll, { rows: Map<string, Row> }>()

/** Opens (or creates) the database in `folder`; moves a store from before (switchyard.json, usage.json) in once. */
export function open(folder: string): void {
  if (db && dir === folder) return
  close()
  dir = folder
  const file = join(folder, 'switchyard.db')
  try {
    db = connect(file)
  } catch (err) {
    // Unreadable: kept aside (not deleted), and a fresh one started.
    const aside = `${file}.broken-${Date.now()}`
    renameSync(file, aside)
    for (const extra of ['-wal', '-shm']) if (existsSync(file + extra)) renameSync(file + extra, aside + extra)
    console.error(`[db] ${file} could not be opened (${String(err)}); moved to ${aside}`)
    db = connect(file)
  }
  if (!getKv('migrated')) importLegacy(folder)
}

function connect(file: string): DatabaseSync {
  const d = new DatabaseSync(file)
  try {
    setUp(d)
  } catch (err) {
    d.close()
    throw err
  }
  return d
}

function setUp(d: DatabaseSync): void {
  d.exec('PRAGMA journal_mode = WAL')
  d.exec('PRAGMA synchronous = NORMAL')
  d.exec('PRAGMA busy_timeout = 3000')
  d.exec(`CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (coll, id)) WITHOUT ROWID`)
  d.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  const check = d.prepare('PRAGMA quick_check').get() as Record<string, string> | undefined
  if (check && Object.values(check)[0] !== 'ok') throw new Error(`integrity check: ${Object.values(check)[0]}`)
}

export function close(): void {
  db?.close()
  db = null
  cache.clear()
}

function conn(): DatabaseSync {
  if (!db) throw new Error('The database is not open')
  return db
}

/** An item's id in its collection. Activity events and viewed-file marks have none: their content is it. */
function idOf(coll: Coll, item: unknown): string {
  if (coll === 'viewedFiles') return String(item)
  if (coll === 'usage') return (item as { sessionId: string }).sessionId
  const id = (item as { id?: unknown }).id
  if (typeof id === 'string' && id) return id
  return createHash('sha1').update(JSON.stringify(item)).digest('hex')
}

function load(coll: Coll): { rows: Map<string, Row> } {
  let c = cache.get(coll)
  if (!c) {
    const rows = new Map<string, Row>()
    for (const r of conn().prepare('SELECT id, ord, body FROM docs WHERE coll = ? ORDER BY ord').all(coll) as unknown as { id: string; ord: number; body: string }[])
      rows.set(r.id, { body: r.body, ord: r.ord })
    c = { rows }
    cache.set(coll, c)
  }
  return c
}

/** The collection's items, in order - fresh copies each time (as the JSON store gave them). */
export function all<T>(coll: Coll): T[] {
  return [...load(coll).rows.values()].sort((a, b) => a.ord - b.ord).map((r) => JSON.parse(r.body) as T)
}

/** Makes the collection exactly `items` (in this order): rows that changed are written, gone ones deleted. */
export function put<T>(coll: Coll, items: T[]): void {
  const c = load(coll)
  const d = conn()
  const next = new Map<string, Row>()
  items.forEach((item, ord) => next.set(idOf(coll, item), { body: JSON.stringify(item), ord }))
  const upsert = d.prepare('INSERT INTO docs (coll, id, ord, body) VALUES (?, ?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET ord = excluded.ord, body = excluded.body')
  const del = d.prepare('DELETE FROM docs WHERE coll = ? AND id = ?')
  d.exec('BEGIN')
  try {
    for (const [id, row] of next) {
      const was = c.rows.get(id)
      if (!was || was.body !== row.body || was.ord !== row.ord) upsert.run(coll, id, row.ord, row.body)
    }
    for (const id of c.rows.keys()) if (!next.has(id)) del.run(coll, id)
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
  cache.set(coll, { rows: next })
}

export function getKv<T>(key: string): T | undefined {
  const r = conn().prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
  return r ? (JSON.parse(r.value) as T) : undefined
}

export function setKv(key: string, value: unknown): void {
  if (value === undefined) conn().prepare('DELETE FROM kv WHERE key = ?').run(key)
  else conn().prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
}

/** The JSON files earlier versions kept: read into the database once, then kept as .bak. */
function importLegacy(folder: string): void {
  const json = join(folder, 'switchyard.json')
  const usage = join(folder, 'usage.json')
  const read = (p: string): Record<string, unknown> | null => {
    try {
      return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>) : null
    } catch (err) {
      console.error(`[db] could not read ${p}: ${String(err)}`)
      return null
    }
  }
  const old = read(json)
  const oldUsage = read(usage)
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  if (old) {
    for (const coll of ['projects', 'tasks', 'comments', 'notices', 'checkpoints', 'team', 'viewedFiles'] as const) put(coll, arr(old[coll]))
    const activity = old.activity as { events?: unknown[]; seenAt?: number; announced?: string } | undefined
    if (activity) {
      put('activity', arr(activity.events))
      setKv('activityMeta', { seenAt: activity.seenAt ?? 0, announced: activity.announced ?? '' })
    }
    if (old.window) setKv('window', old.window)
    if (old.prefs && Object.keys(old.prefs).length) setKv('legacyPrefs', old.prefs)
  }
  if (oldUsage) put('usage', arr(oldUsage.entries))
  setKv('migrated', Date.now())
  for (const p of [json, usage])
    if (existsSync(p))
      try {
        renameSync(p, `${p}.bak`)
      } catch {
        // in use - it's read again only if the database is lost
      }
}
