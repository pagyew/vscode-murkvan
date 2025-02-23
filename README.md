# Murkvan

Watch package.json files and install dependencies if changed.

## Features

* `npm` support
* `arc` support

## Install

Install options:

* Install from the command line: `code --install-extension pagyew.murkvan`
* Search for `Murkvan` in the VS Code extensions panel

## Requirements

* Use `npm` in your project

## Extension Commands

| Setting                            | Description             |
| :--------------------------------- | :---------------------- |
| `murkvan.showOutputChannel`        | Show the output channel |

## Release Notes

See [Changelog](./CHANGELOG.md)

## FAQ

### How does the extension work?

* Activate if there is `package.json` file within the workspace.
* Watch for changes to `package.json` files.
* Automatically run the install command

### The extension doesn't seem to work, what can I do to debug?

Validate the following:

1. `package.json` exists in the VSCode workspace.

Then restart your editor and copy/paste the output in the `Murkvan` output log. You can see this log by clicking on `Murkvan` in the status bar.
