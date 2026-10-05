import { EditorView, highlightWhitespace } from '@codemirror/view'
import { indentUnit } from '@codemirror/language'
import { EditorState, Prec, type Extension } from '@codemirror/state'
import type { BasicSetupOptions } from '@uiw/react-codemirror'
import { EDITOR_FONTS } from '@shared/constants'
import type { Prefs } from '@shared/types'
import { folding } from './folding'

export function editorFontStack(font: string): string {
  return `${font && font !== 'Geist Mono' ? `'${font}', ` : ''}'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace`
}

/** CodeMirror extensions for the File editor settings (look, wrapping, indentation). */
export function editorExtensions(p: Prefs): Extension[] {
  const theme = EditorView.theme({
    '&': { fontSize: `${p.editorFontSize}px`, backgroundColor: 'transparent', height: '100%' },
    '.cm-scroller': { fontFamily: editorFontStack(p.editorFont), lineHeight: String(p.editorLineHeight) },
    '.cm-content': {
      caretColor: 'var(--c-blue)',
      fontVariantLigatures: p.editorLigatures ? 'contextual' : 'none',
      fontFeatureSettings: p.editorLigatures ? 'normal' : '"liga" 0, "calt" 0'
    },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--t5)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--ov) 3%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--t2)' },
    '.cm-highlightSpace': { backgroundImage: 'radial-gradient(circle at 50% 55%, color-mix(in srgb, var(--ov) 18%, transparent) 11%, transparent 5%)' },
    '.cm-highlightTab': { opacity: 0.35 },
    '&.cm-focused': { outline: 'none' }
  })
  return [
    // Above the code theme's own colours (which otherwise win and paint a
    // lighter block behind the text).
    Prec.highest(theme),
    indentUnit.of(p.editorUseTabs ? '\t' : ' '.repeat(p.editorTabSize)),
    // How wide a tab character shows (basicSetup's tabSize only sets the indent unit).
    EditorState.tabSize.of(p.editorTabSize),
    folding,
    ...(p.editorWordWrap ? [EditorView.lineWrapping] : []),
    ...(p.editorWhitespace ? [highlightWhitespace()] : [])
  ]
}

export function editorBasicSetup(p: Prefs): BasicSetupOptions {
  return {
    // Ours instead (lib/folding, in editorExtensions).
    foldGutter: false,
    lineNumbers: p.editorLineNumbers,
    highlightActiveLine: p.editorActiveLine,
    highlightActiveLineGutter: p.editorActiveLine,
    bracketMatching: p.editorBracketMatching,
    tabSize: p.editorTabSize
  }
}

/** Applies the "on save" settings to a file's text. */
export function prepareForSave(text: string, p: Prefs): string {
  let out = text
  if (p.editorTrimOnSave) out = out.replace(/[ \t]+$/gm, '')
  if (p.editorFinalNewline && out.length > 0 && !out.endsWith('\n')) out += text.includes('\r\n') ? '\r\n' : '\n'
  return out
}

let fontCache: string[] | null = null

/**
 * The editor fonts installed on this machine. A font is there when text set
 * in it measures differently from the fallback it would otherwise get.
 */
export function installedEditorFonts(): string[] {
  if (fontCache) return fontCache
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return ['Geist Mono']
  const sample = 'mmmmmmmmmwwwwwlli10O@#{}=>'
  const width = (font: string): number => {
    ctx.font = font
    return ctx.measureText(sample).width
  }
  const baseMono = width('72px monospace')
  const baseSerif = width('72px serif')
  fontCache = EDITOR_FONTS.filter((f) => f === 'Geist Mono' || width(`72px '${f}', monospace`) !== baseMono || width(`72px '${f}', serif`) !== baseSerif)
  return fontCache
}
