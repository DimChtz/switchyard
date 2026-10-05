import { describe, expect, it } from 'vitest'
import { chainCommands, checkoutsOf, inProject, isMulti, repoCommands, repoDir, reposOf, splitRepoPath, taskRoot } from './multiRepo'
import type { Project, Task } from '@shared/types'

const project = (id: string, repoPath: string): Project => ({ id, name: id, repo: id, repoPath, prefix: 'X' }) as Project
const projects = [project('web', 'C:\\code\\web-app'), project('api', 'C:\\code\\api-gateway')]
const task = (o: Partial<Task>): Task => ({ id: 'T-1', key: 'T-1', projectId: 'web', worktreePath: null, ...o }) as Task

describe('multi-repo tasks', () => {
  it('lists the repositories home first, and belongs on each of their boards', () => {
    const t = task({ repos: ['api', 'web'] })
    expect(reposOf(t)).toEqual(['web', 'api'])
    expect(isMulti(t)).toBe(true)
    expect(isMulti(task({}))).toBe(false)
    expect(inProject(t, 'api')).toBe(true)
    expect(inProject(t, 'other')).toBe(false)
  })

  it('names worktree folders after the repository folder', () => {
    expect(repoDir(projects[1])).toBe('api-gateway')
  })

  it('finds each repository’s worktree in the task folder', () => {
    const t = task({ repos: ['api'], taskDir: 'C:\\wt\\_multi\\T-1', worktreePath: 'C:\\wt\\_multi\\T-1\\web-app' })
    expect(taskRoot(t)).toBe('C:\\wt\\_multi\\T-1')
    expect(checkoutsOf(t, projects).map((c) => [c.project.id, c.dir, c.path])).toEqual([
      ['web', 'web-app', 'C:\\wt\\_multi\\T-1\\web-app'],
      ['api', 'api-gateway', 'C:\\wt\\_multi\\T-1\\api-gateway']
    ])
    const hit = splitRepoPath(t, projects, 'api-gateway/src/x.ts')!
    expect([hit.checkout.project.id, hit.rel]).toEqual(['api', 'src/x.ts'])
    expect(splitRepoPath(t, projects, 'elsewhere/x.ts')).toBeNull()
  })

  it('a single-repo task: its worktree is the root, paths are the home’s', () => {
    const t = task({ worktreePath: '/wt/feature' })
    expect(taskRoot(t)).toBe('/wt/feature')
    expect(checkoutsOf(t, projects).map((c) => [c.dir, c.path])).toEqual([['', '/wt/feature']])
    expect(splitRepoPath(t, projects, 'src/x.ts')!.rel).toBe('src/x.ts')
  })

  it('runs a command in each repository that has it, stopping at the first that fails', () => {
    const ps = [{ ...projects[0], testCmd: 'npm test' }, { ...projects[1], testCmd: "go test './...'" }]
    const t = task({ repos: ['api'], taskDir: 'C:\\wt\\_multi\\T-1', worktreePath: 'C:\\wt\\_multi\\T-1\\web-app' })
    const steps = repoCommands(t, ps, 'testCmd')
    expect(steps.map((s) => [s.name, s.cwd])).toEqual([
      ['web', 'C:\\wt\\_multi\\T-1\\web-app'],
      ['api', 'C:\\wt\\_multi\\T-1\\api-gateway']
    ])
    expect(repoCommands(t, ps, 'devCmd')).toEqual([])
    expect(chainCommands(steps.slice(0, 1), true)).toBe('npm test')
    expect(chainCommands(steps, true)).toBe(
      'cd /d "C:\\wt\\_multi\\T-1\\web-app" && echo. && echo -- web: npm test -- && npm test && cd /d "C:\\wt\\_multi\\T-1\\api-gateway" && echo. && echo -- api: go test \'./...\' -- && go test \'./...\''
    )
    expect(chainCommands([{ name: "it's", cwd: '/a b', cmd: 'make' }, { name: 'b', cwd: '/c', cmd: 'make' }], false)).toBe(
      "cd '/a b' && printf '\\n-- %s --\\n' 'it'\\''s: make' && make && cd '/c' && printf '\\n-- %s --\\n' 'b: make' && make"
    )
  })

  it('before it starts, attached repositories have no worktree yet', () => {
    const t = task({ repos: ['api'] })
    expect(checkoutsOf(t, projects).map((c) => c.path)).toEqual([null, null])
  })
})
