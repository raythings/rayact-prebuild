import fs from 'node:fs';
import path from 'node:path';
import { RAYACT_ASSETS_DIR } from './constants.js';
import { mergeNativeModules, resolveRayactPlugins } from './plugins.js';
import {
  copyDirRecursive,
  copyMatchingFiles,
  resolvePrebuiltAndroidDir,
  resolvePackageDir,
  resolveTemplateAndroidDir,
  resolveTemplateIosDir
} from './resolvePrebuilt.js';
import type { RayactNativeModuleEntry } from './types.js';

export interface PrebuildOptions {
  projectRoot: string;
  devClient?: boolean;
  configNativeModules?: RayactNativeModuleEntry[];
  android?: {
    projectDir?: string;
    packageName?: string;
    appName?: string;
  };
  ios?: {
    projectDir?: string;
    bundleId?: string;
  };
  /** When false, refuse to overwrite existing android/ios trees (monorepo safety). */
  force?: boolean;
}

function replaceInFile(filePath: string, replacements: Record<string, string>): void {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [from, to] of Object.entries(replacements)) {
    content = content.split(from).join(to);
  }
  fs.writeFileSync(filePath, content);
}

function copyAndroidPrebuilts(
  projectRoot: string,
  androidDir: string,
  plugins: ReturnType<typeof resolveRayactPlugins>
): void {
  const prebuiltDir = resolvePrebuiltAndroidDir(projectRoot);
  if (!prebuiltDir) {
    throw new Error(
      'Missing @rayact/prebuilt-android-arm64. Run npm install or build prebuilts from the monorepo.'
    );
  }

  const jniDest = path.join(androidDir, 'app/src/main/jniLibs/arm64-v8a');
  fs.mkdirSync(jniDest, { recursive: true });

  const jniSrc = path.join(prebuiltDir, 'jni/arm64-v8a');
  copyMatchingFiles(jniSrc, jniDest, /\.so$/);

  for (const plugin of plugins) {
    const pluginLib = path.join(plugin.packageDir, 'android/arm64-v8a');
    copyMatchingFiles(pluginLib, jniDest, /\.so$/);
  }
}

function writeNativeModulesManifest(
  projectRoot: string,
  modules: RayactNativeModuleEntry[]
): void {
  const assetsDir = path.join(projectRoot, RAYACT_ASSETS_DIR, 'runtime');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(
    path.join(assetsDir, 'native-modules.json'),
    JSON.stringify({ nativeModules: modules }, null, 2) + '\n'
  );
}

export function runPrebuild(options: PrebuildOptions): {
  androidDir: string | null;
  iosDir: string | null;
  nativeModules: RayactNativeModuleEntry[];
} {
  const { projectRoot } = options;
  const plugins = resolveRayactPlugins(projectRoot);
  const nativeModules = mergeNativeModules(options.configNativeModules, plugins);

  const androidRel = options.android?.projectDir ?? 'android';
  const iosRel = options.ios?.projectDir ?? 'ios';
  const androidDir = path.resolve(projectRoot, androidRel);
  const iosDir = path.resolve(projectRoot, iosRel);

  const isMonorepoEngineAndroid = (dir: string) =>
    fs.existsSync(path.join(dir, 'app/src/main/cpp/CMakeLists.txt'));

  if (fs.existsSync(androidDir) && isMonorepoEngineAndroid(androidDir) && !options.force) {
    throw new Error(
      `Refusing to overwrite engine Android project at ${androidDir}. ` +
        'Use android.projectDir under your app root (e.g. "./android") or pass force: true.'
    );
  }

  const isMonorepoEngineIos = (dir: string) => {
    const yml = path.join(dir, 'project.yml');
    if (!fs.existsSync(yml)) return false;
    try {
      return fs.readFileSync(yml, 'utf8').includes('../../native/desktop');
    } catch {
      return false;
    }
  };

  if (fs.existsSync(iosDir) && isMonorepoEngineIos(iosDir) && !options.force) {
    throw new Error(
      `Refusing to overwrite engine iOS project at ${iosDir}. ` +
        'Use ios.projectDir under your app root (e.g. "./ios") or pass force: true.'
    );
  }

  const templateAndroid = resolveTemplateAndroidDir(projectRoot);
  if (!templateAndroid) {
    throw new Error('Missing @rayact/template-android package.');
  }

  if (fs.existsSync(androidDir)) {
    if (!options.force && fs.existsSync(path.join(androidDir, 'gradlew'))) {
      console.warn(`Updating prebuilt jniLibs in existing Android project: ${androidDir}`);
      copyAndroidPrebuilts(projectRoot, androidDir, plugins);
      writeNativeModulesManifest(projectRoot, nativeModules);
      return { androidDir, iosDir: null, nativeModules };
    }
    fs.rmSync(androidDir, { recursive: true, force: true });
  }
  copyDirRecursive(templateAndroid, androidDir);

  const packageName = options.android?.packageName ?? 'com.rayact.app';
  const appName = options.android?.appName ?? 'Rayact';
  const devClient = options.devClient !== false;

  replaceInFile(path.join(androidDir, 'app/build.gradle'), {
    "applicationId 'com.rayact.app'": `applicationId '${packageName}'`
  });
  if (!devClient) {
    replaceInFile(path.join(androidDir, 'app/build.gradle'), {
      'buildConfigField "boolean", "RAYACT_DEV_CLIENT", "true"':
        'buildConfigField "boolean", "RAYACT_DEV_CLIENT", "false"'
    });
  }
  replaceInFile(path.join(androidDir, 'app/src/main/AndroidManifest.xml'), {
    'android:label="Rayact"': `android:label="${appName}"`
  });

  copyAndroidPrebuilts(projectRoot, androidDir, plugins);

  const templateIos = resolveTemplateIosDir(projectRoot);
  if (templateIos) {
    if (fs.existsSync(iosDir)) {
      fs.rmSync(iosDir, { recursive: true, force: true });
    }
    copyDirRecursive(templateIos, iosDir);
    const bundleId = options.ios?.bundleId ?? packageName;
    replaceInFile(path.join(iosDir, 'project.yml'), {
      'com.rayact.ios': bundleId,
      'RayactIOS': appName.replace(/\s+/g, '')
    });
    const iosPrebuilt = resolvePackageDir(projectRoot, '@rayact/prebuilt-ios-arm64');
    if (iosPrebuilt) {
      const fwSrc = path.join(iosPrebuilt, 'RayactEngine.xcframework');
      if (fs.existsSync(fwSrc)) {
        copyDirRecursive(fwSrc, path.join(iosDir, 'Frameworks/RayactEngine.xcframework'));
      }
    }
  }

  writeNativeModulesManifest(projectRoot, nativeModules);
  fs.mkdirSync(path.join(projectRoot, RAYACT_ASSETS_DIR), { recursive: true });

  return { androidDir, iosDir: templateIos ? iosDir : null, nativeModules };
}
