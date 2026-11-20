/**
 * Pictures in Markdown (a task's description, a note): `![alt](path)`. For an
 * agent, a picture on this machine is a file to open - the reference reads as
 * its name and path, and the paths are listed at the end, as pasted images are.
 */
const IMG = /!\[([^\]]*)\]\(<?([^)\s>]+)>?\)/g

/** The local pictures in some Markdown (their paths, as files). */
export function localImages(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(IMG)) {
    const url = m[2]
    if (/^[a-z][\w+.-]*:\/\//i.test(url) && !/^file:/i.test(url)) continue
    let p = url.replace(/^file:\/\//i, '')
    try {
      p = decodeURIComponent(p)
    } catch {
      // not %-encoded
    }
    // (file:///C:/x → C:/x on Windows.)
    if (/^\/[a-z]:\//i.test(p)) p = p.slice(1)
    if (!out.includes(p)) out.push(p)
  }
  return out
}

// A link that isn't a picture: [name](target).
const LINK = /(?<!!)\[([^\]\n]*)\]\(<?([^)\s>]+)>?\)/g

/** A link's target as a path on this machine (absolute), or null: a web address, an anchor, a relative link. */
function asPath(url: string): string | null {
  if (/^[a-z][\w+.-]*:\/\//i.test(url) && !/^file:/i.test(url)) return null
  if (/^(mailto|tel|data):/i.test(url) || url.startsWith('#')) return null
  let p = url.replace(/^file:\/\//i, '')
  try {
    p = decodeURIComponent(p)
  } catch {
    // not %-encoded
  }
  if (/^\/[a-z]:\//i.test(p)) p = p.slice(1)
  return /^([a-z]:[\\/]|\/|~\/)/i.test(p) ? p : null
}

/** The files on this machine some Markdown links to (not its pictures): attached PDFs, logs… */
export function localFiles(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(LINK)) {
    const p = asPath(m[2])
    if (p && !out.includes(p)) out.push(p)
  }
  return out
}

/** Markdown as an agent should get it: pictures and attached files named by their path, and listed to open. */
export function forAgent(md: string): string {
  const paths = localImages(md)
  const files = localFiles(md)
  if (!paths.length && !files.length) return md
  let text = md.replace(IMG, (all, alt: string, url: string) => {
    if (/^[a-z][\w+.-]*:\/\//i.test(url) && !/^file:/i.test(url)) return all
    const p = localImages(all)[0] ?? url
    return `[image${alt ? `: ${alt}` : ''} - ${p}]`
  })
  text = text.replace(LINK, (all, name: string, url: string) => {
    const p = asPath(url)
    return p ? `[file${name ? `: ${name}` : ''} - ${p}]` : all
  })
  if (paths.length) text += `\n\nImages (open and look at them): ${paths.join(', ')}`
  if (files.length) text += `\n\nAttached files (read them): ${files.join(', ')}`
  return text
}
