import { useSyncExternalStore } from 'react'

/**
 * The image viewer and the annotator (components/ImageViewer): opened from
 * wherever a picture shows - a note, a task's description, a comment's
 * thumbnail, the toast after a paste. An image is named as its Markdown or
 * message names it (a path, or one in the notes folder).
 */

export type ImageView = { ref: string; mode: 'view' | 'annotate'; taskId?: string } | null

let current: ImageView = null
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

/** Shows the image full size (`taskId`: a task's file - an annotated copy can go to its agent). */
export function viewImage(ref: string, taskId?: string): void {
  current = { ref, mode: 'view', taskId }
  emit()
}

/** Opens the image straight in the annotator (an arrow, a box, a blur over a secret…). */
export function annotateImage(ref: string, taskId?: string): void {
  current = { ref, mode: 'annotate', taskId }
  emit()
}

export function closeImage(): void {
  current = null
  emit()
}

export function useImageView(): ImageView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}

/** An image saved over (annotated): whatever shows it reads it again. */
export function imageChanged(ref: string): void {
  window.dispatchEvent(new CustomEvent('switchyard:image-changed', { detail: ref }))
}
export function onImageChanged(cb: (ref: string) => void): () => void {
  const h = (e: Event): void => cb(String((e as CustomEvent).detail ?? ''))
  window.addEventListener('switchyard:image-changed', h)
  return () => window.removeEventListener('switchyard:image-changed', h)
}
