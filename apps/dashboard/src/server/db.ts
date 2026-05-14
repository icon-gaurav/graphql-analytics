import postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;
let pool: Sql | null = null;

export function getDB(): Sql {
  if (!pool) {
    const dbUrl = process.env.DB_READ_URL;
    if (!dbUrl) {
      throw new Error('DB_READ_URL environment variable is required');
    }

    pool = postgres(dbUrl, {
      max: 5,
      connect_timeout: 10,
    });
  }

  return pool;
}

export async function closeDB(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}




