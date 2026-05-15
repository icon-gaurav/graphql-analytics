import { getDB } from './db';

const columnCache = new Map<string, Promise<Set<string>>>();

export async function getTableColumns(tableName: string): Promise<Set<string>> {
  const cacheKey = tableName.toLowerCase();
  const existing = columnCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const loadPromise = loadColumns(cacheKey);
  columnCache.set(cacheKey, loadPromise);
  return loadPromise;
}

async function loadColumns(tableName: string): Promise<Set<string>> {
  const db = getDB();
  const rows = await db<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
  `;

  return new Set(rows.map((row) => row.column_name));
}

