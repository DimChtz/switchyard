/**
 * Images for an agent: pasted (kept as files in the data folder), dropped
 * from the file manager, or picked - each becomes a path the agent is told
 * to open (Claude Code, Codex and Gemini read images from a path).
 */

const IMAGE = /\.(png|jpe?g|gif|webp)$/i

function asDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** Images on the clipboard of a paste event, saved; [] when there are none (the paste goes on as text). */
export async function pastedImages(e: React.ClipboardEvent): Promise<string[]> {
  const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
  if (!files.length) return []
  e.preventDefault()
  const out: string[] = []
  for (const f of files) {
    // A copied file has a path already; a screenshot doesn't - it's kept as one.
    const path = window.api.fs.pathForFile(f)
    out.push(path && IMAGE.test(path) ? path : await window.api.attachments.save(await asDataUrl(f)))
  }
  return out
}

/** Image files dropped from the file manager (their paths); [] when there are none. */
export function droppedImages(e: React.DragEvent): string[] {
  const paths = [...e.dataTransfer.files].map((f) => window.api.fs.pathForFile(f)).filter((p) => p && IMAGE.test(p))
  if (paths.length) e.preventDefault()
  return paths
}

/** The line that goes with a message: where the images are, for the agent to open. */
export function imagesNote(paths: string[]): string {
  return paths.length ? `\n\nImages (open and look at them): ${paths.join(', ')}` : ''
}

export const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p
