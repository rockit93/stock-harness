import { BadRequestException, Injectable } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

type RoleRow = {
  id: number;
  user_id: number;
  name: string;
  responsibility: string;
  system_prompt: string;
  created_at: string;
};

@Injectable()
export class RolesRepository {
  private readonly db: DatabaseSync;

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        responsibility TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  list(userId: number) {
    const rows = this.db
      .prepare("SELECT id, user_id, name, responsibility, system_prompt, created_at FROM agent_roles WHERE user_id = ? ORDER BY id")
      .all(userId) as RoleRow[];
    return rows.map((row) => this.mapRow(row));
  }

  create(userId: number, body: { name?: string; responsibility?: string; systemPrompt?: string }) {
    const name = String(body.name ?? "").trim();
    const responsibility = String(body.responsibility ?? "").trim();
    const systemPrompt = String(body.systemPrompt ?? "").trim();

    if (!name) {
      throw new BadRequestException("角色名称不能为空");
    }
    if (!responsibility) {
      throw new BadRequestException("角色职责不能为空");
    }

    const createdAt = new Date().toISOString();
    const result = this.db
      .prepare("INSERT INTO agent_roles (user_id, name, responsibility, system_prompt, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(userId, name, responsibility, systemPrompt || responsibility, createdAt);
    return { id: Number(result.lastInsertRowid), userId, name, responsibility, systemPrompt: systemPrompt || responsibility, createdAt };
  }

  remove(userId: number, id: number) {
    this.db.prepare("DELETE FROM agent_roles WHERE user_id = ? AND id = ?").run(userId, id);
  }

  private mapRow(row: RoleRow) {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      responsibility: row.responsibility,
      systemPrompt: row.system_prompt,
      createdAt: row.created_at,
    };
  }
}
