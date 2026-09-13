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

A single-repo monorepo — one shared lockfile, workspace members declared
either via `workspaces` in the root manifest (npm/yarn) or `packages:` in
`pnpm-workspace.yaml` (pnpm, parsed without a YAML dependency: just its
`packages:` list, block or flow style) — is covered too: the
manifest-fallback path resolves those globs (a literal path, or a single
trailing `*`; anything needing more than that, such as recursive `**`, is
skipped rather than mis-resolved) and folds each member's own declared
dependencies into the same diff, so drift in a member package that never
touches the root manifest is no longer invisible. Each member's dependency is
checked against its own `node_modules` first and the shared root one second —
npm/yarn hoist member dependencies to the root, pnpm deliberately does not,
leaving them in the member's own `node_modules` instead, and this order
covers both without needing to know which manager is in play. npm's fast
lockfile-vs-lockfile path already covered the npm/yarn case without any
change, since `package-lock.json` records the whole resolved workspace tree
regardless of which member declared what.

When activation finds no supported lockfile at all — a fresh `git clone`
before `npm install` has ever run, most often — Murkvan no longer just logs
an error and sits inert until the window is reloaded: it watches for one of
the supported lockfiles being created anywhere in the workspace and re-runs
discovery once one appears, so running the install is all it takes.

Unit tests cover both diff paths, workspace glob resolution, pnpm-workspace
parsing, package manager detection, lockfile grouping, status aggregation,
hashing and Arc detection — and, having been caught getting this wrong
against a real pnpm install once already (checking only the root
`node_modules`, which pnpm never populates for a workspace member), the
per-member-then-root resolution order is itself covered by a regression test.
Integration tests cover activation, the contributed commands and the status
bar.

Every successful sync logs how long it took and how many packages were
involved (`Packages synced in 4.2s (3 packages)`, or `(reinstalled
everything)` for a full reinstall) — telemetry for the developer reading the
output channel, not for anyone else.

The remembered lockfile hash is keyed by Git branch (`getCurrentBranch` in
`src/vcs.ts`, read fresh on every check rather than cached), so checking out
a branch already synced is a no-op instead of a re-check; a non-git project,
or one where `git` isn't on `PATH`, still remembers a single hash for the
whole project, exactly as before branches were tracked.

`murkvan.postSyncCommand`, left empty by default, runs in a project's own
directory after every successful sync — for a `prisma generate` or codegen
step a targeted install doesn't retrigger on its own. A non-zero exit is
logged and shown as a warning rather than an error, since the sync itself
already succeeded.

The "Changes detected" notification also offers "Always install for this
project" alongside Install/Reinstall — a per-project trust flag, independent
of the global `murkvan.autoInstall` setting, that skips the prompt for that
project's future syncs once accepted. **Murkvan: Stop auto-installing for a
project** reverts it.

A **Pending changes** tree view, contributed into the Explorer sidebar,
lists the same diff package by package — installed version, declared range,
and an inline install action for just that one package — grouped by project
once there is more than one, same as the status bar's own pending list. Its
view-title **Install all** action installs everything currently shown; an
empty tree shows "Everything is in sync" via `viewsWelcome`. This required
extending `Project.installPackages()` to accept an optional subset of
package names, defaulting to every pending one so every existing call site
(the command palette, the status bar tooltip link, `autoInstall`) is
unaffected — and installing one package now leaves the rest pending instead
of clearing the whole project's diff.

## Next

Nothing is currently planned. Every item that was tracked under "Later" has
shipped; new work starts here when it's proposed.

## Later

Nothing currently planned.

## Engineering debt

- Integration tests cannot run where `update.code.visualstudio.com` is
  unreachable. The unit suite runs anywhere; keep new logic testable without
  `vscode` wherever it can be.
