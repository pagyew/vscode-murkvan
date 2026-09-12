import assert from 'node:assert';
import { aggregateStatus, type ProjectSnapshot } from '../../aggregateStatus';

function project(overrides: Partial<ProjectSnapshot>): ProjectSnapshot {
	return { label: 'project', status: 'idle', pendingPackages: [], ...overrides };
}

suite('aggregateStatus', () => {
	test('reports "error" when no project was found at all', () => {
		assert.deepStrictEqual(aggregateStatus([]), { status: 'error', packages: [] });
	});

	test('mirrors a single project unchanged', () => {
		assert.deepStrictEqual(
			aggregateStatus([project({ status: 'changes', pendingPackages: ['lodash@4.18.0'] })]),
			{ status: 'changes', packages: ['lodash@4.18.0'] },
		);
	});

	test('does not prefix packages with the project label when there is only one project', () => {
		const result = aggregateStatus([project({ label: 'my-app', status: 'changes', pendingPackages: ['react@19.0.0'] })]);

		assert.deepStrictEqual(result.packages, ['react@19.0.0']);
	});

	// Regression: an in-progress sync or a genuine error anywhere must not be
	// hidden behind another project quietly reporting "in sync".
	test('an error in any project outranks everything else', () => {
		const result = aggregateStatus([
			project({ label: 'a', status: 'idle' }),
			project({ label: 'b', status: 'error' }),
			project({ label: 'c', status: 'changes', pendingPackages: ['x@1.0.0'] }),
		]);

		assert.strictEqual(result.status, 'error');
	});

	test('syncing outranks changes and idle, but not error', () => {
		assert.strictEqual(
			aggregateStatus([project({ status: 'syncing' }), project({ status: 'changes', pendingPackages: ['x@1.0.0'] })]).status,
			'syncing',
		);
		assert.strictEqual(
			aggregateStatus([project({ status: 'syncing' }), project({ status: 'error' })]).status,
			'error',
		);
	});

	test('is idle only when every project is idle', () => {
		assert.strictEqual(aggregateStatus([project({ status: 'idle' }), project({ status: 'idle' })]).status, 'idle');
	});

	test('prefixes each pending package with its project label once more than one project exists', () => {
		const result = aggregateStatus([
			project({ label: 'frontend', status: 'changes', pendingPackages: ['react@19.0.0'] }),
			project({ label: 'backend', status: 'idle' }),
			project({ label: 'tools', status: 'changes', pendingPackages: ['lodash@4.18.0', 'semver@7.7.0'] }),
		]);

		assert.deepStrictEqual(result, {
			status: 'changes',
			packages: ['frontend: react@19.0.0', 'tools: lodash@4.18.0', 'tools: semver@7.7.0'],
		});
	});

	test('leaves projects that are not in "changes" out of the package list', () => {
		const result = aggregateStatus([
			project({ label: 'a', status: 'changes', pendingPackages: ['a@1.0.0'] }),
			project({ label: 'b', status: 'searching' }),
		]);

		// "searching" outranks "changes", so the aggregate status itself is
		// "searching" — but if it weren't, "b" still has nothing pending to list.
		assert.strictEqual(result.status, 'searching');
	});
});
