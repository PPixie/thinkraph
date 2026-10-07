import { config, loadConfig } from './config.js';
import { Repository } from './storage/repository.js';
import { buildApp } from './app.js';

const runtimeConfig = await loadConfig(config);
const repository = await new Repository(runtimeConfig).open();
const app = await buildApp(repository, runtimeConfig);
try { await app.listen({ host: '127.0.0.1', port: runtimeConfig.port }); console.log(`Thinkraph: http://127.0.0.1:${runtimeConfig.port}`); }
catch (error) { await repository.close(); throw error; }
let closing = false;
for (const event of ['SIGINT', 'SIGTERM'] as const) process.on(event, async () => { if (closing) return; closing = true; await app.close(); await repository.close(); process.exit(0); });
