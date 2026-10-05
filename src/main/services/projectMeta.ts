import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ProjectMeta } from '@shared/types'

function packageManager(root: string): { pm: 'pnpm' | 'yarn' | 'npm'; lock: string } {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return { pm: 'pnpm', lock: 'pnpm-lock.yaml' }
  if (existsSync(join(root, 'yarn.lock'))) return { pm: 'yarn', lock: 'yarn.lock' }
  return { pm: 'npm', lock: existsSync(join(root, 'package-lock.json')) ? 'package-lock.json' : 'package.json' }
}

function runScript(pm: string, script: string): string {
  if (pm === 'npm') return `npm run ${script}`
  return `${pm} ${script}`
}

// bin/dev (foreman: server + asset watchers) is a POSIX shell script, so it
// can't run under cmd.exe - on Windows start the Rails server directly.
function railsDevCmd(root: string): { cmd: string; src: string } {
  if (process.platform !== 'win32' && existsSync(join(root, 'bin', 'dev'))) return { cmd: 'bin/dev', src: 'bin/dev' }
  return { cmd: process.platform === 'win32' ? 'ruby bin/rails server' : 'bin/rails server', src: 'bin/rails' }
}

export function detectProjectMeta(root: string): ProjectMeta {
  const has = (...p: string[]): boolean => existsSync(join(root, ...p))

  if (has('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
      const { pm, lock } = packageManager(root)
      const scripts = pkg.scripts ?? {}
      const hasTs = has('tsconfig.json')
      const devScript = scripts.dev ? 'dev' : scripts.start ? 'start' : null
      return {
        lang: hasTs ? 'TypeScript' : 'JavaScript',
        devCmd: devScript ? runScript(pm, devScript) : undefined,
        testCmd: scripts.test ? runScript(pm, 'test') : undefined,
        setupCmd: pm === 'npm' ? 'npm install' : `${pm} install`,
        src: {
          lang: hasTs ? 'tsconfig.json' : 'package.json',
          setupCmd: lock,
          testCmd: scripts.test ? 'package.json › scripts.test' : undefined,
          devCmd: devScript ? `package.json › scripts.${devScript}` : undefined
        }
      }
    } catch {
      return { lang: 'JavaScript', src: { lang: 'package.json' } }
    }
  }

  if (has('go.mod')) {
    return {
      lang: 'Go',
      devCmd: has('main.go') ? 'go run .' : undefined,
      testCmd: 'go test ./...',
      setupCmd: 'go mod download',
      src: { lang: 'go.mod', setupCmd: 'go.mod', testCmd: 'go.mod', devCmd: has('main.go') ? 'main.go' : undefined }
    }
  }
  if (has('Cargo.toml')) {
    return {
      lang: 'Rust',
      devCmd: 'cargo run',
      testCmd: 'cargo test',
      setupCmd: 'cargo fetch',
      src: { lang: 'Cargo.toml', setupCmd: has('Cargo.lock') ? 'Cargo.lock' : 'Cargo.toml', testCmd: 'Cargo.toml', devCmd: 'Cargo.toml' }
    }
  }
  if (has('pyproject.toml') || has('requirements.txt')) {
    const django = has('manage.py')
    const pytest = !django || has('pytest.ini')
    return {
      lang: 'Python',
      devCmd: django ? 'python manage.py runserver' : undefined,
      testCmd: pytest ? 'pytest' : 'python manage.py test',
      setupCmd: has('requirements.txt') ? 'pip install -r requirements.txt' : undefined,
      src: {
        lang: has('pyproject.toml') ? 'pyproject.toml' : 'requirements.txt',
        setupCmd: has('requirements.txt') ? 'requirements.txt' : undefined,
        testCmd: has('pytest.ini') ? 'pytest.ini' : pytest ? 'pyproject.toml' : 'manage.py',
        devCmd: django ? 'manage.py' : undefined
      }
    }
  }
  if (has('Gemfile')) {
    const rails = has('bin', 'rails')
    const dev = rails ? railsDevCmd(root) : null
    const rspec = has('spec')
    return {
      lang: 'Ruby',
      devCmd: dev?.cmd,
      testCmd: rspec ? 'bundle exec rspec' : rails ? 'ruby bin/rails test' : undefined,
      setupCmd: 'bundle install',
      src: {
        lang: 'Gemfile',
        setupCmd: has('Gemfile.lock') ? 'Gemfile.lock' : 'Gemfile',
        testCmd: rspec ? 'spec/' : rails ? 'test/' : undefined,
        devCmd: dev?.src
      }
    }
  }

  return { lang: '', src: {} }
}
