/** The files of a new plugin (Settings → Plugins → New plugin): a working example and its guide. */
export function EXAMPLE_FILES(id: string): Record<string, string> {
  const manifest = {
    id,
    name: id === 'hello' ? 'Hello' : `Hello (${id})`,
    version: '0.1.0',
    description: 'An example: a command, a card badge, and how to add an agent.',
    main: 'main.js',
    commands: [{ id: 'copy-markdown', title: 'Copy task as Markdown', key: 'ctrl+alt+m' }],
    agents: []
  }
  return {
    'plugin.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'main.js': MAIN,
    'README.md': README.replace(/\{id\}/g, id),
    '.sypluginignore': '# Left out of the package (like .gitignore): tests, notes, sources that get built.\n*.log\n'
  }
}

const MAIN = `// A Switchyard plugin. activate(sy) runs when Switchyard starts (or the
// plugin is turned on); sy is the API - see README.md.

exports.activate = (sy) => {
  // A command: listed in plugin.json's "commands", run from the palette
  // (Ctrl+K), the Plugins menu or its key.
  sy.commands.register('copy-markdown', async ({ taskId }) => {
    const task = taskId ? await sy.tasks.get(taskId) : null
    if (!task) return sy.ui.toast('Open a task first - this copies the one on screen.')
    await sy.ui.copy(\`- [ ] **\${task.key}** \${task.title}\${task.branch ? \` (\\\`\${task.branch}\\\`)\` : ''}\`)
    await sy.ui.toast(\`Copied \${task.key} as Markdown\`)
  })

  // A badge on cards: how long a task has been in progress, once it's over a day.
  const DAY = 24 * 60 * 60 * 1000
  sy.on('tasks', (tasks) => {
    for (const t of tasks) {
      const days = t.col === 'progress' && t.startedAt ? Math.floor((Date.now() - t.startedAt) / DAY) : 0
      sy.badges.set(t.id, days >= 1 ? [{ text: \`\${days}d\`, tone: days >= 3 ? 'warn' : 'muted', tooltip: \`In progress for \${days} day\${days > 1 ? 's' : ''}\` }] : [])
    }
  })

  sy.log('hello from', sy.id)
}
`

const README = `# A Switchyard plugin

This folder is a plugin: **plugin.json** says what it adds, **main.js** runs it.
Edit them, then **Settings → Plugins → ⋯ → Reload plugins**. What a plugin writes
with \`sy.log\` (and its errors) goes to Switchyard's log (Help → Open logs folder).

To work on it somewhere else (in its own git repository, say), move the folder
there and use **⋯ → Load from folder…** - Switchyard loads it from where it is.

## Sharing it

**⋯ → Package…** on the plugin (or **⋯ → Package a folder…**) makes
\`<id>-<version>.syplugin\` - one file with everything in the folder, except what
\`.sypluginignore\` leaves out (written like a .gitignore) and version-control
folders. Whoever gets it double-clicks it, drops it on Settings → Plugins, or uses
**Install from file…** (or **Install from URL…** for an https link). Switchyard
shows what it adds before installing; a package with a higher \`version\` updates
the plugin in place.

From Switchyard's sources, a build can package it too:
\`npm run plugin:pack -- <plugin folder> [-o <file or folder>]\`.

Set \`"engines": { "switchyard": ">=0.2.0" }\` when it needs a newer Switchyard
(\`>=\`, \`^\` or an exact version) - an older one won't install it.

A plugin's script runs with your user's permissions (like a VS Code
extension) in a separate process: it can use any Node module, read files,
run programs. Only turn on plugins you trust.

## plugin.json

\`\`\`json
{
  "id": "{id}",                    // = the folder's name: lowercase, digits, dashes
  "name": "Hello",
  "version": "0.1.0",
  "description": "What it does",
  "main": "main.js",              // optional: a plugin can only add agents
  "commands": [
    { "id": "copy-markdown", "title": "Copy task as Markdown", "key": "ctrl+alt+m", "when": "workspace" }
  ],
  "agents": [
    {
      "kind": "goose",            // its id (not a built-in one)
      "name": "Goose",
      "bin": "goose",             // the program, found on PATH
      "short": "goose",           // optional: its name on cards
      "note": "Block · any model",
      "promptFlag": "-t",         // optional: the flag the first message goes after
      "resumeArgs": ["session", "--resume"],  // optional: reopens its last session
      "typesPrompt": false        // true: the message is typed in once it's running
    }
  ]
}
\`\`\`

(No comments in the real file - JSON doesn't allow them.)

An agent from a plugin shows up in the Start dialog, Settings → Agents and
everywhere else; Switchyard runs it in a terminal and works out whether it's
working or waiting from what it prints, as with the built-in ones. Its
arguments can be added in Settings → Agents.

## main.js

\`\`\`js
exports.activate = (sy) => { /* … */ }
\`\`\`

Everything that asks Switchyard for something returns a promise.

| | |
|---|---|
| \`sy.id\` | this plugin's id |
| \`sy.commands.register(id, fn)\` | runs \`fn({ taskId, projectId })\` for a command from plugin.json (the task and project on screen, or null) |
| \`sy.tasks.list()\` / \`sy.tasks.get(id)\` | the tasks (key, title, col, branch, worktreePath, agentKind, st, startedAt…) |
| \`sy.tasks.create({ projectId, title, desc?, col? })\` | a new task (col: \`"backlog"\` or \`"ready"\`) |
| \`sy.projects.list()\` | the projects (id, name, repoPath, prefix, defaultBranch) |
| \`sy.agents.message(taskId, text)\` | types a message to the task's agent (starting it again if it isn't running) |
| \`sy.badges.set(taskId, [{ text, tone?, tooltip? }])\` | up to 3 labels on the task's card; tone: info, success, warn, danger, muted; \`[]\` removes them |
| \`sy.badges.clear(taskId?)\` | removes this plugin's badges (from one task, or all) |
| \`sy.ui.toast(text)\` | a message at the bottom of the window |
| \`sy.ui.notify(title, body, taskId?)\` | a system notification (clicking it opens the task) |
| \`sy.ui.copy(text)\` | puts text on the clipboard |
| \`sy.ui.openExternal(url)\` | opens an http(s) link in the browser |
| \`sy.on('tasks', fn)\` | \`fn(tasks)\` when tasks change (and once at the start) |
| \`sy.on('task', fn)\` | \`fn(task, before)\` for each task that changed (\`before\`: null for a new one) |
| \`sy.log(...)\`, \`sy.warn(...)\`, \`sy.error(...)\` | to Switchyard's log |
`
