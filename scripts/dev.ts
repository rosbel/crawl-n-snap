import {spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';

function run(cmd: string, args: string[], name: string) {
  const p = spawn(cmd, args, {stdio: 'inherit', env: process.env});
  p.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}`);
      process.exit(code);
    }
  });
  return p;
}

// Ensure UI deps are installed
if (!existsSync('ui/node_modules')) {
  console.log('[dev] Installing UI dependencies...');
  const r = spawnSync('pnpm', ['--dir', 'ui', 'install'], {stdio: 'inherit'});
  if (r.status && r.status !== 0) {
    console.error('[dev] Failed to install UI dependencies.');
    process.exit(r.status ?? 1);
  }
}

// Start API server
const api = run(process.execPath, ['--import', 'tsx', 'src/dev-server.ts'], 'api');

// Start Vite dev server in ui/
const ui = run('pnpm', ['--dir', 'ui', 'dev'], 'ui');

// Graceful shutdown
process.on('SIGINT', () => {
  api.kill('SIGTERM');
  ui.kill('SIGTERM');
  process.exit(0);
});
