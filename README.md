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
  <p><a href="#install">Install</a> · <a href="#how-it-works">How it works</a> · <a href="#commands">Commands</a> · <a href="https://github.com/pagyew/vscode-murkvan/releases">Releases</a></p>
</div>

---

A VS Code extension that watches a package lockfile, compares declared dependencies with installed packages, and offers to install the changes it detects.

## Install

```sh
code --install-extension pagyew.murkvan
```

Or search for **Murkvan** in the VS Code Extensions panel.

## Requirements

- VS Code 1.96 or newer.
- An npm project with `package.json`, `package-lock.json`, and an existing `node_modules` directory.
- `npm` available on `PATH`.
- The current source uses the macOS-style `md5` command to hash the lockfile; other environments need a compatible command.

## How it works

1. Locates the first root-level `package-lock.json` in the workspace and remembers its hash.
2. Watches that file for changes.
3. Compares `dependencies` from `package.json` with packages in `node_modules`.
4. Offers **Install packages** for missing packages, detected major-version differences, and downgrades.
5. Runs `npm i --no-package-lock --no-save` with the selected packages when you choose to install.

Progress, detected changes, and logs are available through the status bar and the **Murkvan** output channel. The implementation also includes a watcher for Arc's staging area when Arc is detected.

> [!NOTE]
> The current comparison covers `dependencies`, not `devDependencies`, and watches one lockfile. It does not run a complete `npm ci` on every change.

## Commands

| Command ID                  | Purpose                             |
| --------------------------- | ----------------------------------- |
| `murkvan.showOutputChannel` | Open the extension's log            |
| `murkvan.installPackages`   | Install the pending package changes |

## Troubleshooting

Check that the workspace root contains the manifest and lockfile, that dependencies have been installed once, and that `npm` and a compatible `md5` command are available. Reload VS Code, open the **Murkvan** output channel, and inspect the recorded paths and errors.

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
| `npm test`            | Run the VS Code test suite            |
| `npm run package`     | Build the production extension bundle |

## License

[MIT](LICENSE). See the license file for the original copyright notice.

<!-- Сообщение сформировано агентом -->
