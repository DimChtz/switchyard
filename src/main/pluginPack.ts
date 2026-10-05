/**
 * The plugin packager on the command line (for a build or CI):
 *
 *   node out/main/pluginPack.js <plugin folder> [-o <file or folder>]
 *
 * Writes <id>-<version>.syplugin (to the current folder, or where -o says).
 * The same as Settings → Plugins → Package… in the app.
 */
import { existsSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { packFolder } from './services/pluginPackage'

function main(argv: string[]): number {
  const args = argv.slice(2)
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log('Usage: node pluginPack.js <plugin folder> [-o <file or folder>]')
    return args.length ? 0 : 1
  }
  const o = args.indexOf('-o')
  const outArg = o >= 0 ? args[o + 1] : undefined
  const dir = resolve(args.find((a, i) => !a.startsWith('-') && (o < 0 || i !== o + 1)) ?? '.')
  try {
    const pack = packFolder(dir)
    const out = outArg ? (existsSync(outArg) && statSync(outArg).isDirectory() ? join(outArg, pack.fileName) : resolve(outArg)) : resolve(pack.fileName)
    writeFileSync(out, pack.zip)
    console.log(`${pack.manifest.name} ${pack.manifest.version}: ${pack.files.length} file${pack.files.length === 1 ? '' : 's'}, ${(pack.zip.length / 1024).toFixed(1)} KB → ${out}`)
    return 0
  } catch (err) {
    console.error(`Could not package ${dir}: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

process.exitCode = main(process.argv)
