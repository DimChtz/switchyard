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
- To build from source: **Node.js 20.19+ or 22.12+** and npm.

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
| `npm run build:win` / `build:mac` / `build:linux` | Packages installers into `dist/`: NSIS on Windows, DMG on macOS, AppImage and deb on Linux. |
| `npm run plugin:pack -- <folder> [-o <out>]` | Packs a plugin folder into a `.syplugin` file. |

Automatic updates (Help → Check for updates) need a release channel. Set `publish` in `electron-builder.yml`.

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
