# Roadmap

Murkvan keeps `node_modules` in step with the branch you are on. This file
records where it is today and what would make it hold up in bigger, messier
repositories.

## Where it stands

The extension watches one root `package-lock.json`, re-hashes it on change,
and offers to install whatever no longer fits. The diff itself prefers
comparing `package-lock.json` against `node_modules/.package-lock.json` — the
tree npm 7+ actually installed — which covers transitive dependencies in two
JSON reads; it falls back to comparing `package.json` against the versions on
disk with semver ranges when either lockfile is missing or predates npm 7, or
the tree was installed by another package manager. Git is handled implicitly —
a checkout rewrites the lockfile and the watcher fires; Arc is handled
explicitly, because its FUSE-backed store never reports changes to native
watchers.

Unit tests cover both diff paths, hashing and Arc detection. Integration tests
cover activation, the contributed commands and the status bar.

## Next

### 1. Install what the lockfile says, not what the manifest says

`npm i --no-package-lock --no-save <pkg>@<range>` resolves the range afresh, so
it can install a version the lockfile never pinned, and it leaves transitive
dependencies untouched. Now that the diff is sourced from the lockfiles, install
the exact versions they name instead. `npm ci` is the correct sledgehammer when
the drift is large; offering it as a choice — "install 3 packages" vs
"reinstall everything" — is a smaller step than making it automatic.

### 2. Other package managers

The lockfile, the install command and the diff source are the only
manager-specific parts. A `PackageManager` interface with `npm`, `yarn`, `pnpm`
and `bun` implementations, selected from the lockfile present in the workspace
(and from `packageManager` in `package.json`), keeps the rest of the extension
unchanged. pnpm's symlinked store needs its own tree reader.

### 3. Workspaces and monorepos

Today the first root-level lockfile wins and everything else is invisible. A
monorepo needs: every workspace folder watched, `workspaces` globs from the root
manifest resolved, and per-project state instead of the single
`packagesToInstall` / `projectDir` pair the extension carries now. Multi-root VS
Code workspaces fall out of the same change.

### 4. Recover without a reload

When no lockfile is found, Murkvan logs an error and stays inert until the
window is reloaded. Watching for the lockfile's creation and re-running
activation would make `git clone` followed by `npm install` work without a
restart.

## Later

- **Branch-aware state.** Remember the lockfile hash per branch, so switching
  back to a branch you already synced is a no-op instead of a re-check.
- **Diff view.** A tree view listing pending changes with old/new versions,
  with install-one and install-all actions, instead of one notification line.
- **Per-project trust.** `autoInstall` is all-or-nothing; a workspace-level
  prompt ("always sync this project") is friendlier than a global setting.
- **Run scripts after install.** Some projects need `prisma generate` or a
  postinstall build to be usable after a branch switch.
- **Telemetry for the developer, not the vendor.** Log how long each sync took
  and how many packages moved, so the output channel can answer "why was that
  slow?".

## Engineering debt

- Integration tests cannot run where `update.code.visualstudio.com` is
  unreachable. The unit suite runs anywhere; keep new logic testable without
  `vscode` wherever it can be.
- `src/log.ts` and `src/statusBar.ts` are module singletons with mutable state.
  They work, but they make parallel tests and multi-root support awkward; a
  class instantiated in `activate` would be cheaper to reason about.
- `npm audit` currently reports vulnerabilities in the dev toolchain. None are
  in shipped code — the bundle ships only `semver` and `chokidar` — but the
  toolchain is worth a pass.
