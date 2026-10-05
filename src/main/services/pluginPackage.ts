import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, relative, sep } from 'path'
import { checkManifest, type PluginManifest } from '@shared/plugins'
import { PACKAGE_LIMITS, readZip, writeZip, type ZipFile } from './zip'

/**
 * Plugin packages (.syplugin): a zip of a plugin's folder, plugin.json at
 * its top - made by the packager (Settings → Plugins → Package…, or
 * `node pluginPack.js <folder>`), installed from a file, a link or a
 * double-click. No Electron here: the command-line packager uses it too.
 */

export const PACKAGE_EXT = '.syplugin'

// Never packed: version control, the OS's leftovers, packages, what an install adds.
const ALWAYS_LEFT_OUT = ['.git/', '.hg/', '.svn/', '.DS_Store', 'Thumbs.db', `*${PACKAGE_EXT}`, '.syplugin.json', 'node_modules/.cache/']

/** A .sypluginignore pattern as a test of a "/"-separated path (gitignore-like: *, **, a trailing / for folders, a leading / for the top). */
function patternTest(raw: string): ((path: string) => boolean) | null {
  let p = raw.trim()
  if (!p || p.startsWith('#')) return null
  const dirOnly = p.endsWith('/')
  if (dirOnly) p = p.slice(0, -1)
  const anchored = p.startsWith('/') || p.includes('/')
  p = p.replace(/^\//, '')
  const re = p
    .split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
    .join('.*')
  // A folder pattern matches everything inside it; a file pattern the file (or a folder of that name).
  const full = new RegExp(`${anchored ? '^' : '(^|/)'}${re}${dirOnly ? '/' : '(/|$)'}`)
  return (path) => full.test(dirOnly ? `${path}/` : path)
}

export function ignoreRules(text: string): (path: string) => boolean {
  const tests = [...ALWAYS_LEFT_OUT, ...text.split(/\r?\n/)].map(patternTest).filter((t): t is (p: string) => boolean => !!t)
  return (path) => tests.some((t) => t(path))
}

function readManifest(raw: string): PluginManifest {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    throw new Error(`plugin.json isn't valid JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
  const checked = checkManifest(json)
  if ('error' in checked) throw new Error(`plugin.json: ${checked.error}`)
  return checked.manifest
}

/** A plugin's folder as a package: its files (minus what's left out) and its manifest. */
export function packFolder(dir: string): { zip: Buffer; manifest: PluginManifest; files: string[]; fileName: string } {
  const manifestFile = join(dir, 'plugin.json')
  if (!existsSync(manifestFile)) throw new Error(`No plugin.json in ${dir}`)
  const manifest = readManifest(readFileSync(manifestFile, 'utf-8'))
  if (manifest.main && !existsSync(join(dir, manifest.main))) throw new Error(`plugin.json's "main" (${manifest.main}) isn't there`)
  const ignoreFile = join(dir, '.sypluginignore')
  const ignored = ignoreRules(existsSync(ignoreFile) ? readFileSync(ignoreFile, 'utf-8') : '')

  const files: ZipFile[] = []
  let total = 0
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name)
      const rel = relative(dir, full).split(sep).join('/')
      const st = lstatSync(full)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        if (!ignored(`${rel}/`) && !ignored(rel)) walk(full)
        continue
      }
      if (ignored(rel)) continue
      total += st.size
      if (files.length >= PACKAGE_LIMITS.maxFiles) throw new Error(`More than ${PACKAGE_LIMITS.maxFiles} files - leave some out with .sypluginignore`)
      if (total > PACKAGE_LIMITS.maxBytes) throw new Error(`More than ${PACKAGE_LIMITS.maxBytes / 1024 / 1024} MB - leave some out with .sypluginignore`)
      files.push({ path: rel, data: readFileSync(full) })
    }
  }
  walk(dir)
  if (manifest.main && !files.some((f) => f.path === manifest.main!.replace(/\\/g, '/').replace(/^\.\//, ''))) throw new Error(`"${manifest.main}" is left out by .sypluginignore`)
  return { zip: writeZip(files), manifest, files: files.map((f) => f.path), fileName: `${manifest.id}-${manifest.version}${PACKAGE_EXT}` }
}

export interface PackageContents {
  manifest: PluginManifest
  files: ZipFile[]
  bytes: number
}

/** What a package holds, checked (throws saying what's wrong). */
export function openPackage(zip: Buffer): PackageContents {
  const files = readZip(zip)
  const top = files.find((f) => f.path === 'plugin.json')
  if (!top) throw new Error('No plugin.json at the top of the package')
  const manifest = readManifest(top.data.toString('utf-8'))
  if (manifest.main && !files.some((f) => f.path === manifest.main!.replace(/\\/g, '/').replace(/^\.\//, ''))) throw new Error(`Its "main" (${manifest.main}) isn't in the package`)
  return { manifest, files, bytes: files.reduce((n, f) => n + f.data.length, 0) }
}

/** Writes a package's files into an (empty) folder. */
export function unpack(files: ZipFile[], into: string): void {
  for (const f of files) {
    const target = join(into, ...f.path.split('/'))
    // (Paths were checked when read; this is the belt to those braces.)
    if (relative(into, target).startsWith('..')) throw new Error(`${f.path} would land outside the plugin's folder`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, f.data)
  }
}
