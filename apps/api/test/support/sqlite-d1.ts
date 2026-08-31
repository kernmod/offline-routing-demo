import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

type Row = Record<string, unknown>;

function sqlLiteral(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function interpolate(sql: string, values: unknown[]): string {
  let index = 0;
  const rendered = sql.replace(/\?/g, () => sqlLiteral(values[index++]));
  if (index !== values.length) throw new Error("all statement bindings must be consumed");
  return rendered;
}

function execute(databasePath: string, sql: string, json = false): string {
  mkdirSync(dirname(databasePath), { recursive: true });
  return execFileSync("sqlite3", [json ? "-json" : "", databasePath, sql].filter(Boolean), { encoding: "utf8" });
}

class SqliteStatement {
  private values: unknown[] = [];

  constructor(private readonly databasePath: string, private readonly sql: string) {}

  bind(...values: unknown[]): SqliteStatement {
    this.values = values;
    return this;
  }

  async first<T = Row>(): Promise<T | null> {
    return (await this.all<T>()).results[0] ?? null;
  }

  async all<T = Row>(): Promise<{ success: true; results: T[] }> {
    const output = execute(this.databasePath, interpolate(this.sql, this.values), true).trim();
    return { success: true, results: output ? (JSON.parse(output) as T[]) : [] };
  }

  async run(): Promise<{ success: true }> {
    execute(this.databasePath, interpolate(this.sql, this.values));
    return { success: true };
  }
}

export function createSqliteD1(databasePath: string): D1Database {
  const database = {
    prepare(sql: string) {
      return new SqliteStatement(databasePath, sql);
    },
    async batch(statements: SqliteStatement[]) {
      for (const statement of statements) await statement.run();
      return [];
    },
    exec(sql: string) {
      execute(databasePath, sql);
      return Promise.resolve({ count: 0, duration: 0 });
    }
  };
  return database as unknown as D1Database;
}
