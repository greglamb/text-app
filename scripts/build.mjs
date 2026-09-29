// Builds the deployable web app into dist/: copies only the files the page
// uses (the icon font folder alone is ~400 MB in third_party) and generates a
// service worker that precaches them for offline use.

import {access, cp, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateSW} from 'workbox-build';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const CODEMIRROR_BUNDLE = 'third_party/codemirror.next/codemirror.next.bin.js';

/** Files and folders copied to dist/, relative to the repo root. */
const FILES = [
  'index.html',
  'manifest.webmanifest',
  'LICENSE.md',
  'css',
  'js',
  'icon',
  '_locales',
  CODEMIRROR_BUNDLE,
  'third_party/jquery/jquery-1.8.3.min.js',
  'third_party/jquery/LICENSE',
  'third_party/material-components-web/material-components-web.min.css',
  'third_party/material-components-web/material-components-web.min.js',
  'third_party/material-components-web/LICENSE',
  'third_party/material-design-icons/LICENSE',
  'third_party/material-design-icons/iconfont/material-icons.css',
  'third_party/material-design-icons/iconfont/MaterialIcons-Regular.woff2',
  'third_party/material-design-icons/iconfont/MaterialIcons-Regular.woff',
  'third_party/material-design-icons/iconfont/MaterialIcons-Regular.ttf',
];

async function main() {
  try {
    await access(path.join(root, CODEMIRROR_BUNDLE));
  } catch {
    console.error(`Missing ${CODEMIRROR_BUNDLE}. Run "npm run build:codemirror" first.`);
    process.exit(1);
  }

  await rm(dist, {recursive: true, force: true});
  for (const file of FILES) {
    await cp(path.join(root, file), path.join(dist, file), {recursive: true});
  }

  const {count, size, warnings} = await generateSW({
    globDirectory: dist,
    globPatterns: ['**/*'],
    globIgnores: ['LICENSE*', '**/LICENSE*'],
    swDest: path.join(dist, 'sw.js'),
    // Every navigation inside the app's scope loads the same page, including
    // new windows opened with ?new-window=1.
    navigateFallback: 'index.html',
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    // A new version takes over once every app window has been closed, so a
    // window with unsaved work never has its code swapped underneath it.
    skipWaiting: false,
    inlineWorkboxRuntime: true,
    sourcemap: false,
  });
  for (const warning of warnings) console.warn(warning);
  console.log(`Built dist/ and precached ${count} files (${(size / 1024).toFixed(0)} KiB).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
