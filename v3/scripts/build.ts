/**
 * Marblo Electron Builder Script
 *
 * Usage:
 *   npx ts-node scripts/build.ts [--mac] [--win] [--linux] [--all]
 *
 * Requires: npm run build:electron to be run first (vite + tsc)
 */

import * as builder from 'electron-builder';
import path from 'path';

type Platform = 'mac' | 'win' | 'linux';

function parseArgs(): Platform[] {
  const args = process.argv.slice(2);

  if (args.includes('--all')) {
    return ['mac', 'win', 'linux'];
  }

  const platforms: Platform[] = [];
  if (args.includes('--mac')) platforms.push('mac');
  if (args.includes('--win')) platforms.push('win');
  if (args.includes('--linux')) platforms.push('linux');

  // Default to current platform
  if (platforms.length === 0) {
    const current = process.platform;
    if (current === 'darwin') platforms.push('mac');
    else if (current === 'win32') platforms.push('win');
    else platforms.push('linux');
  }

  return platforms;
}

function getPlatformTargets(platforms: Platform[]): builder.Platform[] {
  const targets: builder.Platform[] = [];
  for (const p of platforms) {
    switch (p) {
      case 'mac':
        targets.push(builder.Platform.MAC);
        break;
      case 'win':
        targets.push(builder.Platform.WINDOWS);
        break;
      case 'linux':
        targets.push(builder.Platform.LINUX);
        break;
    }
  }
  return targets;
}

async function main() {
  const platforms = parseArgs();
  console.log(`Building Marblo for: ${platforms.join(', ')}`);

  const projectDir = path.resolve(__dirname, '..');
  const targets = getPlatformTargets(platforms);

  const targetMap = new Map<builder.Platform, Map<builder.Arch, string[]>>();
  for (const target of targets) {
    targetMap.set(target, new Map());
  }

  try {
    const result = await builder.build({
      targets: targetMap,
      projectDir,
      config: {
        extends: 'electron-builder.yml',
      },
    });

    console.log('\nBuild completed successfully!');
    console.log('Output files:');
    for (const file of result) {
      console.log(`  ${file}`);
    }
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

main();
