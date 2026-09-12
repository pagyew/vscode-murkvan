import type { Status } from './statusBar';

export interface ProjectSnapshot {
	/** How this project is identified in a multi-project "changes" list. */
	label: string;
	status: Status;
	pendingPackages: string[];
}

export interface AggregateStatus {
	status: Status;
	/** Populated only when `status` is `'changes'`. */
	packages: string[];
}

/** Most attention-grabbing status wins when more than one project is active at once. */
const STATUS_PRIORITY: readonly Status[] = ['error', 'syncing', 'searching', 'changes', 'idle'];

/**
 * Reduces every project's own status into the one shared status bar entry.
 *
 * The most attention-grabbing status across all projects wins outright; a
 * `'changes'` result lists every pending package from every project still
 * showing changes, prefixed by project label once there is more than one
 * project to tell apart.
 */
export function aggregateStatus(projects: readonly ProjectSnapshot[]): AggregateStatus {
	if (projects.length === 0) {
		return { status: 'error', packages: [] };
	}

	const status = STATUS_PRIORITY.find(candidate => projects.some(project => project.status === candidate)) ?? 'idle';

	if (status !== 'changes') {
		return { status, packages: [] };
	}

	const multipleProjects = projects.length > 1;
	const packages = projects
		.filter(project => project.status === 'changes')
		.flatMap(project => project.pendingPackages.map(pkg => multipleProjects ? `${project.label}: ${pkg}` : pkg));

	return { status: 'changes', packages };
}
