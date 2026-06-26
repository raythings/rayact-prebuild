export const RAYACT_ENGINE_VERSION = '0.0.1';
export const RAYACT_MODULE_ABI_VERSION = 1;
export const RAYACT_NDK_VERSION = '27.2.12479018';

/** GitHub repo (owner/name) prebuilt tarballs are released from. */
export const RAYACT_REPO = 'raythings/rayact';

export const PREBUILT_PACKAGES = {
  'android-arm64': '@rayact/prebuilt-android-arm64',
  'ios-arm64': '@rayact/prebuilt-ios-arm64',
  'darwin-arm64': '@rayact/prebuilt-darwin-arm64',
  'darwin-x64': '@rayact/prebuilt-darwin-x64',
  'linux-x64': '@rayact/prebuilt-linux-x64'
} as const;

export const RAYACT_ASSETS_DIR = 'rayact-assets';
