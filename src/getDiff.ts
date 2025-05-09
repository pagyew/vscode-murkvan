import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import {PackageJson} from 'type-fest';

export function getDiff(pathToProject: string) {
    const projectPackageJsonPath = path.join(pathToProject, 'package.json');
    const projectNodeModulesPath = path.join(pathToProject, 'node_modules');

    if (!fs.existsSync(projectPackageJsonPath)) {
        console.error('Error: package.json not found');
        return [];
    }

    if (!fs.existsSync(projectNodeModulesPath)) {
        console.error('Error: node_modules not found');
        return [];
    }

    const projectPackageJson: PackageJson = JSON.parse(fs.readFileSync(projectPackageJsonPath, 'utf-8'));
    const declaredDependencies = {
        ...projectPackageJson.dependencies
    };

    const installedDependencies: Record<string, PackageJson['version']> = {};
    const dependencyTree = new Set();

    // Read installed packages in node_modules
    fs.readdirSync(projectNodeModulesPath).forEach(pkg => {
        if (pkg.startsWith('@')) {
            // Handle scoped packages
            const scopedPath = path.join(projectNodeModulesPath, pkg);
            fs.readdirSync(scopedPath).forEach(scopedPkg => {
                const packageJsonPath = path.join(scopedPath, scopedPkg, 'package.json');
                if (fs.existsSync(packageJsonPath)) {
                    const packageJson: PackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
                    installedDependencies[`${pkg}/${scopedPkg}`] = packageJson.version;

                    // Add dependencies of this package to the dependency tree
                    if (packageJson.dependencies) {
                        Object.keys(packageJson.dependencies).forEach(dep => dependencyTree.add(dep));
                    }
                }
            });
        } else {
            const packageJsonPath = path.join(projectNodeModulesPath, pkg, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
                const packageJson: PackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
                installedDependencies[pkg] = packageJson.version;

                // Add dependencies of this package to the dependency tree
                if (packageJson.dependencies) {
                    Object.keys(packageJson.dependencies).forEach(dep => dependencyTree.add(dep));
                }
            }
        }
    });

    const differences = [];

    const allPackages = new Set([...Object.keys(declaredDependencies), ...Object.keys(installedDependencies)]);

    for (const pkg of allPackages) {
        if (dependencyTree.has(pkg)) {
            // Skip packages that are dependencies of other packages
            continue;
        }

        const declaredVersion = declaredDependencies[pkg] || 'not declared';
        const installedVersion = installedDependencies[pkg] || 'not installed';

        if (declaredVersion !== installedVersion) {
            let diffType = 'unknown';
            let changeDirection = 'unknown';

            if (declaredVersion === 'not declared') {
                diffType = 'extra';
            } else if (installedVersion === 'not installed') {
                diffType = 'missing';
            } else {
                diffType = semver.diff(declaredVersion, installedVersion) || 'unknown';
                changeDirection = semver.gt(declaredVersion, installedVersion) ? 'downgrade' : 'upgrade';
            }

            differences.push({
                packageName: pkg,
                declaredVersion,
                installedVersion,
                diffType,
                changeDirection
            });
        }
    }

    return differences;
}
