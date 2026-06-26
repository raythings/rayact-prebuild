import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PREBUILT_PACKAGES } from './constants.js';
import type { PrebuiltManifest } from './types.js';

const require = createRequire(import.meta.url);

export function resolvePackageDir(projectRoot: string, packageName: string): string | null {
  try {
    const pkgJson = require.resolve(`${packageName}/package.json`, {
      paths: [projectRoot]
    });
    return path.dirname(pkgJson);
  } catch {
    const shortName = packageName.replace('@rayact/', '');
    let dir = projectRoot;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, 'packages', shortName);
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }
}

export function readPrebuiltManifest(packageDir: string): PrebuiltManifest | null {
  const manifestPath = path.join(packageDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PrebuiltManifest;
  } catch {
    return null;
  }
}

export function resolvePrebuiltAndroidDir(projectRoot: string): string | null {
  return resolvePackageDir(projectRoot, PREBUILT_PACKAGES['android-arm64']);
}

export function resolvePrebuiltDarwinDir(projectRoot: string, arch: 'arm64' | 'x64'): string | null {
  const key = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  return resolvePackageDir(projectRoot, PREBUILT_PACKAGES[key]);
}

export function resolveTemplateAndroidDir(projectRoot: string): string | null {
  return resolvePackageDir(projectRoot, '@rayact/template-android');
}

export function resolveTemplateIosDir(projectRoot: string): string | null {
  return resolvePackageDir(projectRoot, '@rayact/template-ios');
}

export function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function copyMatchingFiles(srcDir: string, destDir: string, pattern: RegExp): void {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      copyMatchingFiles(srcPath, path.join(destDir, entry.name), pattern);
    } else if (pattern.test(entry.name)) {
      fs.copyFileSync(srcPath, path.join(destDir, entry.name));
    }
  }
}
