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
      CREATE TABLE IF NOT EXISTS role_skills (
        role_id INTEGER NOT NULL,
        skill_id INTEGER NOT NULL,
        PRIMARY KEY (role_id, skill_id)
      );
      CREATE TABLE IF NOT EXISTS role_plugins (
        role_id INTEGER NOT NULL,
        plugin_id INTEGER NOT NULL,
        PRIMARY KEY (role_id, plugin_id)
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
    this.db.prepare("DELETE FROM role_skills WHERE role_id = ?").run(id);
    this.db.prepare("DELETE FROM role_plugins WHERE role_id = ?").run(id);
  }

  updateCapabilities(userId: number, id: number, body: { skillIds?: number[]; pluginIds?: number[] }) {
    const role = this.db.prepare("SELECT id FROM agent_roles WHERE user_id = ? AND id = ?").get(userId, id) as { id: number } | undefined;
    if (!role) {
      throw new BadRequestException("角色不存在");
    }

    const skillIds = this.filterOwnedIds("pi_skills", userId, this.normalizeIds(body.skillIds));
    const pluginIds = this.filterOwnedIds("pi_plugins", userId, this.normalizeIds(body.pluginIds));

    const insertSkill = this.db.prepare("INSERT OR IGNORE INTO role_skills (role_id, skill_id) VALUES (?, ?)");
    const insertPlugin = this.db.prepare("INSERT OR IGNORE INTO role_plugins (role_id, plugin_id) VALUES (?, ?)");
    this.db.prepare("DELETE FROM role_skills WHERE role_id = ?").run(id);
    this.db.prepare("DELETE FROM role_plugins WHERE role_id = ?").run(id);
    for (const skillId of skillIds) {
      insertSkill.run(id, skillId);
    }
    for (const pluginId of pluginIds) {
      insertPlugin.run(id, pluginId);
    }

    return this.mapRow(
      this.db
        .prepare("SELECT id, user_id, name, responsibility, system_prompt, created_at FROM agent_roles WHERE user_id = ? AND id = ?")
        .get(userId, id) as RoleRow,
    );
  }

  private mapRow(row: RoleRow) {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      responsibility: row.responsibility,
      systemPrompt: row.system_prompt,
      createdAt: row.created_at,
      skillIds: this.listRelationIds("role_skills", "skill_id", row.id),
      pluginIds: this.listRelationIds("role_plugins", "plugin_id", row.id),
    };
  }

  private listRelationIds(table: string, idColumn: string, roleId: number) {
    const rows = this.db.prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE role_id = ?`).all(roleId) as Array<{ id: number }>;
    return rows.map((row) => row.id);
  }

  private normalizeIds(value: unknown) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))];
  }

  private filterOwnedIds(table: string, userId: number, ids: number[]) {
    if (!ids.length) return [];
    const rows = this.db.prepare(`SELECT id FROM ${table} WHERE user_id = ?`).all(userId) as Array<{ id: number }>;
    const owned = new Set(rows.map((row) => row.id));
    return ids.filter((id) => owned.has(id));
  }
}
