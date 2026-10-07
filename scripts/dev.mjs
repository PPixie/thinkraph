import { spawn } from 'node:child_process';
try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const children = [spawn(process.execPath, ['--watch', '--import', 'tsx', 'server/index.ts'], { stdio: 'inherit' }), spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' })];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; process.exitCode = code; for (const child of children) child.kill('SIGTERM'); setTimeout(() => process.exit(code), 1500).unref(); }
for (const child of children) { child.on('error', error => { console.error(error.message); stop(1); }); child.on('exit', code => stop(code || 0)); }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
