import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

/**
 * The code editors' look (the file editor, previews), from the theme's
 * tokens - so it follows the theme without being rebuilt.
 */
const chrome = EditorView.theme({
  '&': { color: 'var(--t-body)', backgroundColor: 'var(--bg-console)' },
  '.cm-content': { caretColor: 'var(--c-blue)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--c-blue)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--c-blue) 24%, transparent) !important'
  },
  '.cm-panels': { backgroundColor: 'var(--bg-panel)', color: 'var(--t1)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--bd-2)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--bd-2)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--c-amber) 22%, transparent)', outline: '1px solid color-mix(in srgb, var(--c-amber) 45%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--c-amber) 40%, transparent)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--ov) 3%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--c-blue) 14%, transparent)' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'color-mix(in srgb, var(--c-blue) 22%, transparent)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-console)', color: 'var(--t5)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--t2)' },
  '.cm-tooltip': { border: '1px solid var(--bd-4)', backgroundColor: 'var(--bg-menu)', color: 'var(--t1)' },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: 'transparent', borderBottomColor: 'transparent' },
  '.cm-tooltip .cm-tooltip-arrow:after': { borderTopColor: 'var(--bg-menu)', borderBottomColor: 'var(--bg-menu)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'color-mix(in srgb, var(--c-blue) 18%, transparent)', color: 'var(--t1)' }
})

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: 'var(--syn-keyword)' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: 'var(--t-body)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: 'var(--syn-function)' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: 'var(--syn-number)' },
  { tag: [t.definition(t.name), t.separator], color: 'var(--t-body)' },
  { tag: [t.typeName, t.className, t.namespace, t.changed, t.annotation, t.self], color: 'var(--syn-type)' },
  { tag: [t.number, t.bool, t.atom, t.null, t.unit], color: 'var(--syn-number)' },
  { tag: [t.operator, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: 'var(--syn-tag)' },
  { tag: [t.meta, t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.tagName], color: 'var(--syn-tag)' },
  { tag: [t.string, t.inserted, t.processingInstruction], color: 'var(--syn-string)' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: 'var(--t1)' },
  { tag: t.invalid, color: 'var(--c-red)' }
])

export const codeTheme: Extension = [chrome, syntaxHighlighting(highlight)]
