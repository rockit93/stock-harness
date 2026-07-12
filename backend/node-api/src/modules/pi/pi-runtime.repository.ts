import { BadRequestException, Injectable } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type RuntimeRole = { id: number; name: string; responsibility: string; system_prompt: string; model_config_id: number | null };
export type RuntimeSkill = { id: number; name: string; description: string; content: string };
export type RuntimePlugin = { id: number; name: string; description: string; code: string; status: string };
export type RuntimeMessage = { role: "user" | "assistant"; content: string; thinking: string; trace: unknown; role_id: number | null; role_name: string | null; created_at: string };
export type RuntimeConversation = { id: number; project_id: number | null; role_id: number | null; model: string; title: string; archived_at: string | null; created_at: string; updated_at: string };
export type RuntimeProject = { id: number; name: string; description: string; instructions: string; archived_at: string | null; created_at: string; updated_at: string };

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
      CREATE TABLE IF NOT EXISTS pi_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pi_project_roles (project_id INTEGER NOT NULL, role_id INTEGER NOT NULL, PRIMARY KEY (project_id, role_id));
      CREATE TABLE IF NOT EXISTS pi_project_skills (project_id INTEGER NOT NULL, skill_id INTEGER NOT NULL, PRIMARY KEY (project_id, skill_id));
      CREATE TABLE IF NOT EXISTS pi_project_plugins (project_id INTEGER NOT NULL, plugin_id INTEGER NOT NULL, PRIMARY KEY (project_id, plugin_id));
      CREATE TABLE IF NOT EXISTS pi_project_tools (project_id INTEGER NOT NULL, tool_name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, config_json TEXT, PRIMARY KEY (project_id, tool_name));
      CREATE TABLE IF NOT EXISTS role_tools (role_id INTEGER NOT NULL, tool_name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, config_json TEXT, PRIMARY KEY (role_id, tool_name));
      CREATE TABLE IF NOT EXISTS pi_im_sessions (
        user_id INTEGER NOT NULL, provider TEXT NOT NULL, external_chat_id TEXT NOT NULL,
        conversation_id INTEGER NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, provider, external_chat_id)
      );
      CREATE TABLE IF NOT EXISTS pi_im_projects (
        user_id INTEGER NOT NULL, provider TEXT NOT NULL, external_chat_id TEXT NOT NULL,
        project_id INTEGER, updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, provider, external_chat_id)
      );
    `);
    this.ensureNullableConversationRoleId();
    this.ensureColumn("pi_conversations", "role_id", "INTEGER");
    this.ensureColumn("pi_messages", "role_id", "INTEGER");
    this.ensureColumn("pi_messages", "role_name", "TEXT");
    this.ensureColumn("pi_messages", "thinking", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("pi_messages", "trace_json", "TEXT");
    this.ensureColumn("pi_conversations", "project_id", "INTEGER");
    this.ensureColumn("pi_conversations", "archived_at", "TEXT");
    this.ensureColumn("pi_projects", "archived_at", "TEXT");
  }

  listRoles(userId: number) {
    return this.db
      .prepare("SELECT id, name, responsibility, system_prompt, model_config_id FROM agent_roles WHERE user_id = ? ORDER BY id")
      .all(userId) as RuntimeRole[];
  }

  getRole(userId: number, roleId: number) {
    const role = this.db
      .prepare("SELECT id, name, responsibility, system_prompt, model_config_id FROM agent_roles WHERE user_id = ? AND id = ?")
      .get(userId, roleId) as RuntimeRole | undefined;
    if (!role) throw new BadRequestException("角色不存在或不属于当前用户");
    return role;
  }

  getRuntimeContext(userId: number, roleId: number | null, projectId: number | null = null) {
    const role = roleId ? this.getRole(userId, roleId) : null;
    const skills = this.db.prepare(`
      SELECT DISTINCT s.id, s.name, s.description, s.content FROM pi_skills s
      WHERE s.user_id = ? AND (
        (? > 0 AND EXISTS (SELECT 1 FROM role_skills rs WHERE rs.skill_id = s.id AND rs.role_id = ?)) OR
        (? > 0 AND EXISTS (SELECT 1 FROM pi_project_skills ps WHERE ps.skill_id = s.id AND ps.project_id = ?))
      ) ORDER BY s.id`).all(userId, roleId ?? 0, roleId ?? 0, projectId ?? 0, projectId ?? 0) as RuntimeSkill[];
    const plugins = this.db.prepare(`
      SELECT DISTINCT p.id, p.name, p.description, p.code, p.status FROM pi_plugins p
      WHERE p.user_id = ? AND p.status = 'published' AND (
        (? > 0 AND EXISTS (SELECT 1 FROM role_plugins rp WHERE rp.plugin_id = p.id AND rp.role_id = ?)) OR
        (? > 0 AND EXISTS (SELECT 1 FROM pi_project_plugins pp WHERE pp.plugin_id = p.id AND pp.project_id = ?))
      ) ORDER BY p.id`).all(userId, roleId ?? 0, roleId ?? 0, projectId ?? 0, projectId ?? 0) as RuntimePlugin[];
    const project = projectId ? this.getProject(userId, projectId) : null;
    return { role, skills, plugins, project };
  }

  createConversation(userId: number, projectId: number | null, roleId: number | null, model: string, message: string) {
    const now = new Date().toISOString();
    const title = message.replace(/\s+/g, " ").slice(0, 60);
    const result = this.db
      .prepare(`
        INSERT INTO pi_conversations (user_id, project_id, role_id, model, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(userId, projectId, roleId, model, title, now, now);
    return Number(result.lastInsertRowid);
  }

  getImConversation(userId: number, provider: string, externalChatId: string): number | null {
    const row = this.db.prepare(`SELECT s.conversation_id FROM pi_im_sessions s
      JOIN pi_conversations c ON c.id=s.conversation_id AND c.user_id=s.user_id
      WHERE s.user_id=? AND s.provider=? AND s.external_chat_id=? AND c.archived_at IS NULL`)
      .get(userId, provider, externalChatId) as { conversation_id: number } | undefined;
    return row ? Number(row.conversation_id) : null;
  }

  setImConversation(userId: number, provider: string, externalChatId: string, conversationId: number) {
    this.getConversation(userId, conversationId);
    this.db.prepare(`INSERT INTO pi_im_sessions (user_id,provider,external_chat_id,conversation_id,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(user_id,provider,external_chat_id) DO UPDATE SET
      conversation_id=excluded.conversation_id,updated_at=excluded.updated_at`)
      .run(userId, provider, externalChatId, conversationId, new Date().toISOString());
  }

  clearImConversation(userId: number, provider: string, externalChatId: string, archive = true) {
    const conversationId = this.getImConversation(userId, provider, externalChatId);
    if (conversationId && archive) this.setConversationArchived(userId, conversationId, true);
    this.db.prepare("DELETE FROM pi_im_sessions WHERE user_id=? AND provider=? AND external_chat_id=?").run(userId, provider, externalChatId);
    return conversationId;
  }

  getImProject(userId: number, provider: string, externalChatId: string): number | null {
    const row = this.db.prepare("SELECT project_id FROM pi_im_projects WHERE user_id=? AND provider=? AND external_chat_id=?")
      .get(userId, provider, externalChatId) as { project_id: number | null } | undefined;
    if (!row?.project_id) return null;
    try { this.getProject(userId, Number(row.project_id)); return Number(row.project_id); }
    catch { this.db.prepare("DELETE FROM pi_im_projects WHERE user_id=? AND provider=? AND external_chat_id=?").run(userId, provider, externalChatId); return null; }
  }

  setImProject(userId: number, provider: string, externalChatId: string, projectId: number | null) {
    if (projectId) this.getProject(userId, projectId);
    this.db.prepare(`INSERT INTO pi_im_projects (user_id,provider,external_chat_id,project_id,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(user_id,provider,external_chat_id) DO UPDATE SET
      project_id=excluded.project_id,updated_at=excluded.updated_at`)
      .run(userId, provider, externalChatId, projectId, new Date().toISOString());
  }

  listConversations(userId: number, limit = 100) {
    const conversations = this.db
      .prepare(`
        SELECT id, project_id, role_id, model, title, archived_at, created_at, updated_at
        FROM pi_conversations
        WHERE user_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `)
      .all(userId, limit) as RuntimeConversation[];
    return conversations.map((conversation) => ({
      ...conversation,
      messages: this.listMessages(conversation.id, 100),
    }));
  }

  getConversation(userId: number, conversationId: number) {
    const conversation = this.db
      .prepare("SELECT id, user_id, project_id, role_id, model, title, created_at, updated_at FROM pi_conversations WHERE user_id = ? AND id = ?")
      .get(userId, conversationId) as { id: number; project_id: number | null; role_id: number | null; model: string; title: string } | undefined;
    if (!conversation) throw new BadRequestException("会话不存在或不属于当前用户");
    return conversation;
  }

  renameConversation(userId: number, conversationId: number, titleInput: string) {
    this.getConversation(userId, conversationId);
    const title = String(titleInput ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (!title) throw new BadRequestException("会话名称不能为空");
    this.db.prepare("UPDATE pi_conversations SET title = ? WHERE user_id = ? AND id = ?").run(title, userId, conversationId);
    return { ...this.getConversation(userId, conversationId), title };
  }

  setConversationArchived(userId: number, conversationId: number, archived: boolean) {
    this.getConversation(userId, conversationId);
    const archivedAt = archived ? new Date().toISOString() : null;
    this.db.prepare("UPDATE pi_conversations SET archived_at = ? WHERE user_id = ? AND id = ?").run(archivedAt, userId, conversationId);
    return { ...this.getConversation(userId, conversationId), archived_at: archivedAt };
  }

  listProjects(userId: number) {
    const projects = this.db.prepare("SELECT id, name, description, instructions, archived_at, created_at, updated_at FROM pi_projects WHERE user_id = ? ORDER BY archived_at IS NOT NULL, updated_at DESC, id DESC").all(userId) as RuntimeProject[];
    return projects.map((project) => ({
      ...project,
      roleIds: this.projectRelationIds("pi_project_roles", "role_id", project.id),
      skillIds: this.projectRelationIds("pi_project_skills", "skill_id", project.id),
      pluginIds: this.projectRelationIds("pi_project_plugins", "plugin_id", project.id),
      conversationCount: Number((this.db.prepare("SELECT COUNT(*) AS count FROM pi_conversations WHERE user_id = ? AND project_id = ?").get(userId, project.id) as { count: number }).count),
    }));
  }

  getProject(userId: number, projectId: number) {
    const project = this.db.prepare("SELECT id, name, description, instructions, archived_at, created_at, updated_at FROM pi_projects WHERE user_id = ? AND id = ?").get(userId, projectId) as RuntimeProject | undefined;
    if (!project) throw new BadRequestException("项目不存在或不属于当前用户");
    return project;
  }

  saveProject(userId: number, projectId: number | null, body: { name?: string; description?: string; instructions?: string; roleIds?: number[]; skillIds?: number[]; pluginIds?: number[] }) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new BadRequestException("项目名称不能为空");
    const now = new Date().toISOString();
    let id = projectId;
    if (id) {
      this.getProject(userId, id);
      this.db.prepare("UPDATE pi_projects SET name = ?, description = ?, instructions = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(name, String(body.description ?? ""), String(body.instructions ?? ""), now, id, userId);
    } else {
      id = Number(this.db.prepare("INSERT INTO pi_projects (user_id, name, description, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(userId, name, String(body.description ?? ""), String(body.instructions ?? ""), now, now).lastInsertRowid);
    }
    this.replaceProjectRelation(userId, id, "pi_project_roles", "role_id", "agent_roles", body.roleIds);
    this.replaceProjectRelation(userId, id, "pi_project_skills", "skill_id", "pi_skills", body.skillIds);
    this.replaceProjectRelation(userId, id, "pi_project_plugins", "plugin_id", "pi_plugins", body.pluginIds);
    return this.listProjects(userId).find((item) => item.id === id)!;
  }

  removeProject(userId: number, projectId: number) {
    this.getProject(userId, projectId);
    const transaction = ["pi_project_roles", "pi_project_skills", "pi_project_plugins"];
    for (const table of transaction) this.db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    this.db.prepare("UPDATE pi_conversations SET project_id = NULL WHERE user_id = ? AND project_id = ?").run(userId, projectId);
    this.db.prepare("DELETE FROM pi_projects WHERE user_id = ? AND id = ?").run(userId, projectId);
  }

  setProjectArchived(userId: number, projectId: number, archived: boolean) {
    this.getProject(userId, projectId);
    const now = new Date().toISOString();
    this.db.prepare("UPDATE pi_projects SET archived_at = ?, updated_at = ? WHERE user_id = ? AND id = ?").run(archived ? now : null, now, userId, projectId);
    return this.listProjects(userId).find((item) => item.id === projectId)!;
  }

  listProjectRoles(userId: number, projectId: number | null) {
    if (!projectId) return this.listRoles(userId);
    this.getProject(userId, projectId);
    return this.db.prepare(`SELECT r.id, r.name, r.responsibility, r.system_prompt FROM agent_roles r JOIN pi_project_roles pr ON pr.role_id = r.id WHERE r.user_id = ? AND pr.project_id = ? ORDER BY r.id`).all(userId, projectId) as RuntimeRole[];
  }

  resolveToolNames(userId: number, projectId: number | null, roleId: number | null, available: string[]) {
    const read = (table: "pi_project_tools" | "role_tools", column: "project_id" | "role_id", id: number | null) => id
      ? (this.db.prepare(`SELECT tool_name, enabled FROM ${table} WHERE ${column} = ?`).all(id) as Array<{ tool_name: string; enabled: number }>).filter((row) => row.enabled).map((row) => row.tool_name)
      : [];
    if (projectId) this.getProject(userId, projectId);
    if (roleId) this.getRole(userId, roleId);
    const projectTools = read("pi_project_tools", "project_id", projectId);
    const roleTools = read("role_tools", "role_id", roleId);
    let allowed = projectId ? projectTools : roleId ? roleTools : ["web_fetch"];
    if (projectId && roleId && roleTools.length) allowed = allowed.filter((name) => roleTools.includes(name));
    return available.filter((name) => allowed.includes(name));
  }

  setProjectTools(userId: number, projectId: number, names: string[]) {
    this.getProject(userId, projectId);
    return this.replaceTools("pi_project_tools", "project_id", projectId, names);
  }

  setRoleTools(userId: number, roleId: number, names: string[]) {
    this.getRole(userId, roleId);
    return this.replaceTools("role_tools", "role_id", roleId, names);
  }

  private replaceTools(table: "pi_project_tools" | "role_tools", column: "project_id" | "role_id", id: number, names: string[]) {
    const normalized = [...new Set((Array.isArray(names) ? names : []).map(String).filter((name) => /^[a-z][a-z0-9_]{1,63}$/.test(name)))];
    this.db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(id);
    const insert = this.db.prepare(`INSERT INTO ${table} (${column}, tool_name, enabled) VALUES (?, ?, 1)`);
    for (const name of normalized) insert.run(id, name);
    return { toolNames: normalized };
  }

  private projectRelationIds(table: string, column: string, projectId: number) {
    return (this.db.prepare(`SELECT ${column} AS id FROM ${table} WHERE project_id = ? ORDER BY ${column}`).all(projectId) as Array<{ id: number }>).map((item) => item.id);
  }

  private replaceProjectRelation(userId: number, projectId: number, table: string, column: string, sourceTable: string, values: number[] | undefined) {
    this.db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    const ids = [...new Set((Array.isArray(values) ? values : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const exists = this.db.prepare(`SELECT id FROM ${sourceTable} WHERE user_id = ? AND id = ?`);
    const insert = this.db.prepare(`INSERT INTO ${table} (project_id, ${column}) VALUES (?, ?)`);
    for (const id of ids) if (exists.get(userId, id)) insert.run(projectId, id);
  }

  listMessages(conversationId: number, limit = 20) {
    const rows = this.db
      .prepare(
        `SELECT role, content, thinking, trace_json, role_id, role_name, created_at
         FROM pi_messages
         WHERE conversation_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(conversationId, limit)
      .reverse() as Array<Omit<RuntimeMessage, "trace"> & { trace_json: string | null }>;
    return rows.map(({ trace_json, ...row }) => ({ ...row, trace: trace_json ? this.parseTrace(trace_json) : null }));
  }

  addMessage(conversationId: number, role: "user" | "assistant", content: string, actor: { roleId?: number | null; roleName?: string | null; thinking?: string; trace?: unknown } = {}) {
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO pi_messages (conversation_id, role, content, role_id, role_name, thinking, trace_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(conversationId, role, content, actor.roleId ?? null, actor.roleName ?? null, actor.thinking ?? "", actor.trace ? JSON.stringify(actor.trace) : null, now);
    this.db.prepare("UPDATE pi_conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
  }

  private parseTrace(value: string) {
    try { return JSON.parse(value); } catch { return null; }
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
