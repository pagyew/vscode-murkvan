# Roadmap

Murkvan keeps `node_modules` in step with the branch you are on. This file
tracks what's planned; see [README.md](README.md) for how the extension
actually behaves today.

## Where it stands

- Tracks every lockfile in the workspace as its own project — multi-root
  workspaces and single-repo monorepos both included — with one shared
  status bar entry and a **Pending changes** view in the Explorer sidebar.
- Supports npm, yarn, pnpm and bun.
- Remembers what it last synced per Git branch, so returning to an
  already-synced branch is a no-op instead of a re-check.
- Optional automation: a global or per-project auto-install trust, and a
  `murkvan.postSyncCommand` hook for post-install scripts.
- Logs sync duration and package count to the output channel.

## Next

Nothing currently planned.

## Later

Nothing currently planned.

## Engineering debt

- Integration tests cannot run where `update.code.visualstudio.com` is
  unreachable. The unit suite runs anywhere; keep new logic testable without
  `vscode` wherever it can be.
