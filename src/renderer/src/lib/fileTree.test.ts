import { describe, expect, it } from 'vitest'
import { DEFAULT_NESTING, allDirPaths, applyPatch, buildTree, excludeMatcher, nestFiles, parseNesting } from './fileTree'

const items = [
  { path: 'src/b.ts', status: 'modified' as const },
  { path: 'src/a.ts', status: 'unchanged' as const },
  { path: 'src/lib/util.ts', status: 'unchanged' as const },
  { path: 'README.md', status: 'unchanged' as const },
  { path: 'docs', status: 'unchanged' as const, isDir: true }
]

describe('buildTree', () => {
  it('lists folders first, then files, each sorted, with their depth', () => {
    const rows = buildTree(items, new Set())
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.name}`)).toEqual(['docs', 'src', '  lib', '    util.ts', '  a.ts', '  b.ts', 'README.md'])
  })

  it('hides what is inside a collapsed folder, and marks folders with changes', () => {
    const rows = buildTree(items, new Set(['src']))
    expect(rows.map((r) => r.path)).toEqual(['docs', 'src', 'README.md'])
    expect(rows.find((r) => r.path === 'src')?.dirHasChanges).toBe(true)
    expect(rows.find((r) => r.path === 'docs')?.dirHasChanges).toBe(false)
  })

  it('marks every folder up from a change, and copes with a big repo', () => {
    const many = Array.from({ length: 150_000 }, (_, i) => ({ path: `app/m${i % 300}/d${i % 7}/f${i}.rb`, status: (i === 0 || i === 2100 ? 'modified' : 'unchanged') as 'unchanged' | 'modified' }))
    const all = new Set(allDirPaths(many))
    const t = performance.now()
    const rows = buildTree(many, all)
    expect(performance.now() - t).toBeLessThan(1500)
    expect(rows.map((r) => r.path)).toEqual(['app'])
    const open = buildTree(many, new Set([...all].filter((d) => d !== 'app' && d !== 'app/m0')))
    expect(open.find((r) => r.path === 'app')?.dirHasChanges).toBe(true)
    expect(open.find((r) => r.path === 'app/m0')?.dirHasChanges).toBe(true)
    expect(open.find((r) => r.path === 'app/m0/d0')?.dirHasChanges).toBe(true)
    expect(open.find((r) => r.path === 'app/m1')?.dirHasChanges).toBe(false)
  })
})

describe('buildTree options', () => {
  const rails = [
    { path: 'app/models/concerns/taggable.rb', status: 'unchanged' as const },
    { path: 'app/models/user.rb', status: 'modified' as const },
    { path: 'lib/tasks/deep/one.rake', status: 'unchanged' as const },
    { path: 'node_modules', status: 'unchanged' as const, isDir: true, ignored: true, lazy: true },
    { path: 'Gemfile', status: 'unchanged' as const }
  ]
  it('compacts chains of single folders into one row', () => {
    const rows = buildTree(rails, new Set(), { compact: true })
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.name}`)).toEqual([
      'app/models',
      '  concerns',
      '    taggable.rb',
      '  user.rb',
      'lib/tasks/deep',
      '  one.rake',
      'node_modules',
      'Gemfile'
    ])
    // (Opened and closed by the last folder of the chain.)
    expect(buildTree(rails, new Set(['lib/tasks/deep']), { compact: true }).find((r) => r.name === 'lib/tasks/deep')?.open).toBe(false)
  })
  it('keeps a folder git ignores dimmed and closed until it is listed', () => {
    const row = buildTree(rails, new Set(['node_modules'])).find((r) => r.path === 'node_modules')
    expect(row).toMatchObject({ isDir: true, ignored: true, lazy: true, open: false })
  })
  it('filters by name, opening the folders a match is in', () => {
    const rows = buildTree(rails, new Set(allDirPaths(rails)), { filter: 'TAGG' })
    expect(rows.map((r) => r.path)).toEqual(['app', 'app/models', 'app/models/concerns', 'app/models/concerns/taggable.rb'])
    expect(rows.every((r) => !r.isDir || r.open)).toBe(true)
    expect(rows[3].match).toEqual([0, 4])
    expect(buildTree(rails, new Set(), { filter: 'models' }).map((r) => r.path)).toEqual(['app', 'app/models'])
  })
})

describe('excludeMatcher', () => {
  const hide = excludeMatcher(['tmp', '*.log', 'public/assets/**', 'app/**/*.snap', '', '# a comment'])!
  it('hides by name anywhere, or by path from the top - and what is inside', () => {
    expect(hide('tmp')).toBe(true)
    expect(hide('tmp/cache/x')).toBe(true)
    expect(hide('lib/tmp/y')).toBe(true)
    expect(hide('log/development.log')).toBe(true)
    expect(hide('public/assets/app.css')).toBe(true)
    expect(hide('app/views/x/y.snap')).toBe(true)
    expect(hide('app/x.snap')).toBe(true)
    expect(hide('public/index.html')).toBe(false)
    expect(hide('app/models/user.rb')).toBe(false)
    expect(hide('templates/a')).toBe(false)
  })
  it('nothing to hide', () => {
    expect(excludeMatcher([' ', '# x'])).toBeNull()
  })
})

describe('applyPatch', () => {
  const list = [
    { path: 'app', isDir: true, status: 'unchanged' as const },
    { path: 'app/a.rb', isDir: false, status: 'unchanged' as const },
    { path: 'app/b.rb', isDir: false, status: 'unchanged' as const },
    { path: 'lib', isDir: true, status: 'unchanged' as const },
    { path: 'lib/x.rb', isDir: false, status: 'unchanged' as const }
  ]
  it('changes, adds and removes paths', () => {
    const out = applyPatch(list, {
      entries: [
        { path: 'app/a.rb', isDir: false, status: 'modified' },
        { path: 'app/new.rb', isDir: false, status: 'added' },
        { path: 'app/b.rb', isDir: false, status: 'deleted' }
      ],
      gone: ['lib']
    })!
    expect(out.map((e) => `${e.path}:${e.status}`)).toEqual(['app:unchanged', 'app/a.rb:modified', 'app/b.rb:deleted', 'app/new.rb:added'])
  })
  it('lists again for a folder it does not know', () => {
    expect(applyPatch(list, { entries: [{ path: 'spec', isDir: true, status: 'unchanged' }], gone: [] })).toBeNull()
    expect(applyPatch(list, { entries: [{ path: 'app', isDir: true, status: 'unchanged' }], gone: [] })).not.toBeNull()
  })
})

describe('file nesting', () => {
  const rules = parseNesting(DEFAULT_NESTING)
  const f = (path: string, status: 'unchanged' | 'modified' = 'unchanged') => ({ path, status })
  it('folds related files under their main one', () => {
    const { top, kids } = nestFiles([f('Gemfile'), f('Gemfile.lock'), f('package.json'), f('yarn.lock'), f('.env'), f('.env.local'), f('README.md'), f('LICENSE')], rules)
    expect(top.map((x) => x.path)).toEqual(['Gemfile', 'package.json', '.env', 'README.md'])
    expect(kids.get('Gemfile')?.map((x) => x.path)).toEqual(['Gemfile.lock'])
    expect(kids.get('.env')?.map((x) => x.path)).toEqual(['.env.local'])
    expect(kids.get('README.md')?.map((x) => x.path)).toEqual(['LICENSE'])
  })
  it('by the same name (${capture}) - the shorter name claims first', () => {
    const files = ['src/Button.tsx', 'src/Button.test.tsx', 'src/Button.module.css', 'src/api.ts', 'src/api.test.ts', 'src/api.d.ts', 'src/other.ts'].map((p) => f(p))
    const { top, kids } = nestFiles(files, rules)
    expect(top.map((x) => x.path)).toEqual(['src/Button.tsx', 'src/api.ts', 'src/other.ts'])
    expect(kids.get('src/api.ts')?.map((x) => x.path)).toEqual(['src/api.test.ts', 'src/api.d.ts'])
  })
  it('in the tree: closed until opened, and says when one inside changed', () => {
    const items = [f('package.json'), f('package-lock.json', 'modified'), f('index.js')]
    const closed = buildTree(items, new Set(), { nesting: rules })
    expect(closed.map((r) => r.path)).toEqual(['index.js', 'package.json'])
    expect(closed.find((r) => r.path === 'package.json')?.nest).toEqual({ count: 1, open: false, changed: true })
    const open = buildTree(items, new Set(), { nesting: rules, openNests: new Set(['package.json']) })
    expect(open.map((r) => `${'  '.repeat(r.depth)}${r.name}`)).toEqual(['index.js', 'package.json', '  package-lock.json'])
    expect(open[2].nestedIn).toBe('package.json')
    // (Off, and while filtering: every file as it is.)
    expect(buildTree(items, new Set()).map((r) => r.path)).toEqual(['index.js', 'package-lock.json', 'package.json'])
    expect(buildTree(items, new Set(), { nesting: rules, filter: 'lock' }).map((r) => r.path)).toEqual(['package-lock.json'])
  })
  it('your own rules', () => {
    const mine = parseNesting(['# mine', 'schema.rb: structure.sql, seeds.rb', '*.rb: ${capture}_spec.rb', 'bad line'])
    const { kids } = nestFiles([f('db/schema.rb'), f('db/seeds.rb'), f('lib/a.rb'), f('lib/a_spec.rb')], mine)
    expect(kids.get('db/schema.rb')?.map((x) => x.path)).toEqual(['db/seeds.rb'])
    expect(kids.get('lib/a.rb')?.map((x) => x.path)).toEqual(['lib/a_spec.rb'])
  })
})

describe('allDirPaths', () => {
  it('finds every folder, empty ones too', () => {
    expect(allDirPaths(items).sort()).toEqual(['docs', 'src', 'src/lib'])
  })
})

describe('file nesting names', () => {
  it('a dot is a dot (package.json is not packageXjson)', () => {
    const rules = parseNesting(['package.json: yarn.lock'])
    const { top } = nestFiles([{ path: 'packageXjson' }, { path: 'yarn.lock' }], rules)
    expect(top.map((x) => x.path)).toEqual(['packageXjson', 'yarn.lock'])
  })
})
