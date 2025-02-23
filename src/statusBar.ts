import * as vscode from "vscode";

let statusBarItem: vscode.StatusBarItem;
let extensionName: string;

const Status = {
  idle: "eye",
  syncing: "sync~spin",
  error: "error",
};

type Status = keyof typeof Status;

const Tooltip = {
  idle: "Watching package.json",
  syncing: "Syncing packages...",
  error: "Error",
};

const activate = (name: string) => {
  extensionName = name;
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
  statusBarItem.command = "murkvan.showOutputChannel";
  statusBarItem.show();
};

const updateStatus = (status: Status) => {
  statusBarItem.text = `${extensionName}: $(${Status[status]})`;
  statusBarItem.tooltip = Tooltip[status];
};

const dispose = () => {
  statusBarItem.hide();
  statusBarItem.dispose();
};

const get = () => {
  return statusBarItem;
};

export default { activate, dispose, get, updateStatus };
