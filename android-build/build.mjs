import {
  TwaManifest, TwaGenerator, AndroidSdkTools,
  JdkHelper, GradleWrapper, Config, KeyTool, JarSigner
} from '@bubblewrap/core';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const JAVA_HOME  = '/Users/ky/Library/Java/JavaVirtualMachines/openjdk-20.0.2';
const ANDROID_HOME = '/Users/ky/Library/Android/sdk';
const KS_PATH    = path.join(__dirname, 'snapmeal.keystore');
const KS_PASS    = 'Snapmeal2026!';
const KEY_ALIAS  = 'snapmeal';
const KEY_PASS   = 'Snapmeal2026!';

const config         = new Config(JAVA_HOME, ANDROID_HOME);
const jdkHelper      = new JdkHelper(process, config);
const androidSdk     = await AndroidSdkTools.create(process, config, jdkHelper);

console.log('✓ SDK ready');

const twaManifest = await TwaManifest.fromFile(path.join(__dirname, 'twa-manifest.json'));
console.log('✓ Manifest loaded:', twaManifest.packageId);

// Generate Gradle project
const generator = new TwaGenerator();
await generator.createTwaProject(__dirname, twaManifest);
console.log('✓ TWA project generated');

// Build
const gradle = new GradleWrapper(process, androidSdk);
await gradle.assembleRelease();
console.log('✓ APK built');

await gradle.bundleRelease();
console.log('✓ AAB built');

// Sign AAB
const unsignedAab = path.join(__dirname, 'app/build/outputs/bundle/release/app-release.aab');
const signedAab   = path.join(__dirname, 'snapmeal-release.aab');
const jarSigner   = new JarSigner(jdkHelper);
await jarSigner.sign(
  { keyStore: KS_PATH, storePass: KS_PASS, alias: KEY_ALIAS, keyPass: KEY_PASS },
  unsignedAab,
  signedAab
);
console.log('✓ Signed AAB:', signedAab);
