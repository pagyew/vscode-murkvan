import path from 'node:path';
import * as vscode from 'vscode';
import type { InstallableDiff } from './getDiff';

/** The slice of `Project` the diff view needs — kept minimal to avoid coupling to `extension.ts`. */
export interface DiffProject {
	readonly projectDir: string;
	getPendingDiffs(): InstallableDiff[];
	installPackages(packageNames?: string[]): Promise<void>;
}

interface ProjectNode {
	readonly kind: 'project';
	readonly project: DiffProject;
}

interface PackageNode {
	readonly kind: 'package';
	readonly project: DiffProject;
	readonly diff: InstallableDiff;
}

export type DiffNode = ProjectNode | PackageNode;

function toPackageNode(project: DiffProject, diff: InstallableDiff): PackageNode {
	return { kind: 'package', project, diff };
}

/**
 * Lists every pending package change across all open projects in the
 * Explorer sidebar, grouped by project once there is more than one to tell
 * apart — the same convention `aggregateStatus` uses for the status bar's
 * own pending-changes list.
 */
export class DiffTreeProvider implements vscode.TreeDataProvider<DiffNode> {
	private readonly changeEmitter = new vscode.EventEmitter<DiffNode | undefined>();
	public readonly onDidChangeTreeData = this.changeEmitter.event;

	constructor(private readonly projects: readonly DiffProject[]) {}

	public refresh(): void {
		this.changeEmitter.fire(undefined);
	}

	public getTreeItem(node: DiffNode): vscode.TreeItem {
		if (node.kind === 'project') {
			const count = node.project.getPendingDiffs().length;
			const item = new vscode.TreeItem(path.basename(node.project.projectDir), vscode.TreeItemCollapsibleState.Expanded);

			item.description = `(${count})`;
			return item;
		}

		const { packageName, installedVersion, declaredVersion } = node.diff;
		const item = new vscode.TreeItem(packageName, vscode.TreeItemCollapsibleState.None);

		item.description = `${installedVersion ?? 'not installed'} → ${declaredVersion}`;
		item.contextValue = 'murkvan.pendingPackage';
		return item;
	}

	public getChildren(node?: DiffNode): DiffNode[] {
		if (node?.kind === 'package') {
			return [];
		}

		if (node?.kind === 'project') {
			return node.project.getPendingDiffs().map(diff => toPackageNode(node.project, diff));
		}

		// Same rule the status bar's own pending list follows: no redundant
		// per-project grouping when there is only one project to tell apart.
		if (this.projects.length <= 1) {
			return this.projects.flatMap(project => project.getPendingDiffs().map(diff => toPackageNode(project, diff)));
		}

		return this.projects
			.filter(project => project.getPendingDiffs().length > 0)
			.map((project): ProjectNode => ({ kind: 'project', project }));
	}

	/** Installs just the one package behind a leaf row's inline action. */
	public async installNode(node: DiffNode | undefined): Promise<void> {
		if (node?.kind === 'package') {
			await node.project.installPackages([node.diff.packageName]);
		}
	}

	/** The view-title action: installs everything currently shown. */
	public async installAll(): Promise<void> {
		for (const project of this.projects) {
			if (project.getPendingDiffs().length > 0) {
				await project.installPackages();
			}
		}
	}
}
