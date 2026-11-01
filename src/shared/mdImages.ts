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

/** Markdown as an agent should get it: pictures named by their file, and listed to open. */
export function forAgent(md: string): string {
  const paths = localImages(md)
  if (!paths.length) return md
  const text = md.replace(IMG, (all, alt: string, url: string) => {
    if (/^[a-z][\w+.-]*:\/\//i.test(url) && !/^file:/i.test(url)) return all
    const p = localImages(all)[0] ?? url
    return `[image${alt ? `: ${alt}` : ''} - ${p}]`
  })
  return `${text}\n\nImages (open and look at them): ${paths.join(', ')}`
}
