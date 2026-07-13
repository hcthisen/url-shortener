// Copies the self-hosted Scalar API Reference browser bundle into the built
// public assets so /docs works without any CDN (air-gapped friendly).
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const src = join('node_modules', '@scalar', 'api-reference', 'dist', 'browser', 'standalone.js');
const destDir = 'dist/public/vendor';
mkdirSync(destDir, { recursive: true });
copyFileSync(src, join(destDir, 'scalar.js'));
console.log('Copied Scalar bundle to', join(destDir, 'scalar.js'));
