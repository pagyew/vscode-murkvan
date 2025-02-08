# Murkvan

Watch package lock files and suggest to re-run npm.

## Features

- `npm` support

## Install

Install options:

- Install from the command line: `code --install-extension pagyew.murkvan`
- Search for `Murkvan` in the VS Code extensions panel

## Requirements

- Use either `npm` in your project
- A `node_modules` directory

## Extension Commands

| Setting                            | Description             |
| :--------------------------------- | :---------------------- |
| `murkvan.showOutputChannel` | Show the output channel |

## Release Notes

See [Changelog](./CHANGELOG.md)

## Publish

Publish a new version:

1. Update `CHANGELOG.md` and add a new version
2. Publish with `vsce`

```
npm i -g vsce
vsce publish patch
```

## FAQ

### How does the extension work?

- Activate if there are 1 or multiple `package.json` file(s) within the workspace.
- Watch for changes to `yarn.lock` or `package-lock.json` files.
- When there are changes, ensure a sibling `node_modules` directory already exists. If not, don't do anything.
- When a `node_modules` directory exist either:
  - Ping the user to run the install command: `request` mode
  - Automatically run the install command: `auto` mode

### How does the monorepo support work?

We only run the install command in directories which have a `node_modules` directory. If that doesn't exist, we will not run the package install command.

### The extension doesn't seem to work, what can I do to debug?

Validate the following:

1. `package.json` exists in the VSCode workspace.
2. `yarn.lock` or `package-lock.json` file exists in the VSCode workspace.
3. `node_modules` directory lives next to the `package.json` directory.

Then restart your editor and copy/paste the output in the `Murkvan` output log. You can see this log by clicking on `Murkvan` in the status bar.
