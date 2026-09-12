import * as vscode from "vscode";

let statusBarItem: vscode.StatusBarItem | undefined;
let extensionName = "Murkvan";

const Status = {
  idle: "eye",
  searching: "loading~spin",
  changes: "request-changes",
  syncing: "sync~spin",
  error: "error",
};

type Status = keyof typeof Status;

const Tooltip = {
  idle: "Watching package.json",
  searching: "Searching for package changes...",
  syncing: "Syncing packages...",
  error: "Error — open the Murkvan output channel for details",
  changes: (packages: string[]) => '' +
    'Changes detected:' +
    '\n\n' +
    packages.map(pkg => '- `' + pkg + '`').join('\n') +
    '\n\n' +
    '[Click to install](command:murkvan.installPackages)',
};

const dispose = () => {
  statusBarItem?.dispose();
  statusBarItem = undefined;
};

const activate = (name: string) => {
  // Replace any previous item so repeated activations cannot leak one.
  dispose();

  extensionName = name;
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
  statusBarItem.name = name;
  statusBarItem.command = "murkvan.showOutputChannel";
  statusBarItem.show();
};

const updateStatus = (status: Status, packages: string[] = []) => {
  if (!statusBarItem) {
    return;
  }

  statusBarItem.text = `${extensionName}: $(${Status[status]})`;

  if (status === 'changes') {
    const mdTooltip = new vscode.MarkdownString(Tooltip.changes(packages));

    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

    mdTooltip.isTrusted = {enabledCommands: ['murkvan.installPackages']};
    statusBarItem.tooltip = mdTooltip;
  } else {
    // Only warningBackground and errorBackground are supported here; any other
    // ThemeColor is dropped by VS Code, so clear the warning with undefined.
    statusBarItem.backgroundColor = undefined;
    statusBarItem.tooltip = Tooltip[status];
  }
};

const get = () => {
  return statusBarItem;
};

export default { activate, dispose, get, updateStatus };
