import { crc32, deflateRawSync, inflateRawSync } from 'zlib'

/**
 * A small zip writer and reader (plugin packages, .syplugin) on Node's own
 * zlib. The reader is strict, since a package comes from anywhere: only
 * relative paths that stay inside, no links, no zip64, and limits on the
 * number of files and their size (no zip bombs).
 */

export interface ZipFile {
  /** "/"-separated, relative. */
  path: string
  data: Buffer
}

export interface ZipLimits {
  maxFiles: number
  /** Unpacked, all files together. */
  maxBytes: number
}

export const PACKAGE_LIMITS: ZipLimits = { maxFiles: 5000, maxBytes: 50 * 1024 * 1024 }

/** Whether a path in a zip may be written out: relative, inside, plain. */
export function safeEntryPath(name: string): string | null {
  const p = name.replace(/\\/g, '/')
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.includes('\0')) return null
  const parts = p.split('/').filter((s, i, all) => s !== '' || i === all.length - 1)
  if (parts.some((s) => s === '..' || s === '.')) return null
  // Names Windows can't hold (and a stream after a colon).
  if (parts.some((s) => /[<>:"|?*\x00-\x1f]/.test(s) || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s))) return null // eslint-disable-line no-control-regex
  return parts.join('/')
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }
}

/** The files as a zip (deflated; a file that doesn't shrink is stored). */
export function writeZip(files: ZipFile[], when = new Date()): Buffer {
  const { time, date } = dosTime(when)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.path, 'utf8')
    const deflated = deflateRawSync(f.data, { level: 9 })
    const stored = deflated.length >= f.data.length
    const body = stored ? f.data : deflated
    const crc = crc32(f.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x031e, 4) // made by: Unix, 3.0
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(stored ? 0 : 8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(f.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38) // a regular file, rw-r--r--
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/** A zip's files - or an error saying why it can't be used. Folders are left out (they're implied). */
export function readZip(zip: Buffer, limits: ZipLimits = PACKAGE_LIMITS): ZipFile[] {
  // The end record: in the last 64 KB (after it, at most a comment).
  let end = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error("It isn't a zip file")
  const count = zip.readUInt16LE(end + 10)
  const cdSize = zip.readUInt32LE(end + 12)
  const cdStart = zip.readUInt32LE(end + 16)
  if (count === 0xffff || cdStart === 0xffffffff) throw new Error('Zip64 packages aren’t supported')
  if (count > limits.maxFiles) throw new Error(`It has ${count} files (at most ${limits.maxFiles})`)
  if (cdStart + cdSize > end) throw new Error('The zip is damaged')

  const out: ZipFile[] = []
  const seen = new Set<string>()
  let total = 0
  let p = cdStart
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('The zip is damaged')
    const flags = zip.readUInt16LE(p + 8)
    const method = zip.readUInt16LE(p + 10)
    const crc = zip.readUInt32LE(p + 16)
    const csize = zip.readUInt32LE(p + 20)
    const usize = zip.readUInt32LE(p + 24)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const madeBy = zip.readUInt16LE(p + 4) >> 8
    const attrs = zip.readUInt32LE(p + 38)
    const localAt = zip.readUInt32LE(p + 42)
    const rawName = zip.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x0800 ? 'utf8' : 'latin1')
    p += 46 + nameLen + extraLen + commentLen

    if (flags & 0x0001) throw new Error(`${rawName} is encrypted`)
    // A symbolic link (Unix mode in the high bits) could point anywhere.
    if (madeBy === 3 && ((attrs >>> 16) & 0o170000) === 0o120000) throw new Error(`${rawName} is a link - packages can't hold links`)
    if (rawName.endsWith('/')) continue
    const path = safeEntryPath(rawName)
    if (!path) throw new Error(`"${rawName}" would be written outside the plugin's folder`)
    if (seen.has(path.toLowerCase())) throw new Error(`${path} is in it twice`)
    seen.add(path.toLowerCase())
    total += usize
    if (total > limits.maxBytes) throw new Error(`It unpacks to more than ${Math.round(limits.maxBytes / 1024 / 1024)} MB`)

    if (zip.readUInt32LE(localAt) !== 0x04034b50) throw new Error('The zip is damaged')
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28)
    const body = zip.subarray(dataAt, dataAt + csize)
    if (body.length !== csize) throw new Error('The zip is cut short')
    let data: Buffer
    if (method === 0) data = Buffer.from(body)
    else if (method === 8) {
      try {
        data = inflateRawSync(body, { maxOutputLength: Math.max(usize, 1) })
      } catch {
        throw new Error(`${path} can't be unpacked`)
      }
    } else throw new Error(`${path} uses a compression this can't read`)
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`${path} is damaged`)
    out.push({ path, data })
  }
  return out
}
