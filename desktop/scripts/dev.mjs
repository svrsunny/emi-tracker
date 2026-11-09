// Development: starts the Vite dev server, builds main/preload, then launches Electron.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts') });
await server.listen(5173);
const url = 'http://localhost:5173/';
await import('./build-main.mjs');
const electron = (await import('electron')).default;
const child = spawn(electron, ['.'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
