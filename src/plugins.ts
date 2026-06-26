import fs from 'node:fs';
import path from 'node:path';
import type { RayactNativeModuleEntry, RayactPluginManifest, ResolvedPlugin } from './types.js';

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function pluginFromPackageJson(
  pkgDir: string,
  pkgName: string
): ResolvedPlugin | null {
  const pkg = readJson<{ name?: string; rayact?: RayactPluginManifest }>(
    path.join(pkgDir, 'package.json')
  );
  if (!pkg?.rayact?.name || !pkg.rayact.lib) return null;
  const manifestPath = path.join(pkgDir, 'rayact.plugin.json');
  return {
    name: pkg.rayact.name,
    lib: pkg.rayact.lib,
    jsPackage: pkg.name ?? pkgName,
    packageDir: pkgDir,
    manifestPath: fs.existsSync(manifestPath) ? manifestPath : undefined
  };
}

function scanScope(scopeDir: string, scopeName: string): ResolvedPlugin[] {
  if (!fs.existsSync(scopeDir)) return [];
  const out: ResolvedPlugin[] = [];
  for (const entry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.join(scopeDir, entry.name);
    const pkgName = `${scopeName}/${entry.name}`;
    const plugin = pluginFromPackageJson(pkgDir, pkgName);
    if (plugin) out.push(plugin);
  }
  return out;
}

export function resolveRayactPlugins(projectRoot: string): ResolvedPlugin[] {
  const nodeModules = path.join(projectRoot, 'node_modules');
  const byName = new Map<string, ResolvedPlugin>();

  for (const plugin of scanScope(path.join(nodeModules, '@rayact'), '@rayact')) {
    byName.set(plugin.name, plugin);
  }

  let dir = projectRoot;
  for (let i = 0; i < 8; i++) {
    const monoPlugins = path.join(dir, 'packages');
    if (fs.existsSync(monoPlugins)) {
      for (const entry of fs.readdirSync(monoPlugins, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pkgDir = path.join(monoPlugins, entry.name);
        const plugin = pluginFromPackageJson(pkgDir, `@rayact/${entry.name.replace(/^rayact-/, '')}`);
        if (plugin) byName.set(plugin.name, plugin);
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return [...byName.values()];
}

export function mergeNativeModules(
  configModules: RayactNativeModuleEntry[] | undefined,
  plugins: ResolvedPlugin[]
): RayactNativeModuleEntry[] {
  const byName = new Map<string, RayactNativeModuleEntry>();

  for (const p of plugins) {
    byName.set(p.name, { name: p.name, lib: p.lib, jsPackage: p.jsPackage });
  }
  for (const m of configModules ?? []) {
    byName.set(m.name, { ...byName.get(m.name), ...m });
  }

  return [...byName.values()];
}

export function readPluginManifest(plugin: ResolvedPlugin): RayactPluginManifest | null {
  if (!plugin.manifestPath) return null;
  return readJson<RayactPluginManifest>(plugin.manifestPath);
}
