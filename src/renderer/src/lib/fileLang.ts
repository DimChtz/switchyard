import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { Language, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { go } from '@codemirror/legacy-modes/mode/go'
import { rust } from '@codemirror/legacy-modes/mode/rust'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { c, cpp, java, csharp, kotlin } from '@codemirror/legacy-modes/mode/clike'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { xml } from '@codemirror/legacy-modes/mode/xml'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { perl } from '@codemirror/legacy-modes/mode/perl'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { r } from '@codemirror/legacy-modes/mode/r'
import { clojure } from '@codemirror/legacy-modes/mode/clojure'
import type { Extension } from '@codemirror/state'

export function extOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
}

const ICONS: Record<string, [string, string]> = {
  ts: ['TS', '#5B9BD5'],
  tsx: ['TSX', '#56B6C2'],
  js: ['JS', '#D7BA4A'],
  jsx: ['JSX', '#D7BA4A'],
  mjs: ['JS', '#D7BA4A'],
  cjs: ['JS', '#D7BA4A'],
  json: ['{ }', '#C9A24A'],
  md: ['M↓', '#8A8D95'],
  go: ['GO', '#56B6C2'],
  mod: ['GO', '#56B6C2'],
  sql: ['SQL', '#D08A4E'],
  tf: ['TF', '#9B82D9'],
  css: ['#', '#C678DD'],
  scss: ['#', '#C678DD'],
  less: ['#', '#C678DD'],
  yml: ['YML', '#C9A24A'],
  yaml: ['YML', '#C9A24A'],
  html: ['<>', '#E4633B'],
  py: ['PY', '#3572A5'],
  rs: ['RS', '#DE9B4A'],
  sh: ['SH', '#89E051'],
  bash: ['SH', '#89E051'],
  toml: ['TML', '#9B82D9'],
  rb: ['RB', '#CC342D'],
  txt: ['TXT', '#6E717A'],
  java: ['JAVA', '#E76F51'],
  c: ['C', '#5B9BD5'],
  h: ['C', '#5B9BD5'],
  cpp: ['C++', '#5B9BD5'],
  cc: ['C++', '#5B9BD5'],
  hpp: ['C++', '#5B9BD5'],
  cs: ['C#', '#9B82D9'],
  swift: ['SWFT', '#E76F51'],
  xml: ['XML', '#8A8D95'],
  svg: ['SVG', '#8A8D95'],
  dockerfile: ['DOCK', '#5B9BD5'],
  ps1: ['PS1', '#5B9BD5'],
  pl: ['PERL', '#8A8D95'],
  lua: ['LUA', '#56B6C2'],
  r: ['R', '#5B9BD5'],
  clj: ['CLJ', '#9ED9B0'],
  kt: ['KT', '#9B82D9']
}

export function fileIcon(name: string): [string, string] {
  return ICONS[extOf(name)] ?? ['·', '#6E717A']
}

// A code block's info string ("```typescript") as the file extension languageFor knows.
const FENCE_ALIASES: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  node: 'js',
  python: 'py',
  py3: 'py',
  shell: 'sh',
  zsh: 'sh',
  console: 'sh',
  yaml: 'yml',
  rust: 'rs',
  golang: 'go',
  csharp: 'cs',
  'c#': 'cs',
  'c++': 'cpp',
  powershell: 'ps1',
  pwsh: 'ps1',
  kotlin: 'kt',
  ruby: 'rb',
  docker: 'dockerfile',
  markdown: 'md',
  perl: 'pl',
  clojure: 'clj'
}

/** The language of a Markdown code block, from its info string ("ts", "python"); null when unknown. */
export function codeLanguage(info: string): Language | null {
  const word = info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (!word) return null
  const ext = FENCE_ALIASES[word] ?? word
  for (const e of languageFor(ext === 'dockerfile' ? 'Dockerfile.dockerfile' : `x.${ext}`)) {
    if (e instanceof LanguageSupport) return e.language
    if (e instanceof Language) return e
  }
  return null
}

export function languageFor(name: string): Extension[] {
  const ext = extOf(name)
  switch (ext) {
    case 'ts':
      return [javascript({ typescript: true })]
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })]
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()]
    case 'jsx':
      return [javascript({ jsx: true })]
    case 'json':
      return [json()]
    case 'css':
    case 'scss':
    case 'less':
      return [css()]
    case 'html':
      return [html()]
    case 'md':
      return [markdown()]
    case 'py':
      return [python()]
    case 'sql':
      return [sql()]
    case 'go':
    case 'mod':
      return [StreamLanguage.define(go)]
    case 'rs':
      return [StreamLanguage.define(rust)]
    case 'yml':
    case 'yaml':
      return [StreamLanguage.define(yaml)]
    case 'sh':
    case 'bash':
      return [StreamLanguage.define(shell)]
    case 'toml':
      return [StreamLanguage.define(toml)]
    case 'rb':
      return [StreamLanguage.define(ruby)]
    case 'java':
      return [StreamLanguage.define(java)]
    case 'c':
    case 'h':
      return [StreamLanguage.define(c)]
    case 'cpp':
    case 'cc':
    case 'hpp':
      return [StreamLanguage.define(cpp)]
    case 'cs':
      return [StreamLanguage.define(csharp)]
    case 'kt':
      return [StreamLanguage.define(kotlin)]
    case 'swift':
      return [StreamLanguage.define(swift)]
    case 'xml':
    case 'svg':
      return [StreamLanguage.define(xml)]
    case 'dockerfile':
      return [StreamLanguage.define(dockerFile)]
    case 'ps1':
      return [StreamLanguage.define(powerShell)]
    case 'pl':
      return [StreamLanguage.define(perl)]
    case 'lua':
      return [StreamLanguage.define(lua)]
    case 'r':
      return [StreamLanguage.define(r)]
    case 'clj':
      return [StreamLanguage.define(clojure)]
    default:
      return []
  }
}
