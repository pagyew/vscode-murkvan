import * as vscode from "vscode";

const Status = {
  idle: "eye",
  searching: "loading~spin",
  changes: "request-changes",
  syncing: "sync~spin",
  error: "error",
};

export type Status = keyof typeof Status;

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

export class StatusBar implements vscode.Disposable {
  private readonly name: string;
  private item: vscode.StatusBarItem | undefined;

  constructor(name: string) {
    this.name = name;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    this.item.name = name;
    this.item.command = "murkvan.showOutputChannel";
    this.item.show();
  }

  public updateStatus(status: Status, packages: string[] = []) {
    if (!this.item) {
      return;
    }

    this.item.text = `${this.name}: $(${Status[status]})`;

    if (status === 'changes') {
      const mdTooltip = new vscode.MarkdownString(Tooltip.changes(packages));

      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

      mdTooltip.isTrusted = {enabledCommands: ['murkvan.installPackages']};
      this.item.tooltip = mdTooltip;
    } else {
      // Only warningBackground and errorBackground are supported here; any other
      // ThemeColor is dropped by VS Code, so clear the warning with undefined.
      this.item.backgroundColor = undefined;
      this.item.tooltip = Tooltip[status];
    }
  }

  public get(): vscode.StatusBarItem | undefined {
    return this.item;
  }

  public dispose() {
    this.item?.dispose();
    this.item = undefined;
  }
}
