import { describe, expect, it } from 'vitest'
import { commandFor, detectFormatters, parseFormatters, ruleFor, ruleLine } from './formatters'

describe('formatter rules', () => {
  const rules = parseFormatters(['# mine', '*.rb, Gemfile: bundle exec rubocop -a {file}', '', '*.{ts,tsx}: npx prettier --write', 'app/javascript/**/*.js: eslint --fix {file}', 'nonsense'])
  it('reads "patterns: command" lines', () => {
    expect(rules.map(ruleLine)).toEqual(['*.rb, Gemfile: bundle exec rubocop -a {file}', '*.{ts,tsx}: npx prettier --write', 'app/javascript/**/*.js: eslint --fix {file}'])
  })
  it('picks the rule for a file - by name, or by path when the pattern has one', () => {
    expect(ruleFor(rules, 'app/models/user.rb')?.cmd).toMatch(/rubocop/)
    expect(ruleFor(rules, 'Gemfile')?.cmd).toMatch(/rubocop/)
    expect(ruleFor(rules, 'web/src/App.tsx')?.cmd).toMatch(/prettier/)
    expect(ruleFor(rules, 'app/javascript/controllers/x/hello.js')?.cmd).toMatch(/eslint/)
    expect(ruleFor(rules, 'lib/hello.js')).toBeNull()
    expect(ruleFor(rules, 'README.md')).toBeNull()
  })
  it('puts the file in, quoted for the shell', () => {
    expect(commandFor(rules[0], "app/it's.rb", false)).toBe(`bundle exec rubocop -a 'app/it'\\''s.rb'`)
    expect(commandFor(rules[1], 'src/a b.ts', true)).toBe('npx prettier --write "src/a b.ts"')
  })
})

describe('detectFormatters', () => {
  const signs = (files: string[], over: Partial<{ npm: string[]; gemfile: string; pyproject: string }> = {}) => ({ files: new Set(files), npm: new Set(over.npm ?? []), gemfile: over.gemfile ?? '', pyproject: over.pyproject ?? '' })
  it("finds a Rails app's RuboCop and its JavaScript's Prettier", () => {
    const found = detectFormatters(signs(['Gemfile', '.rubocop.yml', 'package.json'], { npm: ['prettier'] }))
    expect(found.map((r) => r.name)).toEqual(['Prettier', 'RuboCop'])
    expect(ruleFor(found, 'app/models/user.rb')?.cmd).toBe('bundle exec rubocop -a --fail-level fatal {file}')
    expect(ruleFor(found, 'app/javascript/application.ts')?.name).toBe('Prettier')
  })
  it('RuboCop from the Gemfile too; Biome before Prettier; the others by their files', () => {
    expect(detectFormatters(signs(['Gemfile'], { gemfile: "gem 'rubocop-rails', require: false" }))[0].name).toBe('RuboCop')
    expect(ruleFor(detectFormatters(signs(['biome.json', '.prettierrc'])), 'a.ts')?.name).toBe('Biome')
    expect(detectFormatters(signs(['go.mod', 'Cargo.toml', 'mix.exs'])).map((r) => r.name)).toEqual(['gofmt', 'rustfmt', 'mix format'])
    expect(detectFormatters(signs(['pyproject.toml'], { pyproject: '[tool.ruff]\nline-length = 100' }))[0].name).toBe('Ruff')
    expect(detectFormatters(signs(['README.md']))).toEqual([])
  })
})
