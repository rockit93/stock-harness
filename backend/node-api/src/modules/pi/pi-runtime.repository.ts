import { BadRequestException, Injectable } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type RuntimeRole = { id: number; name: string; responsibility: string; system_prompt: string };
export type RuntimeSkill = { id: number; name: string; description: string; content: string };
export type RuntimePlugin = { id: number; name: string; description: string; code: string; status: string };
export type RuntimeMessage = { role: "user" | "assistant"; content: string; role_id: number | null; role_name: string | null; created_at: string };

@Injectable()
export class PiRuntimeRepository {
  private readonly db: DatabaseSync;

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pi_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        role_id INTEGER,
        model TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pi_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        role_id INTEGER,
        role_name TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureNullableConversationRoleId();
    this.ensureColumn("pi_conversations", "role_id", "INTEGER");
    this.ensureColumn("pi_messages", "role_id", "INTEGER");
    this.ensureColumn("pi_messages", "role_name", "TEXT");
  }

  listRoles(userId: number) {
    return this.db
      .prepare("SELECT id, name, responsibility, system_prompt FROM agent_roles WHERE user_id = ? ORDER BY id")
      .all(userId) as RuntimeRole[];
  }

  getRole(userId: number, roleId: number) {
    const role = this.db
      .prepare("SELECT id, name, responsibility, system_prompt FROM agent_roles WHERE user_id = ? AND id = ?")
      .get(userId, roleId) as RuntimeRole | undefined;
    if (!role) throw new BadRequestException("角色不存在或不属于当前用户");
    return role;
  }

  getRuntimeContext(userId: number, roleId: number | null) {
    const role = roleId ? this.getRole(userId, roleId) : null;
    const skills = roleId
      ? (this.db
          .prepare(`
            SELECT s.id, s.name, s.description, s.content
            FROM pi_skills s JOIN role_skills rs ON rs.skill_id = s.id
            WHERE s.user_id = ? AND rs.role_id = ? ORDER BY s.id
          `)
          .all(userId, roleId) as RuntimeSkill[])
      : [];
    const plugins = roleId
      ? (this.db
          .prepare(`
            SELECT p.id, p.name, p.description, p.code, p.status
            FROM pi_plugins p JOIN role_plugins rp ON rp.plugin_id = p.id
            WHERE p.user_id = ? AND rp.role_id = ? AND p.status = 'published' ORDER BY p.id
          `)
          .all(userId, roleId) as RuntimePlugin[])
      : [];
    return { role, skills, plugins };
  }

  createConversation(userId: number, roleId: number | null, model: string, message: string) {
    const now = new Date().toISOString();
    const title = message.replace(/\s+/g, " ").slice(0, 60);
    const result = this.db
      .prepare(`
        INSERT INTO pi_conversations (user_id, role_id, model, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(userId, roleId, model, title, now, now);
    return Number(result.lastInsertRowid);
  }

  getConversation(userId: number, conversationId: number) {
    const conversation = this.db
      .prepare("SELECT id, user_id, role_id, model, title, created_at, updated_at FROM pi_conversations WHERE user_id = ? AND id = ?")
      .get(userId, conversationId) as { id: number; role_id: number | null; model: string; title: string } | undefined;
    if (!conversation) throw new BadRequestException("会话不存在或不属于当前用户");
    return conversation;
  }

  listMessages(conversationId: number, limit = 20) {
    return this.db
      .prepare(
        `SELECT role, content, role_id, role_name, created_at
         FROM pi_messages
         WHERE conversation_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(conversationId, limit)
      .reverse() as RuntimeMessage[];
  }

  addMessage(conversationId: number, role: "user" | "assistant", content: string, actor: { roleId?: number | null; roleName?: string | null } = {}) {
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO pi_messages (conversation_id, role, content, role_id, role_name, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(conversationId, role, content, actor.roleId ?? null, actor.roleName ?? null, now);
    this.db.prepare("UPDATE pi_conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private ensureNullableConversationRoleId() {
    const columns = this.db.prepare("PRAGMA table_info(pi_conversations)").all() as Array<{ name: string; notnull: number }>;
    const roleColumn = columns.find((item) => item.name === "role_id");
    if (!roleColumn || roleColumn.notnull === 0) return;

    this.db.exec(`
      BEGIN TRANSACTION;
      ALTER TABLE pi_conversations RENAME TO pi_conversations_old;
      CREATE TABLE pi_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        role_id INTEGER,
        model TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO pi_conversations (id, user_id, role_id, model, title, created_at, updated_at)
      SELECT id, user_id, role_id, model, title, created_at, updated_at FROM pi_conversations_old;
      DROP TABLE pi_conversations_old;
      COMMIT;
    `);
  }
}
