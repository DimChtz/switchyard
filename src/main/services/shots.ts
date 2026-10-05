import { execFile } from 'child_process'
import { promisify } from 'util'
import { promises as fs, existsSync } from 'fs'
import { join, resolve } from 'path'

const execFileP = promisify(execFile)
const DIR = '.switchyard/shots'
const KEEP = 30

/**
 * Keeps a Preview screenshot for the agent, in the task's folder
 * (.switchyard/shots) - where it can read it - and out of git: the
 * repository's own exclude file, nothing committed changes.
 */
export async function saveShot(root: string, dataUrl: string): Promise<{ path: string; rel: string }> {
  const m = dataUrl.match(/^data:image\/png;base64,(.+)$/)
  if (!m) throw new Error('Not a PNG image')
  const dir = join(root, ...DIR.split('/'))
  await fs.mkdir(dir, { recursive: true })
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  const name = `pick-${stamp}-${Math.random().toString(36).slice(2, 6)}.png`
  const path = join(dir, name)
  await fs.writeFile(path, Buffer.from(m[1], 'base64'))
  if (existsSync(join(root, '.git'))) await exclude(root).catch(() => {})
  // Only the latest are kept.
  const old = (await fs.readdir(dir)).filter((f) => f.startsWith('pick-') && f.endsWith('.png')).sort()
  for (const f of old.slice(0, Math.max(0, old.length - KEEP))) await fs.rm(join(dir, f), { force: true })
  return { path, rel: `${DIR}/${name}` }
}

async function exclude(root: string): Promise<void> {
  const { stdout } = await execFileP('git', ['rev-parse', '--git-common-dir'], { cwd: root, windowsHide: true })
  const file = join(resolve(root, stdout.trim()), 'info', 'exclude')
  let text = ''
  try {
    text = await fs.readFile(file, 'utf-8')
  } catch {
    await fs.mkdir(join(file, '..'), { recursive: true })
  }
  if (text.split(/\r?\n/).some((l) => l.trim() === `${DIR}/` || l.trim() === DIR)) return
  await fs.writeFile(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}# Switchyard: Preview screenshots for agents\n${DIR}/\n`, 'utf-8')
}
