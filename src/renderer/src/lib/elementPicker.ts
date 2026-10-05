/**
 * Point and fix: pick an element in the Preview's page, and tell the agent
 * about it - what it is, where it's likely written, how it looks, and a
 * screenshot of it.
 */

/** What the page says about the element picked. */
export interface PickedElement {
  tag: string
  /** "button#save.btn.primary" */
  label: string
  text: string
  attrs: Record<string, string>
  /** A short CSS path to it: "main > form > button.primary". */
  selector: string
  /** Where it is in the page's viewport (CSS pixels). */
  rect: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number }
  url: string
  /** Its opening tag. */
  html: string
  styles: Record<string, string>
  /** Where the framework says it's written: React (dev builds), Vue, Svelte. */
  source: { file: string; line: number | null; col: number | null } | null
  /** The components it's inside, nearest first. */
  components: string[]
  framework: 'react' | 'vue' | 'svelte' | null
}

/**
 * Runs in the page (webview.executeJavaScript): hovering outlines the
 * element under the pointer, a click picks it (the page doesn't get the
 * click), Esc gives up. Resolves with a PickedElement, or null.
 */
export const PICK_SCRIPT = `(() => new Promise((resolve) => {
  if (window.__switchyardPick) window.__switchyardPick.cancel()
  const Z = '2147483647'
  const box = document.createElement('div')
  const tag = document.createElement('div')
  Object.assign(box.style, { position: 'fixed', zIndex: Z, pointerEvents: 'none', border: '2px solid #4f8cff', background: 'rgba(79,140,255,.12)', borderRadius: '3px', display: 'none', boxSizing: 'border-box' })
  Object.assign(tag.style, { position: 'fixed', zIndex: Z, pointerEvents: 'none', font: '11px/18px ui-monospace, Menlo, Consolas, monospace', color: '#fff', background: '#4f8cff', padding: '0 6px', borderRadius: '3px', display: 'none', whiteSpace: 'nowrap' })
  document.documentElement.append(box, tag)
  const root = document.documentElement
  const cursor = root.style.cursor
  root.style.cursor = 'crosshair'
  let cur = null
  const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 2).map((c) => '.' + c).join('')
  const move = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el || el === cur || el === box || el === tag) return
    cur = el
    const r = el.getBoundingClientRect()
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
    tag.textContent = label(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height)
    Object.assign(tag.style, { display: 'block', left: Math.max(0, r.left) + 'px', top: (r.top > 22 ? r.top - 20 : r.bottom + 2) + 'px' })
  }
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation() }
  const describe = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const attrs = {}
    for (const a of ['id', 'data-testid', 'data-test', 'aria-label', 'role', 'name', 'type', 'href', 'placeholder', 'alt', 'title']) {
      const v = el.getAttribute(a)
      if (v) attrs[a] = v.slice(0, 120)
    }
    const path = []
    for (let n = el; n && n.nodeType === 1 && n !== document.body && path.length < 5; n = n.parentElement) {
      let s = n.tagName.toLowerCase()
      if (n.id) { path.unshift(s + '#' + n.id); break }
      const cls = [...n.classList].filter((c) => !/^(css|sc|jsx|svelte|emotion)-/.test(c)).slice(0, 2)
      if (cls.length) s += '.' + cls.join('.')
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(n) + 1) + ')'
      path.unshift(s)
    }
    const styles = {}
    for (const p of ['color', 'background-color', 'font-size', 'font-weight', 'font-family', 'line-height', 'padding', 'margin', 'border', 'border-radius', 'display', 'gap']) {
      const v = cs.getPropertyValue(p)
      if (v && v !== 'normal' && v !== 'none' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)' && !(p === 'border' && /^0px/.test(v))) styles[p] = v.slice(0, 80)
    }
    let source = null
    let framework = null
    const components = []
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
    if (fiberKey) {
      framework = 'react'
      for (let f = el[fiberKey]; f; f = f.return) {
        const t = f.type
        const name = t && typeof t !== 'string' ? t.displayName || t.name : null
        if (name && components.length < 4 && !components.includes(name)) components.push(name)
        if (!source && f._debugSource) source = { file: f._debugSource.fileName, line: f._debugSource.lineNumber ?? null, col: f._debugSource.columnNumber ?? null }
        if (!source && f._debugStack && typeof f._debugStack.stack === 'string') {
          // React 19: where the element was made - the first frame outside React (its line is of the served code).
          for (const l of f._debugStack.stack.split('\\n').slice(1)) {
            const m = l.match(/\\(?((?:https?|file):\\/\\/[^\\s)]+?):(\\d+):(\\d+)\\)?\\s*$/)
            if (m && !/node_modules|react-dom|react\\.development|react-jsx/.test(m[1])) { source = { file: m[1], line: null, col: null }; break }
          }
        }
      }
    }
    if (!framework) {
      let v = el
      while (v && !v.__vueParentComponent) v = v.parentElement
      const comp = v && v.__vueParentComponent
      if (comp) {
        framework = 'vue'
        for (let c = comp; c && components.length < 4; c = c.parent) {
          const n = c.type && (c.type.name || c.type.__name)
          if (n && !components.includes(n)) components.push(n)
          if (!source && c.type && c.type.__file) source = { file: c.type.__file, line: null, col: null }
        }
      }
    }
    if (!framework) {
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const loc = n.__svelte_meta && n.__svelte_meta.loc
        if (loc) { framework = 'svelte'; source = { file: loc.file, line: loc.line != null ? loc.line + 1 : null, col: loc.column ?? null }; break }
      }
    }
    const shallow = el.cloneNode(false).outerHTML
    return {
      tag: el.tagName.toLowerCase(),
      label: label(el),
      text: String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 160),
      attrs,
      selector: path.join(' > '),
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      viewport: { width: innerWidth, height: innerHeight },
      url: location.href,
      html: shallow.length > 300 ? shallow.slice(0, 299) + '…' : shallow,
      styles,
      source,
      components,
      framework
    }
  }
  const done = (v) => {
    for (const [ev, fn] of handlers) removeEventListener(ev, fn, true)
    box.remove()
    tag.remove()
    root.style.cursor = cursor
    delete window.__switchyardPick
    resolve(v)
  }
  const click = (e) => {
    stop(e)
    const el = document.elementFromPoint(e.clientX, e.clientY) || cur
    box.style.display = tag.style.display = 'none'
    try { done(el ? describe(el) : null) } catch (err) { done(null) }
  }
  const key = (e) => { if (e.key === 'Escape') { stop(e); done(null) } }
  const handlers = [['mousemove', move], ['pointerdown', stop], ['pointerup', stop], ['mousedown', stop], ['mouseup', stop], ['click', click], ['keydown', key]]
  for (const [ev, fn] of handlers) addEventListener(ev, fn, true)
  window.__switchyardPick = { cancel: () => done(null) }
}))()`

export const CANCEL_PICK_SCRIPT = 'window.__switchyardPick && window.__switchyardPick.cancel()'

/**
 * Where the element's source is, relative to the task's folder when it's
 * inside it: an absolute path (React), a dev server URL ("/src/App.tsx?t=1"),
 * or a path as the framework gives it.
 */
export function sourcePath(file: string, root: string | null): string {
  let f = file.replace(/^(?:https?:\/\/[^/]+|file:\/\/)/, '').replace(/[?#].*$/, '')
  try {
    f = decodeURIComponent(f)
  } catch {
    // keep it as it is
  }
  // Vite's /@fs/ prefix for files outside the served root.
  f = f.replace(/^\/@fs\//, '/')
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\/([a-zA-Z]:\/)/, '$1')
  f = norm(f)
  if (root) {
    const r = norm(root).replace(/\/+$/, '') + '/'
    if (f.toLowerCase().startsWith(r.toLowerCase())) return f.slice(r.length)
  }
  return f.replace(/^\//, '')
}

/** "src/App.tsx:42" - or null when the page didn't say. */
export function sourceHint(p: PickedElement, root: string | null): string | null {
  if (!p.source?.file) return null
  const file = sourcePath(p.source.file, root)
  return p.source.line ? `${file}:${p.source.line}` : file
}

/** The message for the agent: the change asked for, the element, where it's likely written, and the screenshot. */
export function pickMessage(p: PickedElement, ask: string, opts: { root: string | null; screenshot: string | null; candidates?: string[] }): string {
  const parts: string[] = []
  parts.push(`${ask.trim().replace(/\s*\n\s*/g, ' ')}`)
  const what = [`<${p.tag}>`, p.text ? `"${p.text.slice(0, 100)}"` : '', p.attrs['data-testid'] ? `data-testid="${p.attrs['data-testid']}"` : '', p.attrs['aria-label'] && p.attrs['aria-label'] !== p.text ? `aria-label="${p.attrs['aria-label']}"` : '']
    .filter(Boolean)
    .join(' ')
  parts.push(`- It's about this element in the running app (${p.url}): ${what}, at ${p.selector || p.label}; its tag is ${p.html}`)
  const src = sourceHint(p, opts.root)
  if (src) parts.push(`- ${p.framework === 'react' ? 'React' : p.framework === 'vue' ? 'Vue' : 'Svelte'} says it's rendered from ${src}${p.components.length ? ` (inside ${p.components.join(' < ')})` : ''}.`)
  else if (p.components.length) parts.push(`- It's inside the components ${p.components.join(' < ')}.`)
  if (opts.candidates?.length) parts.push(`- Its text appears in ${opts.candidates.join(', ')}.`)
  const styles = Object.entries(p.styles)
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ')
  if (styles) parts.push(`- It looks like: ${styles}; ${Math.round(p.rect.width)}×${Math.round(p.rect.height)}px.`)
  if (opts.screenshot) parts.push(`- A screenshot of it (outlined in blue) is at ${opts.screenshot}.`)
  return `${parts[0]} ${parts.slice(1).join(' ')}`
}
