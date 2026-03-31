import type { HistoryEntry } from '../types';
import * as path from 'path';
import * as fs from 'fs';
import { ensureConfigDir, getConfigDir, loadConfig } from './config';

const HISTORY_FILE = 'history.json';

function getHistoryPath(): string {
  return path.join(getConfigDir(), HISTORY_FILE);
}

/** 读取历史记录文件 */
function readHistoryFile(): HistoryEntry[] {
  const filePath = getHistoryPath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

/** 写入历史记录文件 */
function writeHistoryFile(entries: HistoryEntry[]): void {
  ensureConfigDir();
  fs.writeFileSync(getHistoryPath(), JSON.stringify(entries, null, 2), 'utf-8');
}

/** 添加历史记录 */
export function addHistory(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): void {
  const entries = readHistoryFile();
  const config = loadConfig();
  const limit = config.history_limit || 100;

  const newEntry: HistoryEntry = {
    id: entries.length > 0 ? entries[entries.length - 1].id + 1 : 1,
    timestamp: new Date().toISOString(),
    ...entry,
  };

  entries.push(newEntry);

  // 超过上限时裁剪旧记录
  const trimmed = entries.length > limit ? entries.slice(entries.length - limit) : entries;
  writeHistoryFile(trimmed);
}

/** 获取历史记录列表 */
export function getHistory(limit?: number): HistoryEntry[] {
  const entries = readHistoryFile();
  if (limit && limit > 0) {
    return entries.slice(-limit);
  }
  return entries;
}

/** 清除历史记录 */
export function clearHistory(): void {
  writeHistoryFile([]);
}
