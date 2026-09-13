<div align="center">
  <img src=".github/assets/cover.png" alt="Murkvan — project illustration" width="100%" />
  <img src="images/logo.png" alt="" width="88" />

  <h1>Murkvan</h1>
  <p><strong>Keep installed npm packages in step with your workspace.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/VS%20Code-1.96%2B-007acc?style=flat-square" alt="VS Code: 1.96+" />
    <img src="https://img.shields.io/badge/npm-dependency%20sync-cb3837?style=flat-square" alt="npm: dependency sync" />
    <img src="https://img.shields.io/badge/license-MIT-0f766e?style=flat-square" alt="license: MIT" />
  </p>
  <p><a href="#install">Install</a> · <a href="#features">Features</a> · <a href="#commands">Commands</a> · <a href="https://github.com/pagyew/vscode-murkvan/releases">Releases</a></p>
</div>

---

A VS Code extension that watches a project's lockfile, compares declared dependencies with installed packages, and offers to install the changes it detects. Works with npm, yarn, pnpm and bun, and with more than one project open at once.

## Install

```sh
code --install-extension pagyew.murkvan
```

Or search for **Murkvan** in the VS Code Extensions panel.

## Requirements

- VS Code 1.96 or newer.
- A project with `package.json`, one supported lockfile (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`/`bun.lockb`), and an existing `node_modules` directory.
- The matching package manager available on `PATH`.

## Features

- **Watches your lockfile.** The moment `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, or `bun.lock`/`bun.lockb` changes — most often right after `git checkout` — Murkvan checks whether what's installed still matches what's declared.
- **One-click sync.** Found drift? A notification offers **Install packages** (just the changes) or **Reinstall everything** (a full, `npm ci`-style reinstall for when the drift runs deeper than a top-level diff can see). yarn and pnpm only offer the full reinstall, since their `add` command always rewrites `package.json`.
- **Branch-aware.** Murkvan remembers what it last synced per Git branch, so switching back to a branch you've already synced is a no-op — not another round of checks.
- **npm, yarn, pnpm, and bun** — detected automatically, no configuration needed.
- **Multi-root and monorepo aware.** Every lockfile in your workspace is tracked as its own project, workspace members included.
- **Pending changes view.** A tree view in the Explorer sidebar shows exactly what's out of sync — installed version, declared range, and an install action per package, or for everything at once.
- **Automation, entirely opt-in.** Auto-install everything (`murkvan.autoInstall`), trust individual projects to auto-install ("Always install for this project"), or run a command after every sync (`murkvan.postSyncCommand`) — handy for `prisma generate` or similar.
- **Arc support.** If Arc is installed, Murkvan also watches its staging area, since Arc doesn't notify ordinary file watchers.

One status bar entry summarizes every project at once, and progress, detected changes, and logs are all available through the **Murkvan** output channel.

## Commands

| Command ID                  | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `murkvan.showOutputChannel` | Open the extension's log                 |
| `murkvan.installPackages`   | Install the pending package changes (asks which project when more than one is open) |
| `murkvan.checkPackages`     | Compare packages now for every open project, without a lockfile change |
| `murkvan.reinstallAll`      | Reinstall a project's whole tree from its lockfile (asks which project when more than one is open) |
| `murkvan.stopAutoInstalling` | Revert an earlier "Always install for this project" choice (asks which project when more than one is open) |
| `murkvan.installAllPending`  | Install everything shown in the **Pending changes** view |

## Settings

| Setting                            | Default  | Purpose                                                     |
| ---------------------------------- | -------- | ----------------------------------------------------------- |
| `murkvan.logLevel`                 | `info`   | How much is written to the output channel (`off`/`info`/`debug`) |
| `murkvan.showOutputOnError`        | `false`  | Reveal the output channel whenever an error is logged        |
| `murkvan.includeDevDependencies`   | `true`   | Compare `devDependencies` as well as `dependencies`          |
| `murkvan.autoInstall`              | `false`  | Install detected changes immediately instead of asking first |
| `murkvan.postSyncCommand`          | `""`     | Shell command to run in the project directory after every successful sync |

## Troubleshooting

Check that the workspace root contains the manifest and lockfile, that dependencies have been installed once, and that `npm` is on `PATH`. Run **Murkvan: Check packages** to compare on demand, then open the **Murkvan** output channel and inspect the recorded paths and errors.

## Development

```sh
git clone https://github.com/pagyew/vscode-murkvan.git
cd vscode-murkvan
npm ci
npm run compile
```

Use the checked-in [.vscode/launch.json](.vscode/launch.json) to start an Extension Development Host.

| Command               | Purpose                               |
| --------------------- | ------------------------------------- |
| `npm run watch`       | Rebuild and type-check on changes     |
| `npm run check-types` | Type-check                            |
| `npm run lint`        | Lint source files                     |
| `npm test`            | Run the unit and integration suites   |
| `npm run test:unit`   | Run the unit suite only (no VS Code download) |
| `npm run package`     | Build the production extension bundle |

Unit tests in `src/test/unit` cover the modules that do not import `vscode` and run under plain Mocha. Integration tests in `src/test/integration` run inside a VS Code instance downloaded by `@vscode/test-cli`.

## Roadmap

Planned work is tracked in [ROADMAP.md](ROADMAP.md).

## License

[MIT](LICENSE). See the license file for the original copyright notice.

<!-- Сообщение сформировано агентом -->
