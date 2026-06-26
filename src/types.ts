export interface RayactPluginManifest {
  name: string;
  lib: string;
  platforms?: string[];
}

export interface RayactNativeModuleEntry {
  name: string;
  lib: string;
  jsPackage?: string;
}

export interface PrebuiltManifest {
  engineVersion: string;
  moduleAbiVersion: number;
  ndkVersion?: string;
  platform: string;
  arch: string;
  builtAt?: string;
}

export interface ResolvedPlugin {
  name: string;
  lib: string;
  jsPackage: string;
  packageDir: string;
  manifestPath?: string;
}
