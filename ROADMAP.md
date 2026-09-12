# Roadmap

Murkvan keeps `node_modules` in step with the branch you are on. This file
records where it is today and what would make it hold up in bigger, messier
repositories.

## Where it stands

The extension discovers every lockfile in the workspace — not just the first —
and tracks each as its own project: its own package manager, its own pending
packages, its own in-flight install, so a genuine multi-root VS Code workspace
or a folder that happens to hold more than one independent project (e.g. an
`examples/` directory with its own lockfile) works without one project's state
clobbering another's. One shared status bar entry aggregates all of them —
the most attention-grabbing status wins, and a pending-changes list is
prefixed per project once there is more than one to tell apart — and the
install commands prompt for which project to act on when more than one
qualifies. npm, yarn, pnpm and bun are all supported, selected per project from
whichever lockfile is present in its directory (`packageManager` in
`package.json` breaks the tie when a directory somehow holds more than one).
For npm, the diff
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

Unit tests cover both diff paths, package manager detection, lockfile
grouping, status aggregation, hashing and Arc detection. Integration tests
cover activation, the contributed commands and the status bar.

## Next

### 1. npm/yarn/pnpm workspaces (single-repo monorepos)

Multi-root VS Code workspaces are covered, but a monorepo that is one Murkvan
project on disk — one shared lockfile, a `workspaces` field in the root
manifest — is not: only the root `package.json`'s own dependencies are
diffed, so drift in a member package's own `dependencies` goes unnoticed
unless it happens to also affect the root. Resolving `workspaces` globs from
the root manifest and folding each member's declared dependencies into the
same diff (still against the one shared `node_modules`) would close that gap
without needing separate per-member projects — pnpm's `pnpm-workspace.yaml`
needs its own glob source since it doesn't use the `workspaces` field.

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
- `src/log.ts` and `src/statusBar.ts` are module singletons with mutable
  state. One shared output channel and one aggregated status bar entry across
  every project is the right call either way, but the singleton shape still
  makes parallel tests awkward; a class instantiated in `activate` would be
  cheaper to reason about.
- `npm audit` currently reports vulnerabilities in the dev toolchain. None are
  in shipped code — the bundle ships only `semver` and `chokidar` — but the
  toolchain is worth a pass.
