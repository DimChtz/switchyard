import type { Note, NoteDraft, Project, Task } from '@shared/types'
import type { Action } from '../store/types'
import { errText } from './errors'
import { nextTaskKey } from './derive'
import { revealLabel } from './keys'
import { confirm, type MenuItem } from '../components/ui'

type Dispatch = (action: Action) => void

/** Makes a note and resolves with it (already in the store). */
export async function createNote(dispatch: Dispatch, draft: Omit<NoteDraft, 'id'>): Promise<Note | null> {
  try {
    const note = await window.api.notes.save(draft)
    dispatch({ type: 'NOTE_SAVED', note })
    return note
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not create the note: ${errText(err)}` })
    return null
  }
}

/** A fresh note's text: a heading to type over. */
export function starterBody(title = ''): string {
  return `# ${title}\n\n`
}

/** The body without its title line, for snippets and task descriptions. */
export function noteText(note: Note): string {
  const lines = note.body.split(/\r?\n/)
  const i = lines.findIndex((l) => l.trim())
  if (i !== -1 && /^#{1,6}(\s|$)/.test(lines[i].trim())) lines.splice(i, 1)
  return lines.join('\n').trim()
}

/** One line of the note's text for list rows. */
export function snippet(note: Note): string {
  return noteText(note)
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\[[ xX]\]\s*/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

/** Types the note into the task's agent as a message (restarting it if needed). */
export function sendNoteToAgent(dispatch: Dispatch, note: Note, task: Task): void {
  const text = noteText(note) || note.title
  dispatch({
    type: 'MESSAGE_AGENT',
    taskId: task.id,
    text: `Notes for this task - "${note.title}": ${text.slice(0, 6000)}`,
    toast: `Sent "${note.title}" to ${task.agentKind ?? 'the agent'}.`
  })
}

/** Notes deleted this session: an editor leaving one of them must not save it back. */
export const deletedNotes = new Set<string>()

/** Asks, then moves the note's file to the system trash. */
export async function deleteNote(dispatch: Dispatch, note: Note): Promise<boolean> {
  const ok = await confirm({
    title: `Delete “${note.title}”?`,
    body: 'The file goes to the system trash, so it can still be restored from there.',
    detail: note.file,
    confirmLabel: 'Delete',
    danger: true
  })
  if (!ok) return false
  deletedNotes.add(note.id)
  try {
    await window.api.notes.delete(note.id)
    dispatch({ type: 'NOTE_DELETED', id: note.id })
    return true
  } catch (err) {
    deletedNotes.delete(note.id)
    dispatch({ type: 'TOAST', text: `Could not delete: ${errText(err)}` })
    return false
  }
}

/**
 * A note's menu - the editor's ⋯ and a right-click on it in a list.
 * `body` is the editor's unsaved text; `setPinned` saves through the editor.
 */
export function noteMenuItems(
  note: Note,
  ctx: { tasks: Task[]; projects: Project[]; dispatch: Dispatch; body?: string; open?: () => void; setPinned?: (pinned: boolean) => void }
): MenuItem[] {
  const { dispatch } = ctx
  const current = { ...note, body: ctx.body ?? note.body }
  const project = ctx.projects.find((p) => p.id === note.projectId) ?? null
  const task = ctx.tasks.find((t) => t.id === note.taskId) ?? null
  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  const setPinned =
    ctx.setPinned ??
    ((pinned: boolean) =>
      window.api.notes
        .save({ id: note.id, body: note.body, projectId: note.projectId, taskId: note.taskId, pinned })
        .then((saved) => dispatch({ type: 'NOTE_SAVED', note: saved }))
        .catch(toastErr))
  return [
    ...(ctx.open ? [{ label: 'Open', onClick: ctx.open }] : []),
    ...(task?.agentKind && task.worktreePath ? [{ label: `Send to ${task.agentKind} (${task.key})`, onClick: () => sendNoteToAgent(dispatch, current, task) }] : []),
    {
      label: project ? `Create a task in ${project.name}` : 'Create a task (pick a project first)',
      disabled: !project || !!task,
      onClick: () => project && taskFromNote(dispatch, current, project.id, nextTaskKey(ctx.tasks, project))
    },
    ...(task
      ? [
          {
            label: `Open ${task.key}`,
            onClick: () => (task.worktreePath ? dispatch({ type: 'OPEN_TASK', taskId: task.id }) : dispatch({ type: 'NAV', view: 'board', projectId: task.projectId }))
          }
        ]
      : []),
    { label: note.pinned ? 'Unpin' : 'Pin to the top', separatorBefore: true, onClick: () => setPinned(!note.pinned) },
    { label: 'Copy as Markdown', onClick: () => window.api.sys.copy(current.body) },
    { label: 'Save as Markdown file…', onClick: () => exportNote(dispatch, current.body) },
    { label: 'Open in Editor', separatorBefore: true, onClick: () => window.api.sys.openInEditor(note.file).catch(toastErr) },
    { label: revealLabel, onClick: () => window.api.sys.showItem(note.file).catch(toastErr) },
    { label: 'Delete note…', danger: true, separatorBefore: true, onClick: () => deleteNote(dispatch, note) }
  ]
}

type NoteLinkTo = { projectId: string | null; taskId: string | null }

/**
 * Imports Markdown as notes - picked files, a picked folder (an Obsidian
 * vault, a Notion or Bear export), or dropped paths - and says what it did.
 * Resolves with the first new note's id.
 */
export async function importNotes(dispatch: Dispatch, from: 'files' | 'folder' | string[], link?: NoteLinkTo): Promise<string | null> {
  try {
    const res = Array.isArray(from) ? await window.api.notes.importPaths(from, link) : await window.api.notes.importPick(from, link)
    if (!res) return null
    dispatch({ type: 'NOTES_LOADED', notes: await window.api.notes.list() })
    const n = res.ids.length
    const parts = [
      n ? `Imported ${n} note${n === 1 ? '' : 's'}` : res.found ? 'Nothing new to import' : 'No Markdown or text files found',
      res.images ? `${res.images} image${res.images === 1 ? '' : 's'} copied` : '',
      res.skipped ? `${res.skipped} already here` : '',
      res.failed.length ? `${res.failed.length} couldn't be read (${res.failed.slice(0, 3).join(', ')}${res.failed.length > 3 ? '…' : ''})` : '',
      res.truncated ? 'stopped at 5,000 files' : ''
    ].filter(Boolean)
    dispatch({ type: 'TOAST', text: `${parts.join(' · ')}.`, tone: n ? 'done' : undefined })
    return res.ids[0] ?? null
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not import: ${errText(err)}` })
    return null
  }
}

/** Save as: the note's Markdown to a file the user picks. */
export async function exportNote(dispatch: Dispatch, body: string): Promise<void> {
  try {
    const path = await window.api.notes.exportOne(body)
    if (path) dispatch({ type: 'TOAST', text: `Saved to ${path}`, tone: 'done' })
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not save: ${errText(err)}` })
  }
}

/** Notes into a folder the user picks, one Markdown file each. */
export async function exportNotes(dispatch: Dispatch, ids: string[]): Promise<void> {
  try {
    const res = await window.api.notes.exportMany(ids)
    if (res) dispatch({ type: 'TOAST', text: `Exported ${res.count} note${res.count === 1 ? '' : 's'} to ${res.dir}`, tone: 'done' })
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not export: ${errText(err)}` })
  }
}

/** A backlog task made from the note (title and text), linked back to it. */
export async function taskFromNote(dispatch: Dispatch, note: Note, projectId: string, nextKey: string): Promise<void> {
  const now = Date.now()
  const task: Task = {
    id: nextKey,
    key: nextKey,
    projectId,
    title: note.title,
    desc: noteText(note).slice(0, 4000),
    col: 'backlog',
    agentKind: null,
    st: null,
    worktreeId: null,
    worktreePath: null,
    branch: null,
    ask: null,
    doneNote: null,
    firstMessage: null,
    createdAt: now,
    startedAt: null,
    lastActivityAt: now
  }
  dispatch({ type: 'ADD_TASK', task })
  const saved = await window.api.notes.save({ id: note.id, body: note.body, pinned: note.pinned, projectId, taskId: task.id })
  dispatch({ type: 'NOTE_SAVED', note: saved })
  dispatch({ type: 'TOAST', text: `Created ${task.key} from the note.`, tone: 'done' })
}

export { ago, joinNote, linkOf, linksTo, noteTitle, plainText, splitNote, wikiLink } from './noteText'
