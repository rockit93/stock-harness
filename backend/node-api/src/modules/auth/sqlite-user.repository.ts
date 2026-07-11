import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { Injectable } from "@nestjs/common";

type UserRecord = {
  id: number;
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
};

type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  salt: string;
  created_at: string;
};

@Injectable()
export class SqliteUserRepository {
  private readonly db: DatabaseSync;

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  findByUsername(username: string): UserRecord | null {
    const row = this.db
      .prepare("SELECT id, username, password_hash, salt, created_at FROM users WHERE username = ?")
      .get(username) as UserRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  create(username: string, passwordHash: string, salt: string): UserRecord {
    const createdAt = new Date().toISOString();
    const result = this.db
      .prepare("INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)")
      .run(username, passwordHash, salt, createdAt);

    return {
      id: Number(result.lastInsertRowid),
      username,
      passwordHash,
      salt,
      createdAt,
    };
  }

  private mapRow(row: UserRow): UserRecord {
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      salt: row.salt,
      createdAt: row.created_at,
    };
  }
}
