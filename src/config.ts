import * as vscode from 'vscode';

export const SETTINGS_NAMESPACE = 'murkvan';

/** Reads a `murkvan.*` setting, falling back when it is unset. */
export function getSetting<T>(key: string, fallback: T): T {
	return vscode.workspace.getConfiguration(SETTINGS_NAMESPACE).get<T>(key) ?? fallback;
}
