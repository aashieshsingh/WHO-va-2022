import pg from "pg";

const { Pool } = pg;

export function createPostgresPool() {
  return new Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          host: process.env.PGHOST ?? "localhost",
          port: Number(process.env.PGPORT ?? 5433),
          user: process.env.PGUSER ?? "postgres",
          password: process.env.PGPASSWORD ?? "aiims@123",
          database: process.env.PGDATABASE ?? "whova"
        }
  );
}
