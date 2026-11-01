import { describe, expect, it } from 'vitest'
import { commitUrl, fileUrl, repoWeb } from './remoteUrl'

describe('repoWeb', () => {
  it('reads every way origin is written', () => {
    expect(repoWeb('git@github.com:acme/shop.git')?.base).toBe('https://github.com/acme/shop')
    expect(repoWeb('https://github.com/acme/shop.git')?.base).toBe('https://github.com/acme/shop')
    expect(repoWeb('https://me@github.com/acme/shop')?.base).toBe('https://github.com/acme/shop')
    expect(repoWeb('ssh://git@gitlab.example.com:2222/team/sub/app.git')).toEqual({ base: 'https://gitlab.example.com/team/sub/app', host: 'gitlab.example.com', kind: 'gitlab' })
    expect(repoWeb('git@bitbucket.org:team/app.git')?.kind).toBe('bitbucket')
  })
  it('a folder on disk has no web page', () => {
    expect(repoWeb('C:\\repos\\origin.git')).toBeNull()
    expect(repoWeb('/srv/git/app.git')).toBeNull()
    expect(repoWeb('../origin.git')).toBeNull()
  })
})

describe('fileUrl and commitUrl', () => {
  const gh = repoWeb('git@github.com:acme/shop.git')!
  it('links a file, a line, or lines - each host its way', () => {
    expect(fileUrl(gh, 'main', 'app/models/user.rb')).toBe('https://github.com/acme/shop/blob/main/app/models/user.rb')
    expect(fileUrl(gh, 'abc123', 'a.rb', [5, 5])).toBe('https://github.com/acme/shop/blob/abc123/a.rb#L5')
    expect(fileUrl(gh, 'feat/x', 'my file.rb', [3, 9])).toBe('https://github.com/acme/shop/blob/feat/x/my%20file.rb#L3-L9')
    expect(fileUrl(repoWeb('git@gitlab.com:t/a.git')!, 'main', 'a.rb', [3, 9])).toBe('https://gitlab.com/t/a/-/blob/main/a.rb#L3-9')
    expect(fileUrl(repoWeb('git@bitbucket.org:t/a.git')!, 'main', 'a.rb', [3, 9])).toBe('https://bitbucket.org/t/a/src/main/a.rb#lines-3:9')
    expect(commitUrl(gh, 'abc')).toBe('https://github.com/acme/shop/commit/abc')
  })
})
