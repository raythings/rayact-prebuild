export {
  RAYACT_ENGINE_VERSION,
  RAYACT_MODULE_ABI_VERSION,
  RAYACT_NDK_VERSION,
  RAYACT_REPO,
  PREBUILT_PACKAGES,
  RAYACT_ASSETS_DIR
} from './constants.js';

export {
  hostDesktopKey,
  desktopBinName,
  prebuiltCacheDir,
  prebuiltTarballName,
  checkPrebuiltAbi,
  resolveDesktopBin as resolveDesktopBinPrebuilt,
  downloadPrebuilt,
  ensureDesktopPrebuilt
} from './prebuiltHost.js';
export type { DesktopHostKey, ResolvedDesktop } from './prebuiltHost.js';

export type {
  RayactPluginManifest,
  RayactNativeModuleEntry,
  PrebuiltManifest,
  ResolvedPlugin
} from './types.js';

export {
  resolveRayactPlugins,
  mergeNativeModules,
  readPluginManifest
} from './plugins.js';

export {
  resolvePackageDir,
  readPrebuiltManifest,
  resolvePrebuiltAndroidDir,
  resolvePrebuiltDarwinDir,
  resolveTemplateAndroidDir,
  resolveTemplateIosDir,
  copyDirRecursive,
  copyMatchingFiles
} from './resolvePrebuilt.js';

export { runPrebuild, type PrebuildOptions } from './prebuild.js';
