import { describe, expect, it } from 'vitest'
import { pickMessage, sourceHint, sourcePath, type PickedElement } from './elementPicker'

const el = (o: Partial<PickedElement>): PickedElement => ({
  tag: 'button',
  label: 'button.primary',
  text: 'Save changes',
  attrs: {},
  selector: 'main > form > button.primary',
  rect: { x: 10, y: 20, width: 120.4, height: 32 },
  viewport: { width: 800, height: 600 },
  url: 'http://localhost:5173/settings',
  html: '<button class="primary" type="submit">',
  styles: { color: 'rgb(255, 255, 255)', 'font-size': '14px' },
  source: null,
  components: [],
  framework: null,
  ...o
})

describe('element picker', () => {
  it('makes the source path relative to the task folder', () => {
    expect(sourcePath('E:\\dev\\wt\\SYT-1\\src\\App.tsx', 'E:\\dev\\wt\\SYT-1')).toBe('src/App.tsx')
    expect(sourcePath('/Users/me/wt/app/src/App.tsx', '/Users/me/wt/app/')).toBe('src/App.tsx')
    expect(sourcePath('http://localhost:5173/src/components/Save.tsx?t=1712', '/x')).toBe('src/components/Save.tsx')
    expect(sourcePath('http://localhost:5173/@fs/E:/dev/wt/app/src/a.ts', 'E:/dev/wt/app')).toBe('src/a.ts')
    expect(sourcePath('src/App.vue', null)).toBe('src/App.vue')
  })

  it('names where it is written, with the line when known', () => {
    expect(sourceHint(el({ source: { file: '/w/src/Save.tsx', line: 42, col: 7 } }), '/w')).toBe('src/Save.tsx:42')
    expect(sourceHint(el({ source: { file: 'src/App.vue', line: null, col: null } }), null)).toBe('src/App.vue')
    expect(sourceHint(el({}), '/w')).toBeNull()
  })

  it('tells the agent the change, the element, its source and the screenshot', () => {
    const msg = pickMessage(el({ source: { file: '/w/src/Save.tsx', line: 42, col: 7 }, framework: 'react', components: ['SaveBar', 'Settings'] }), 'Make it\nmatch the header', {
      root: '/w',
      screenshot: '.switchyard/shots/pick-1.png'
    })
    expect(msg).toContain('Make it match the header - It')
    expect(msg).toContain('<button> "Save changes", at main > form > button.primary')
    expect(msg).toContain('React says it\'s rendered from src/Save.tsx:42 (inside SaveBar < Settings)')
    expect(msg).toContain('font-size: 14px; 120×32px')
    expect(msg).toContain('.switchyard/shots/pick-1.png')
    expect(pickMessage(el({}), 'Bigger', { root: '/w', screenshot: null, candidates: ['src/a.tsx:3'] })).toContain('Its text appears in src/a.tsx:3.')
  })
})
