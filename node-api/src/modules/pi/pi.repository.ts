import { BadRequestException, Injectable } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

type SkillRow = {
  id: number;
  user_id: number;
  name: string;
  description: string;
  content: string;
  created_at: string;
};

type PluginRow = {
  id: number;
  user_id: number;
  name: string;
  description: string;
  source_url: string | null;
  code: string;
  status: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

@Injectable()
export class PiRepository {
  private readonly db: DatabaseSync;

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pi_skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pi_plugins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        source_url TEXT,
        code TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        published_at TEXT
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

  listSkills(userId: number) {
    const rows = this.db
      .prepare("SELECT id, user_id, name, description, content, created_at FROM pi_skills WHERE user_id = ? ORDER BY id DESC")
      .all(userId) as SkillRow[];
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  createSkill(userId: number, body: { name?: string; description?: string; content?: string }) {
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    const content = String(body.content ?? "").trim();
    if (!name) throw new BadRequestException("Skill 名称不能为空");
    if (!content) throw new BadRequestException("Skill 内容不能为空");

    const createdAt = new Date().toISOString();
    const result = this.db
      .prepare("INSERT INTO pi_skills (user_id, name, description, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(userId, name, description || name, content, createdAt);
    return { id: Number(result.lastInsertRowid), userId, name, description: description || name, content, createdAt };
  }

  removeSkill(userId: number, id: number) {
    this.db.prepare("DELETE FROM pi_skills WHERE user_id = ? AND id = ?").run(userId, id);
    this.db.prepare("DELETE FROM role_skills WHERE skill_id = ?").run(id);
  }

  listPlugins(userId: number) {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, name, description, source_url, code, status, created_at, updated_at, published_at
         FROM pi_plugins WHERE user_id = ? ORDER BY id DESC`,
      )
      .all(userId) as PluginRow[];
    return rows.map((row) => this.mapPlugin(row));
  }

  createPlugin(userId: number, body: { name?: string; description?: string; sourceUrl?: string; code?: string }) {
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    const sourceUrl = String(body.sourceUrl ?? "").trim() || null;
    const code = String(body.code ?? "").trim();
    if (!name) throw new BadRequestException("插件名称不能为空");
    if (!code) throw new BadRequestException("插件代码不能为空");

    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO pi_plugins (user_id, name, description, source_url, code, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      )
      .run(userId, name, description || name, sourceUrl, code, now, now);
    return {
      id: Number(result.lastInsertRowid),
      userId,
      name,
      description: description || name,
      sourceUrl,
      code,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    };
  }

  updatePlugin(userId: number, id: number, body: { name?: string; description?: string; sourceUrl?: string; code?: string }) {
    const current = this.findPlugin(userId, id);
    const name = String(body.name ?? current.name).trim();
    const description = String(body.description ?? current.description).trim();
    const sourceUrl = String(body.sourceUrl ?? current.sourceUrl ?? "").trim() || null;
    const code = String(body.code ?? current.code).trim();
    if (!name) throw new BadRequestException("插件名称不能为空");
    if (!code) throw new BadRequestException("插件代码不能为空");

    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE pi_plugins
         SET name = ?, description = ?, source_url = ?, code = ?, updated_at = ?, status = CASE WHEN status = 'published' THEN 'draft' ELSE status END
         WHERE user_id = ? AND id = ?`,
      )
      .run(name, description || name, sourceUrl, code, updatedAt, userId, id);
    return this.findPlugin(userId, id);
  }

  setPluginStatus(userId: number, id: number, status: "published" | "offline") {
    const publishedAt = status === "published" ? new Date().toISOString() : null;
    const updatedAt = new Date().toISOString();
    this.db
      .prepare("UPDATE pi_plugins SET status = ?, published_at = ?, updated_at = ? WHERE user_id = ? AND id = ?")
      .run(status, publishedAt, updatedAt, userId, id);
    return this.findPlugin(userId, id);
  }

  removePlugin(userId: number, id: number) {
    this.db.prepare("DELETE FROM pi_plugins WHERE user_id = ? AND id = ?").run(userId, id);
    this.db.prepare("DELETE FROM role_plugins WHERE plugin_id = ?").run(id);
  }

  private findPlugin(userId: number, id: number) {
    const row = this.db
      .prepare(
        `SELECT id, user_id, name, description, source_url, code, status, created_at, updated_at, published_at
         FROM pi_plugins WHERE user_id = ? AND id = ?`,
      )
      .get(userId, id) as PluginRow | undefined;
    if (!row) throw new BadRequestException("插件不存在");
    return this.mapPlugin(row);
  }

  private mapPlugin(row: PluginRow) {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      sourceUrl: row.source_url,
      code: row.code,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
    };
  }
}
