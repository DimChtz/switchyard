# Switchyard

A desktop dashboard for running coding agents (Claude Code, Codex, Gemini CLI and others) side by side, each in its own git worktree.

Track your projects on a board, start a task with an agent, and Switchyard creates a branch and worktree for it, runs the agent's real CLI in a terminal, and shows you what it changes. Review the diff, leave comments for the agent, commit, and open a pull request, all without the agents stepping on each other's files.

## Features

- **Board per project:** Backlog, Ready, In Progress, Review and Done columns. Starting a task creates its worktree and launches the agent you pick.
- **Agents view:** every running agent across projects, with the ones waiting for you or failed first.
- **Task workspace:** the agent's terminal, shells, files, diffs, preview, notes and timeline as tabs. Split the editor right or down, drag tabs between groups, and resize.
- **Review:** per-file diffs with line comments sent back to the agent as a review, plus commit, discard, and pull requests through the GitHub CLI.
- **Worktrees:** every worktree across projects, with ahead/behind and dirty state, and cleanup.
- **Notes, Inbox, Summary, Usage, Team and Map views.**
- **Command palette** (`Ctrl+K` / `⌘K`), **Go to file** (`Ctrl+P`), and rebindable shortcuts.
- **Themes, settings as JSON, and plugins** (`.syplugin` packages that add commands and agents).

### Supported agents

| Agent | Command on `PATH` |
| --- | --- |
| Claude Code | `claude` |
| Codex | `codex` |
| Gemini CLI | `gemini` |
| Aider | `aider` |
| OpenCode | `opencode` |
| Cursor CLI | `cursor-agent` |
| Copilot CLI | `copilot` |

Switchyard runs the agent's own CLI, so install and sign in to the ones you want to use first. Plugins can add more.

## Requirements

- **Git** on `PATH`.
- At least one supported **agent CLI** on `PATH`.
- Optional: the **GitHub CLI** (`gh`), signed in, for pull requests and checks.
- To build from source: **Node.js 22.13+** (`.nvmrc` pins 24 for nvm) and npm. `.npmrc` sets `engine-strict`, so `npm install` refuses an older Node.

Windows, macOS and Linux are supported. The terminal uses prebuilt `node-pty` binaries, so no C++ build tools are needed.

## Getting started

```bash
npm install
npm run dev
```

Then add a project: a local git repository, or one cloned by URL.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the app with hot reload for the renderer. Main and preload changes need a restart. |
| `npm run build` | Builds into `out/`. |
| `npm start` | Runs the built app. |
| `npm run typecheck` | Type-checks the main/preload and renderer projects. |
| `npm run lint` | Runs ESLint. |
| `npm test` | Runs the unit tests (Vitest). |
| `npm run build:win` / `build:mac` / `build:linux` | Packages installers into `dist/` (NSIS on Windows, DMG and zip on macOS, AppImage and deb on Linux) without publishing anything. |
| `npm run release:win` / `release:mac` / `release:linux` | Packages and uploads to a draft GitHub release (see below). |
| `npm run plugin:pack -- <folder> [-o <out>]` | Packs a plugin folder into a `.syplugin` file. |

Every push to `main` and every pull request runs the type check, lint and the tests on Windows, macOS and Linux (`.github/workflows/ci.yml`). A packaged app can check itself: started with `--smoke-test`, it uses a throwaway data folder, renders, runs a terminal and quits with exit code 0 (1 and the reason when something failed).

### Releasing updates

Installed copies update themselves from this repository's GitHub Releases. They check at start and every few hours, download in the background, and install when Switchyard quits. **Help → Check for updates** checks right away.

To release a version:

1. Bump `version` in `package.json` (for example `0.1.1`) and commit it.
2. Tag the commit and push the tag: `git tag v0.1.1 && git push origin v0.1.1`.
3. GitHub Actions (`.github/workflows/release.yml`) checks the code, then builds Windows, macOS (Apple Silicon and Intel) and Linux, starts each packaged app once (`--smoke-test`), and uploads them, with the `latest*.yml` files the updater reads, to a **draft** release. Its notes list the commits since the previous version.
4. Publish the draft on GitHub. Installed copies only see published releases.

`npm run release:win` (and `:mac` / `:linux`) does the same for one platform from your machine, with `GH_TOKEN` set to a token that can write releases.

**Platform notes:**

- **Windows:** builds aren't code-signed, so SmartScreen warns on first install. Updates work.
- **macOS:** builds aren't signed or notarized (no Apple Developer account). After installing, macOS says the app "is damaged and can't be opened" - it isn't; that's how macOS treats an unsigned app from the internet. Run `xattr -cr /Applications/Switchyard.app` once in Terminal, then open it. It doesn't update itself until it's signed: Switchyard says when a new version is out, with a link to download it.
- **Linux:** the AppImage updates itself; the deb doesn't.

## Project layout

```text
src/
  main/       Electron main process: git, worktrees, terminals (node-pty), agents, store (SQLite), settings, plugins
  preload/    The typed API exposed to the window (window.api)
  renderer/   The React UI: screens, components, the workspace layout
  shared/     Types and logic shared by both sides (keybindings, themes, plugins…)
build/        Icons and entitlements for packaging
```

## Settings and data

Switchyard keeps its data in the app's data folder:

| OS | Data folder |
| --- | --- |
| Windows | `%APPDATA%\Switchyard` |
| macOS | `~/Library/Application Support/Switchyard` |
| Linux | `~/.config/Switchyard` |

- **`switchyard.db`:** projects, tasks and review comments.
- **`settings.json`:** this machine's preferences. Edit it from Preferences or File → Open settings.json.
- **`keybindings.json`:** your shortcuts, which override the defaults.
- **`<repo>/.switchyard/settings.json`:** a project's shared settings, such as setup and test commands. Commit it.
- **`<repo>/.switchyard/settings.local.json`:** your own overrides for that project. Don't commit it.

### Running a second copy for development

When developing, two environment variables let you run a separate copy next to your everyday one. They only work in `npm run dev`:

- `SWITCHYARD_USER_DATA=<folder>` uses a separate data folder.
- `SWITCHYARD_DEBUG_PORT=<port>` opens a Chrome DevTools Protocol port so you can automate the copy.
