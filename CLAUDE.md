# Working in this repository

## Pull requests

When a piece of work is finished, open a pull request for it without being
asked, and enable auto-merge on it so it lands once CI is green.

If auto-merge cannot be enabled, say why in the reply rather than leaving it
silently off. Two cases come up:

- **The repository toggle is off.** Enable it under Settings → General →
  Pull Requests → Allow auto-merge. Until then, auto-merge cannot be set on
  any PR here.
- **Checks already passed.** Auto-merge only applies while checks are
  pending, so GitHub rejects it on a PR that is already `clean`. Nothing is
  left to wait for; merging directly is the remaining step.

## Testing

`npm test` runs two suites:

- `npm run test:unit` — Mocha over `src/test/unit`, for modules that do not
  import `vscode`. No VS Code download, so it runs in any environment.
- `npm run test:integration` — `@vscode/test-cli` over
  `src/test/integration`, inside a real VS Code instance. It downloads VS
  Code from `update.code.visualstudio.com`; where that host is unreachable,
  run the unit suite and say plainly that the integration suite did not run.

Keep new logic testable without `vscode` wherever it can be — that is what
keeps the fast suite useful.

Before pushing, run `npm run check-types`, `npm run lint` and
`npm run test:unit`.

## Roadmap

[ROADMAP.md](ROADMAP.md) records planned work. When a change lands that
completes or invalidates an item there, update it in the same PR.
