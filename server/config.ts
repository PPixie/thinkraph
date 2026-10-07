import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, parse } from '../shared/schemas.js';
import { atomicJson, missing, readJson } from './storage/files.js';

// Source and compiled trees both resolve the project root, never the launch cwd.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(moduleDir, moduleDir.includes(`${path.sep}dist-server${path.sep}`) ? '../..' : '..');
try { process.loadEnvFile(path.join(projectRoot, '.env')); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
const positive = (value: string | undefined, fallback: number) => { const parsed = Number(value || fallback); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('环境变量中的数字必须是正整数'); return parsed; };
if (process.env.THINKRAPH_DATA_DIR && !path.isAbsolute(process.env.THINKRAPH_DATA_DIR)) throw new Error('THINKRAPH_DATA_DIR 必须为绝对路径');

const envAi = { baseUrl: process.env.THINKRAPH_AI_BASE_URL || '', apiKey: process.env.THINKRAPH_AI_API_KEY || '', model: process.env.THINKRAPH_AI_MODEL || '', timeoutMs: positive(process.env.THINKRAPH_AI_TIMEOUT_MS, 60000) };
const aiFields = {
  baseUrl: z.string().max(4000),
  apiKey: z.string().max(10000).optional(),
  model: z.string().max(500),
  timeoutMs: z.number().int().min(1000).max(600000)
};
const localConfigSchema = z.object({ schemaVersion: z.literal(1), ai: z.object(aiFields).partial().strict() }).strict();
const configPackageSchema = z.object({
  format: z.literal('thinkraph.config'), formatVersion: z.literal(1), exportId: z.string().uuid(), exportedAt: z.string().datetime(),
  config: z.object({ ai: z.object(aiFields).strict() }).strict(), secretsOmitted: z.array(z.literal('ai.apiKey')).default([])
}).strict();
const configImportSchema = z.union([configPackageSchema, localConfigSchema]);

export type AiConfig = { baseUrl: string; apiKey: string; model: string; timeoutMs: number };
export type AppConfig = {
  dataDir: string; port: number; graphMaxBytes: number; spaceMaxBytes: number; maxGraphs: number; origins: string[];
  ai: AiConfig; aiSource: 'local' | 'env' | 'default';
};
type ConfigImport = z.infer<typeof configImportSchema>;
const hasEnvAi = Boolean(process.env.THINKRAPH_AI_BASE_URL || process.env.THINKRAPH_AI_API_KEY || process.env.THINKRAPH_AI_MODEL || process.env.THINKRAPH_AI_TIMEOUT_MS);

export const config = {
  dataDir: path.resolve(process.env.THINKRAPH_DATA_DIR || path.join(projectRoot, 'data')),
  port: positive(process.env.THINKRAPH_PORT, 3001),
  graphMaxBytes: positive(process.env.THINKRAPH_GRAPH_MAX_BYTES, 10 * 1024 * 1024),
  spaceMaxBytes: positive(process.env.THINKRAPH_SPACE_MAX_BYTES, 100 * 1024 * 1024),
  maxGraphs: positive(process.env.THINKRAPH_MAX_GRAPHS, 200),
  origins: (process.env.THINKRAPH_ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(','),
  ai: envAi,
  aiSource: hasEnvAi ? 'env' : 'default'
} satisfies AppConfig;

const localConfigFile = (dataDir: string) => path.join(dataDir, 'config.json');
const configAi = (value: ConfigImport) => 'config' in value ? value.config.ai : value.ai;
const publicAi = (value: AiConfig) => ({ baseUrl: value.baseUrl, model: value.model, timeoutMs: value.timeoutMs, apiKeyConfigured: Boolean(value.apiKey) });

async function readLocalConfig(dataDir: string) {
  try { return parse(localConfigSchema, await readJson(localConfigFile(dataDir))); }
  catch (error) {
    if (missing(error)) return null;
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'INVALID_CONFIG', '本地配置文件损坏，请修复 data/config.json');
  }
}

export async function loadConfig(base: AppConfig = config) {
  const local = await readLocalConfig(base.dataDir);
  if (!local) return base;
  return { ...base, ai: { ...base.ai, ...local.ai }, aiSource: 'local' as const };
}

async function persistConfig(dataDir: string, ai: AiConfig) {
  const file = localConfigFile(dataDir);
  await atomicJson(file, { schemaVersion: 1, ai });
  await fs.chmod(file, 0o600).catch(() => {});
}

function normalizeAi(input: Partial<AiConfig>, current: AiConfig) {
  const next = { ...current, ...input };
  next.baseUrl = next.baseUrl.trim().replace(/\/$/, '');
  next.model = next.model.trim();
  if (next.baseUrl) {
    try { if (!['http:', 'https:'].includes(new URL(next.baseUrl).protocol)) throw new Error(); }
    catch { throw new AppError(422, 'INVALID_CONFIG', '模型端点必须是 HTTP(S) 地址'); }
  }
  if (!Number.isInteger(next.timeoutMs) || next.timeoutMs < 1000 || next.timeoutMs > 600000) throw new AppError(422, 'INVALID_CONFIG', '模型超时必须是 1000 到 600000 之间的整数毫秒');
  return next;
}

export function configResponse(options: AppConfig) {
  return { agentConfigured: Boolean(options.ai.baseUrl && options.ai.model), source: options.aiSource, ai: publicAi(options.ai) };
}

export async function updateConfig(options: AppConfig, input: unknown) {
  const patch = parse(z.object({ ai: z.object(aiFields).partial().extend({ clearApiKey: z.boolean().optional() }).strict() }).strict(), input);
  const ai = normalizeAi({ ...patch.ai, ...(patch.ai.clearApiKey ? { apiKey: '' } : {}) }, options.ai);
  await persistConfig(options.dataDir, ai);
  options.ai = ai; options.aiSource = 'local';
  return configResponse(options);
}

export function exportConfig(options: AppConfig) {
  return {
    format: 'thinkraph.config' as const, formatVersion: 1 as const, exportId: randomUUID(), exportedAt: new Date().toISOString(),
    config: { ai: { baseUrl: options.ai.baseUrl, model: options.ai.model, timeoutMs: options.ai.timeoutMs } }, secretsOmitted: ['ai.apiKey' as const]
  };
}

export async function importConfig(options: AppConfig, input: unknown) {
  const parsed = parse(configImportSchema, input), incoming = configAi(parsed);
  const ai = normalizeAi(incoming, options.ai);
  await persistConfig(options.dataDir, ai);
  options.ai = ai; options.aiSource = 'local';
  return configResponse(options);
}
