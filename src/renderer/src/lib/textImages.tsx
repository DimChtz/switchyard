import React, { useEffect, useState } from 'react'

/**
 * Images in a message to an agent (a review comment, a reply): pasted or
 * dropped into its text box, kept where every agent can read them, and
 * written into the text as "[image: …/x.png]" - a path the agent opens. The
 * message lists them at its end too, as pasted images always are.
 */

export const IMAGE_REF = /\[image: ([^\]\n]+)\]/g

/** The image paths a text names. */
export function imageRefs(text: string): string[] {
  return [...new Set([...text.matchAll(IMAGE_REF)].map((m) => m[1].trim()))]
}

/** A message with the images it names listed at its end, for the agent to open. */
export function withImagesNote(text: string, from: string[] = [text]): string {
  const paths = [...new Set(from.flatMap(imageRefs))]
  return paths.length ? `${text} Images (open and look at them): ${paths.join(', ')}` : text
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i

/** Keeps the images among some files (a paste's, a drop's); their paths. */
async function keep(files: File[]): Promise<string[]> {
  const out: string[] = []
  for (const f of files) {
    if (!f.type.startsWith('image/') && !IMAGE_FILE.test(f.name)) continue
    const dataUrl = await new Promise<string>((ok, no) => {
      const r = new FileReader()
      r.onload = () => ok(String(r.result))
      r.onerror = () => no(r.error)
      r.readAsDataURL(f)
    })
    out.push((await window.api.attachments.save(dataUrl)).replace(/\\/g, '/'))
  }
  return out
}

/**
 * Paste and drop for a text box: images go in as "[image: path]" where the
 * cursor is (text pastes as it always does). `onError` for what can't be kept.
 */
export function imageInput(
  value: string,
  set: (v: string) => void,
  onError: (msg: string) => void
): Pick<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onPaste' | 'onDrop' | 'onDragOver'> {
  const add = async (files: File[], el: HTMLTextAreaElement): Promise<void> => {
    const at = el.selectionStart ?? value.length
    const to = el.selectionEnd ?? at
    try {
      const paths = await keep(files)
      if (!paths.length) return
      const before = value.slice(0, at)
      const ins = `${before && !/\s$/.test(before) ? ' ' : ''}${paths.map((p) => `[image: ${p}]`).join(' ')} `
      set(before + ins + value.slice(to))
      setTimeout(() => {
        el.focus()
        el.setSelectionRange(at + ins.length, at + ins.length)
      }, 0)
    } catch (err) {
      onError(`Could not add the image: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const images = (list: FileList): File[] => [...list].filter((f) => f.type.startsWith('image/') || IMAGE_FILE.test(f.name))
  return {
    onPaste: (e) => {
      const files = images(e.clipboardData.files)
      if (!files.length) return
      e.preventDefault()
      void add(files, e.currentTarget)
    },
    onDragOver: (e) => {
      if (e.dataTransfer.types.includes('Files')) e.preventDefault()
    },
    onDrop: (e) => {
      const files = images(e.dataTransfer.files)
      if (!files.length) return
      e.preventDefault()
      void add(files, e.currentTarget)
    }
  }
}

/** A text with the images it names: the text (the references shortened), then their thumbnails - a click opens one. */
export function TextWithImages({ text, style }: { text: string; style?: React.CSSProperties }): React.JSX.Element {
  const paths = imageRefs(text)
  const shown = paths.length ? text.replace(IMAGE_REF, (_m, p: string) => `[image: ${p.trim().split('/').pop()}]`) : text
  return (
    <>
      <span style={style}>{shown}</span>
      {paths.length ? (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {paths.map((p) => (
            <Thumb key={p} path={p} />
          ))}
        </span>
      ) : null}
    </>
  )
}

function Thumb({ path }: { path: string }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    window.api.notes
      .image(path)
      .then((s) => live && setSrc(s))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [path])
  return (
    <span
      onClick={() => window.api.sys.reveal(path).catch(() => {})}
      title={`${path}\nClick to open it`}
      style={{ width: 96, height: 64, borderRadius: 4, border: '1px solid var(--bd-3)', background: 'var(--bg-input)', overflow: 'hidden', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '11px var(--font-mono)', color: 'var(--t4)' }}
    >
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : 'image'}
    </span>
  )
}
