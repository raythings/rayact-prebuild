import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  PREBUILT_PACKAGES,
  RAYACT_ENGINE_VERSION,
  RAYACT_MODULE_ABI_VERSION,
  RAYACT_REPO
} from './constants.js';
import { resolvePackageDir, readPrebuiltManifest } from './resolvePrebuilt.js';
import type { PrebuiltManifest } from './types.js';

export type DesktopHostKey = 'darwin-arm64' | 'darwin-x64' | 'linux-x64';

export interface ResolvedDesktop {
  /** Absolute path to the rayact_desktop host executable. */
  bin: string;
  /** Manifest of the resolved prebuilt (null for a source-tree / env binary). */
  manifest: PrebuiltManifest | null;
  /** Where the binary came from. */
  source: 'configured' | 'env' | 'source' | 'package' | 'cache';
}

/** The desktop prebuilt key for the machine we're running on, or null if unsupported. */
export function hostDesktopKey(): DesktopHostKey | null {
  const arch = process.arch; // 'arm64' | 'x64' | ...
  if (process.platform === 'darwin') {
    if (arch === 'arm64') return 'darwin-arm64';
    if (arch === 'x64') return 'darwin-x64';
  }
  if (process.platform === 'linux' && arch === 'x64') return 'linux-x64';
  return null;
}

export function desktopBinName(): string {
  return process.platform === 'win32' ? 'rayact_desktop.exe' : 'rayact_desktop';
}

/** Root of the per-user prebuilt cache (override with RAYACT_CACHE_DIR). */
export function prebuiltCacheDir(version = RAYACT_ENGINE_VERSION, key?: string): string {
  const base = process.env.RAYACT_CACHE_DIR || path.join(os.homedir(), '.rayact', 'prebuilts');
  return key ? path.join(base, version, key) : path.join(base, version);
}

/**
 * Verify a prebuilt manifest is compatible with this CLI. Throws on mismatch so
 * a stale or wrong-ABI binary fails loudly rather than miscompiling/crashing.
 */
export function checkPrebuiltAbi(manifest: PrebuiltManifest | null, label: string): void {
  if (!manifest) return; // source-tree / env binaries are trusted as-is
  if (manifest.moduleAbiVersion !== RAYACT_MODULE_ABI_VERSION) {
    throw new Error(
      `${label}: module ABI ${manifest.moduleAbiVersion} != expected ${RAYACT_MODULE_ABI_VERSION}. ` +
        `Update @rayact/cli and the prebuilt to matching versions.`
    );
  }
  if (manifest.engineVersion !== RAYACT_ENGINE_VERSION) {
    // Version skew is a warning, not fatal: the ABI gate above is the hard guard.
    console.warn(
      `${label}: engine version ${manifest.engineVersion} != CLI ${RAYACT_ENGINE_VERSION} (ABI matches; proceeding).`
    );
  }
}

function execAt(dir: string): string | null {
  const bin = path.join(dir, 'bin', desktopBinName());
  return fs.existsSync(bin) ? bin : null;
}

/**
 * Locate the rayact_desktop host without downloading. Order:
 *   1. explicit `configured` path or RAYACT_DESKTOP_BIN env
 *   2. source-tree build/bin (maintainer working in the repo)
 *   3. installed @rayact/prebuilt-<host> package in node_modules
 *   4. per-user cache (a previously downloaded prebuilt)
 * Returns null if none are present (call ensureDesktopPrebuilt to fetch).
 */
export function resolveDesktopBin(
  projectRoot: string,
  configured?: string
): ResolvedDesktop | null {
  const explicit = configured || process.env.RAYACT_DESKTOP_BIN;
  if (explicit) {
    const abs = path.isAbsolute(explicit) ? explicit : path.resolve(projectRoot, explicit);
    if (fs.existsSync(abs)) {
      return { bin: abs, manifest: null, source: configured ? 'configured' : 'env' };
    }
  }

  // Source-tree build output (maintainer dev loop).
  for (const rel of ['build/bin', '../../build/bin', '../../../build/bin']) {
    const bin = path.join(path.resolve(projectRoot, rel), desktopBinName());
    if (fs.existsSync(bin)) return { bin, manifest: null, source: 'source' };
  }

  const key = hostDesktopKey();
  if (key) {
    const pkgDir = resolvePackageDir(projectRoot, PREBUILT_PACKAGES[key]);
    if (pkgDir) {
      const bin = execAt(pkgDir);
      if (bin) return { bin, manifest: readPrebuiltManifest(pkgDir), source: 'package' };
    }
    const cacheDir = prebuiltCacheDir(RAYACT_ENGINE_VERSION, key);
    const bin = execAt(cacheDir);
    if (bin) return { bin, manifest: readPrebuiltManifest(cacheDir), source: 'cache' };
  }
  return null;
}

// --- Download ---------------------------------------------------------------

function releaseBaseUrl(version: string): string {
  if (process.env.RAYACT_PREBUILT_BASE_URL) return process.env.RAYACT_PREBUILT_BASE_URL.replace(/\/$/, '');
  const tag = process.env.RAYACT_PREBUILT_TAG || `v${version}`;
  return `https://github.com/${RAYACT_REPO}/releases/download/${tag}`;
}

/** npm-pack tarball name for a prebuilt key, e.g. rayact-prebuilt-darwin-arm64-0.0.1.tgz */
export function prebuiltTarballName(key: string, version = RAYACT_ENGINE_VERSION): string {
  return `rayact-prebuilt-${key}-${version}.tgz`;
}

async function fetchToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}) ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Download + verify + unpack the prebuilt for `key` into the per-user cache,
 * returning the cache dir (layout matches an installed package: bin/, modules/,
 * manifest.json). Verifies the tarball against the release SHA256SUMS when present.
 */
export async function downloadPrebuilt(
  key: string,
  version = RAYACT_ENGINE_VERSION
): Promise<string> {
  const base = releaseBaseUrl(version);
  const tarName = prebuiltTarballName(key, version);
  const dest = prebuiltCacheDir(version, key);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rayact-dl-'));
  const tarPath = path.join(tmp, tarName);
  try {
    console.log(`Downloading prebuilt ${key} from ${base}/${tarName} ...`);
    await fetchToFile(`${base}/${tarName}`, tarPath);

    const sums = await fetchText(`${base}/SHA256SUMS`);
    if (sums) {
      const want = sums.split('\n').map((l) => l.trim()).find((l) => l.endsWith(tarName));
      if (want) {
        const expected = want.split(/\s+/)[0];
        const got = sha256(tarPath);
        if (expected !== got) {
          throw new Error(`SHA256 mismatch for ${tarName}: expected ${expected}, got ${got}`);
        }
      } else {
        console.warn(`warning: ${tarName} not listed in SHA256SUMS — skipping integrity check`);
      }
    } else {
      console.warn('warning: release SHA256SUMS not found — skipping integrity check');
    }

    // npm pack wraps content under package/ — strip it so the cache mirrors an installed package.
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    const res = spawnSync('tar', ['-xzf', tarPath, '-C', dest, '--strip-components=1'], {
      stdio: 'inherit'
    });
    if (res.status !== 0) throw new Error(`tar extract failed for ${tarName}`);

    checkPrebuiltAbi(readPrebuiltManifest(dest), `prebuilt ${key}`);
    return dest;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Resolve the desktop host, downloading it into the cache if not already present.
 * This is what `rayact prebuild` / bytecode compile call so a consumer with no
 * source checkout still gets a working compiler/host.
 */
export async function ensureDesktopPrebuilt(
  projectRoot: string,
  configured?: string
): Promise<ResolvedDesktop> {
  const found = resolveDesktopBin(projectRoot, configured);
  if (found) {
    checkPrebuiltAbi(found.manifest, `prebuilt ${found.source}`);
    return found;
  }
  const key = hostDesktopKey();
  if (!key) {
    throw new Error(
      `No prebuilt desktop host for ${process.platform}/${process.arch}. ` +
        `Build from source or set RAYACT_DESKTOP_BIN.`
    );
  }
  const dir = await downloadPrebuilt(key);
  const bin = execAt(dir);
  if (!bin) throw new Error(`Downloaded prebuilt ${key} is missing ${desktopBinName()}`);
  return { bin, manifest: readPrebuiltManifest(dir), source: 'cache' };
}
