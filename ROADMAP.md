# Roadmap

Murkvan keeps `node_modules` in step with the branch you are on. This file
records where it is today and what would make it hold up in bigger, messier
repositories.

## Where it stands

The extension watches one root lockfile, re-hashes it on change, and offers to
install whatever no longer fits — npm, yarn, pnpm and bun are all supported,
selected from whichever lockfile is present in the workspace (`packageManager`
in `package.json` breaks the tie when more than one is). For npm, the diff
prefers comparing `package-lock.json` against `node_modules/.package-lock.json`
— the tree npm 7+ actually installed — which covers transitive dependencies in
two JSON reads. Every other case — an npm project too old to have written that
file, or any yarn/pnpm/bun project, since none of them produce an npm-shaped
equivalent — falls back to comparing `package.json` against the versions on
disk with semver ranges by walking `node_modules`; that fallback doesn't care
which manager owns the tree, which is what makes the other three managers
possible without parsing their lockfile formats. Installing pins the exact
version each diff names — the lockfile's own resolved version, when the diff
came from npm's fast path — instead of letting the manager re-resolve a range;
yarn's and pnpm's `add` always rewrite `package.json`, so only **Reinstall
everything** (their own `--frozen-lockfile` equivalent of `npm ci`) is offered
for those two. Git is handled implicitly — a checkout rewrites the lockfile and
the watcher fires; Arc is handled explicitly, because its FUSE-backed store
never reports changes to native watchers.

Unit tests cover both diff paths, package manager detection, hashing and Arc
detection. Integration tests cover activation, the contributed commands and
the status bar.

## Next

### 1. Workspaces and monorepos

Today the first root-level lockfile wins and everything else is invisible. A
monorepo needs: every workspace folder watched, `workspaces` globs from the root
manifest resolved, and per-project state instead of the single
`packagesToInstall` / `projectDir` pair the extension carries now. Multi-root VS
Code workspaces fall out of the same change.

### 2. Recover without a reload

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
