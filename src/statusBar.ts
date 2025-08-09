import * as vscode from "vscode";

let statusBarItem: vscode.StatusBarItem;
let extensionName: string;

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
  error: "Error",
  changes: (packages: string[]) => '' +
    'Changes detected:' +
    '\n\n' +
    packages.map(pkg => '- `' + pkg + '`').join('\n') +
    '\n\n' +
    '[Click to install](command:murkvan.installPackages)',
};

const activate = (name: string) => {
  extensionName = name;
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
  statusBarItem.command = "murkvan.showOutputChannel";
  statusBarItem.show();
};

const updateStatus = (status: Status, packages: string[] = []) => {
  statusBarItem.text = `${extensionName}: $(${Status[status]})`;

  if (status === 'changes') {
    const mdTooltip = new vscode.MarkdownString(Tooltip.changes(packages));
    
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    
    mdTooltip.isTrusted = {enabledCommands: ['murkvan.installPackages']};
    statusBarItem.tooltip = mdTooltip;
  } else {
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.background');
    statusBarItem.tooltip = Tooltip[status];
  }
};

const dispose = () => {
  statusBarItem.hide();
  statusBarItem.dispose();
};

const get = () => {
  return statusBarItem;
};

export default { activate, dispose, get, updateStatus };
