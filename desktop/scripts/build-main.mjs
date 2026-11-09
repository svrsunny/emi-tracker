// Bundles the Electron main and preload processes with esbuild and copies the sql.js WASM.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: false, external: ['electron'], logLevel: 'info' };

await build({ ...common, entryPoints: [path.join(root, 'src/main/main.ts')], outfile: path.join(root, 'dist/main/main.js') });
await build({ ...common, entryPoints: [path.join(root, 'src/preload/preload.ts')], outfile: path.join(root, 'dist/preload/preload.js') });
fs.copyFileSync(path.join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), path.join(root, 'dist/main/sql-wasm.wasm'));
console.log('main + preload built');
