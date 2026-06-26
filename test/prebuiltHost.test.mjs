import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

import {
  hostDesktopKey,
  desktopBinName,
  prebuiltCacheDir,
  prebuiltTarballName,
  checkPrebuiltAbi,
  resolveDesktopBinPrebuilt,
  downloadPrebuilt,
  RAYACT_ENGINE_VERSION,
  RAYACT_MODULE_ABI_VERSION
} from '../dist/index.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rayact-pb-'));
}

function writeBin(dir) {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  const bin = path.join(dir, 'bin', desktopBinName());
  fs.writeFileSync(bin, '#!/bin/sh\necho rayact_desktop\n');
  fs.chmodSync(bin, 0o755);
  return bin;
}

function writeManifest(dir, over = {}) {
  const m = {
    engineVersion: RAYACT_ENGINE_VERSION,
    moduleAbiVersion: RAYACT_MODULE_ABI_VERSION,
    platform: 'test',
    arch: 'test',
    ...over
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
}

test('hostDesktopKey + desktopBinName basics', () => {
  const key = hostDesktopKey();
  // On CI/dev this runs on darwin or linux; key may be null on unsupported hosts.
  assert.ok(key === null || /^(darwin|linux)-/.test(key));
  assert.match(desktopBinName(), /rayact_desktop(\.exe)?$/);
});

test('prebuiltTarballName format', () => {
  assert.equal(prebuiltTarballName('darwin-arm64', '0.0.1'), 'rayact-prebuilt-darwin-arm64-0.0.1.tgz');
});

test('checkPrebuiltAbi: match ok, abi mismatch throws, version skew warns', () => {
  assert.doesNotThrow(() =>
    checkPrebuiltAbi({ engineVersion: RAYACT_ENGINE_VERSION, moduleAbiVersion: RAYACT_MODULE_ABI_VERSION }, 'x')
  );
  assert.throws(
    () => checkPrebuiltAbi({ engineVersion: RAYACT_ENGINE_VERSION, moduleAbiVersion: 999 }, 'x'),
    /ABI/
  );
  // skew warns but does not throw
  assert.doesNotThrow(() =>
    checkPrebuiltAbi({ engineVersion: '9.9.9', moduleAbiVersion: RAYACT_MODULE_ABI_VERSION }, 'x')
  );
});

test('resolveDesktopBin: env override wins', () => {
  const root = tmp();
  const binDir = tmp();
  const bin = path.join(binDir, desktopBinName());
  fs.writeFileSync(bin, '');
  const prev = process.env.RAYACT_DESKTOP_BIN;
  process.env.RAYACT_DESKTOP_BIN = bin;
  try {
    const r = resolveDesktopBinPrebuilt(root);
    assert.equal(r?.source, 'env');
    assert.equal(r?.bin, bin);
  } finally {
    if (prev === undefined) delete process.env.RAYACT_DESKTOP_BIN;
    else process.env.RAYACT_DESKTOP_BIN = prev;
  }
});

test('resolveDesktopBin: finds installed prebuilt package', (t) => {
  const key = hostDesktopKey();
  if (!key) return t.skip('unsupported host');
  const root = tmp();
  const pkgDir = path.join(root, 'node_modules', '@rayact', `prebuilt-${key}`);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: `@rayact/prebuilt-${key}`, version: RAYACT_ENGINE_VERSION }));
  writeBin(pkgDir);
  writeManifest(pkgDir);
  const prev = process.env.RAYACT_DESKTOP_BIN;
  delete process.env.RAYACT_DESKTOP_BIN;
  try {
    const r = resolveDesktopBinPrebuilt(root);
    assert.equal(r?.source, 'package');
    // realpath: macOS canonicalizes /var -> /private/var, so compare resolved paths.
    assert.equal(fs.realpathSync(r.bin), fs.realpathSync(path.join(pkgDir, 'bin', desktopBinName())));
  } finally {
    if (prev !== undefined) process.env.RAYACT_DESKTOP_BIN = prev;
  }
});

test('resolveDesktopBin: falls back to cache', (t) => {
  const key = hostDesktopKey();
  if (!key) return t.skip('unsupported host');
  const root = tmp();
  const cacheRoot = tmp();
  const prevCache = process.env.RAYACT_CACHE_DIR;
  const prevBin = process.env.RAYACT_DESKTOP_BIN;
  process.env.RAYACT_CACHE_DIR = cacheRoot;
  delete process.env.RAYACT_DESKTOP_BIN;
  try {
    const cacheDir = prebuiltCacheDir(RAYACT_ENGINE_VERSION, key);
    writeBin(cacheDir);
    writeManifest(cacheDir);
    const r = resolveDesktopBinPrebuilt(root);
    assert.equal(r?.source, 'cache');
  } finally {
    if (prevCache === undefined) delete process.env.RAYACT_CACHE_DIR; else process.env.RAYACT_CACHE_DIR = prevCache;
    if (prevBin !== undefined) process.env.RAYACT_DESKTOP_BIN = prevBin;
  }
});

test('downloadPrebuilt: fetch + sha256 verify + strip-components extract', async (t) => {
  const key = hostDesktopKey() ?? 'darwin-arm64';
  // Build a fake npm-pack tarball: package/{bin/<bin>,manifest.json}
  const stage = tmp();
  const pkg = path.join(stage, 'package');
  writeBin(pkg);
  writeManifest(pkg);
  const tarName = prebuiltTarballName(key, RAYACT_ENGINE_VERSION);
  const tarPath = path.join(stage, tarName);
  const tar = spawnSync('tar', ['-czf', tarPath, '-C', stage, 'package']);
  if (tar.status !== 0) return t.skip('tar unavailable');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(tarPath)).digest('hex');
  fs.writeFileSync(path.join(stage, 'SHA256SUMS'), `${sha}  ${tarName}\n`);

  const server = http.createServer((req, res) => {
    const name = path.basename(req.url);
    const file = path.join(stage, name);
    if (fs.existsSync(file)) {
      res.writeHead(200);
      res.end(fs.readFileSync(file));
    } else {
      res.writeHead(404);
      res.end('nope');
    }
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const cacheRoot = tmp();
  const prevBase = process.env.RAYACT_PREBUILT_BASE_URL;
  const prevCache = process.env.RAYACT_CACHE_DIR;
  process.env.RAYACT_PREBUILT_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.RAYACT_CACHE_DIR = cacheRoot;
  try {
    const dir = await downloadPrebuilt(key, RAYACT_ENGINE_VERSION);
    assert.ok(fs.existsSync(path.join(dir, 'bin', desktopBinName())), 'bin extracted (strip-components)');
    assert.ok(fs.existsSync(path.join(dir, 'manifest.json')), 'manifest extracted');
  } finally {
    if (prevBase === undefined) delete process.env.RAYACT_PREBUILT_BASE_URL; else process.env.RAYACT_PREBUILT_BASE_URL = prevBase;
    if (prevCache === undefined) delete process.env.RAYACT_CACHE_DIR; else process.env.RAYACT_CACHE_DIR = prevCache;
    server.close();
  }
});

test('downloadPrebuilt: sha mismatch throws', async (t) => {
  const key = hostDesktopKey() ?? 'darwin-arm64';
  const stage = tmp();
  const pkg = path.join(stage, 'package');
  writeBin(pkg);
  writeManifest(pkg);
  const tarName = prebuiltTarballName(key, RAYACT_ENGINE_VERSION);
  const tar = spawnSync('tar', ['-czf', path.join(stage, tarName), '-C', stage, 'package']);
  if (tar.status !== 0) return t.skip('tar unavailable');
  fs.writeFileSync(path.join(stage, 'SHA256SUMS'), `deadbeef  ${tarName}\n`);

  const server = http.createServer((req, res) => {
    const file = path.join(stage, path.basename(req.url));
    if (fs.existsSync(file)) { res.writeHead(200); res.end(fs.readFileSync(file)); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const prevBase = process.env.RAYACT_PREBUILT_BASE_URL;
  const prevCache = process.env.RAYACT_CACHE_DIR;
  process.env.RAYACT_PREBUILT_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.RAYACT_CACHE_DIR = tmp();
  try {
    await assert.rejects(() => downloadPrebuilt(key, RAYACT_ENGINE_VERSION), /SHA256 mismatch/);
  } finally {
    if (prevBase === undefined) delete process.env.RAYACT_PREBUILT_BASE_URL; else process.env.RAYACT_PREBUILT_BASE_URL = prevBase;
    if (prevCache === undefined) delete process.env.RAYACT_CACHE_DIR; else process.env.RAYACT_CACHE_DIR = prevCache;
    server.close();
  }
});
