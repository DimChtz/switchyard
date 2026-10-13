import type { Tree, SyntaxNode } from '@lezer/common'

/**
 * A file's symbols, from its syntax tree: functions, classes, methods,
 * types, top-level variables, headings (Markdown), rules (CSS). For Go to
 * symbol (Ctrl+Shift+O).
 */

export type SymbolKind = 'function' | 'class' | 'method' | 'property' | 'interface' | 'type' | 'enum' | 'variable' | 'heading' | 'rule'

export interface CodeSymbol {
  name: string
  kind: SymbolKind
  /** Where its name is (selected when you jump to it). */
  from: number
  to: number
  /** Inside how many other symbols (a method in a class: 1). */
  depth: number
}

/** A node's kind of symbol, and which child names it. */
const RULES: Record<string, { kind: SymbolKind; name: string[] }> = {
  // JavaScript / TypeScript
  FunctionDeclaration: { kind: 'function', name: ['VariableDefinition'] },
  ClassDeclaration: { kind: 'class', name: ['VariableDefinition', 'TypeDefinition'] },
  MethodDeclaration: { kind: 'method', name: ['PropertyDefinition', 'PrivatePropertyDefinition'] },
  PropertyDeclaration: { kind: 'property', name: ['PropertyDefinition', 'PrivatePropertyDefinition'] },
  InterfaceDeclaration: { kind: 'interface', name: ['TypeDefinition'] },
  TypeAliasDeclaration: { kind: 'type', name: ['TypeDefinition'] },
  EnumDeclaration: { kind: 'enum', name: ['TypeDefinition'] },
  // Python
  FunctionDefinition: { kind: 'function', name: ['VariableName'] },
  ClassDefinition: { kind: 'class', name: ['VariableName'] }
}

const TOP = new Set(['Script', 'ExportDeclaration', 'Document', 'StyleSheet'])

function textOf(doc: string, n: SyntaxNode): string {
  return doc.slice(n.from, n.to)
}

export function symbolsOf(tree: Tree, doc: string): CodeSymbol[] {
  const out: CodeSymbol[] = []
  // How deep the symbol a node is in goes (by the enclosing symbols' ends).
  const open: number[] = []
  const depthAt = (from: number): number => {
    while (open.length && open[open.length - 1] <= from) open.pop()
    return open.length
  }
  tree.iterate({
    enter(ref) {
      const n = ref.node
      const rule = RULES[n.name]
      if (rule) {
        const id = rule.name.map((c) => n.getChild(c)).find((c): c is SyntaxNode => !!c)
        const depth = depthAt(n.from)
        // A function in a class's body is a method; one inside a function isn't listed (a local).
        const parentKind = out.length && depth > 0 ? out[out.length - 1] : null
        if (id && !(rule.kind === 'function' && parentKind && parentKind.kind !== 'class' && depth > 0)) {
          const kind: SymbolKind = rule.kind === 'function' && parentKind?.kind === 'class' ? 'method' : rule.kind
          out.push({ name: textOf(doc, id), kind, from: id.from, to: id.to, depth })
          open.push(n.to)
        }
        return
      }
      // Top-level variables (each one in "let a = 1, b = 2").
      if (n.name === 'VariableDeclaration' && n.parent && TOP.has(n.parent.name)) {
        const depth = depthAt(n.from)
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.name !== 'VariableDefinition') continue
          const fn = c.nextSibling?.name === 'Equals' && /^(ArrowFunction|FunctionExpression)$/.test(c.nextSibling.nextSibling?.name ?? '')
          out.push({ name: textOf(doc, c), kind: fn ? 'function' : 'variable', from: c.from, to: c.to, depth })
        }
        return false
      }
      // Markdown headings: "# Title" → Title, nested by level.
      const heading = /^(?:ATXHeading|SetextHeading)(\d)$/.exec(n.name)
      if (heading) {
        const text = textOf(doc, n)
          .replace(/^#{1,6}\s*/, '')
          .replace(/\s*#*\s*$/, '')
          .split('\n')[0]
          .trim()
        if (text) out.push({ name: text, kind: 'heading', from: n.from, to: n.to, depth: Number(heading[1]) - 1 })
        return false
      }
      // CSS rules, by their selectors.
      if (n.name === 'RuleSet') {
        const block = n.getChild('Block')
        const sel = doc.slice(n.from, block ? block.from : n.to).trim().replace(/\s+/g, ' ')
        if (sel) out.push({ name: sel, kind: 'rule', from: n.from, to: n.from + sel.length, depth: depthAt(n.from) })
        open.push(n.to)
        return
      }
      return
    }
  })
  return out
}

/** Symbols matching what was typed: in order when it's empty; else names containing it, ones starting with it first. */
export function filterSymbols(list: CodeSymbol[], query: string): CodeSymbol[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  const hits = list.filter((s) => s.name.toLowerCase().includes(q))
  return [...hits.filter((s) => s.name.toLowerCase().startsWith(q)), ...hits.filter((s) => !s.name.toLowerCase().startsWith(q))]
}
