import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { PiWorkspaceService } from "../pi/pi-workspace.service";

type RoleRow = {
  id: number;
  user_id: number;
  name: string;
  responsibility: string;
  system_prompt: string;
  avatar: string | null;
  model_config_id: number | null;
  created_at: string;
};

@Injectable()
export class RolesRepository {
  private readonly db: DatabaseSync;

  constructor(@Inject(PiWorkspaceService) private readonly piWorkspace: PiWorkspaceService) {
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
    const columns = this.db.prepare("PRAGMA table_info(agent_roles)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "model_config_id")) this.db.exec("ALTER TABLE agent_roles ADD COLUMN model_config_id INTEGER");
    if (!columns.some((column) => column.name === "avatar")) this.db.exec("ALTER TABLE agent_roles ADD COLUMN avatar TEXT");
  }

  list(userId: number) {
    const rows = this.db
      .prepare("SELECT id, user_id, name, responsibility, system_prompt, avatar, model_config_id, created_at FROM agent_roles WHERE user_id = ? ORDER BY id")
      .all(userId) as RoleRow[];
    const roles = rows.map((row) => this.mapRow(row));
    this.piWorkspace.syncRoles(userId, roles);
    return roles;
  }

  create(userId: number, body: { name?: string; responsibility?: string; systemPrompt?: string; avatar?: string | null; modelConfigId?: number | null }) {
    const name = String(body.name ?? "").trim();
    const responsibility = String(body.responsibility ?? "").trim();
    const systemPrompt = String(body.systemPrompt ?? "").trim();
    const avatar = this.normalizeAvatar(body.avatar);
    const modelConfigId = this.normalizeOwnedModelId(userId, body.modelConfigId);

    if (!name) {
      throw new BadRequestException("角色名称不能为空");
    }
    if (!responsibility) {
      throw new BadRequestException("角色职责不能为空");
    }

    const createdAt = new Date().toISOString();
    const result = this.db
      .prepare("INSERT INTO agent_roles (user_id, name, responsibility, system_prompt, avatar, model_config_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(userId, name, responsibility, systemPrompt || responsibility, avatar, modelConfigId, createdAt);
    const role = {
      id: Number(result.lastInsertRowid),
      userId,
      name,
      responsibility,
      systemPrompt: systemPrompt || responsibility,
      avatar,
      modelConfigId,
      createdAt,
      skillIds: [],
      pluginIds: [],
    };
    this.piWorkspace.syncRole(userId, role);
    this.piWorkspace.syncRoles(userId, this.list(userId));
    return role;
  }

  update(userId: number, id: number, body: { name?: string; responsibility?: string; systemPrompt?: string; avatar?: string | null; modelConfigId?: number | null }) {
    const existing = this.db.prepare("SELECT id FROM agent_roles WHERE user_id = ? AND id = ?").get(userId, id);
    if (!existing) throw new BadRequestException("角色不存在");
    const name = String(body.name ?? "").trim();
    const responsibility = String(body.responsibility ?? "").trim();
    const systemPrompt = String(body.systemPrompt ?? "").trim();
    if (!name) throw new BadRequestException("角色名称不能为空");
    if (!responsibility) throw new BadRequestException("角色职责不能为空");
    const avatar = this.normalizeAvatar(body.avatar);
    const modelConfigId = this.normalizeOwnedModelId(userId, body.modelConfigId);
    this.db.prepare("UPDATE agent_roles SET name = ?, responsibility = ?, system_prompt = ?, avatar = ?, model_config_id = ? WHERE user_id = ? AND id = ?")
      .run(name, responsibility, systemPrompt || responsibility, avatar, modelConfigId, userId, id);
    const role = this.mapRow(this.db.prepare("SELECT id, user_id, name, responsibility, system_prompt, avatar, model_config_id, created_at FROM agent_roles WHERE user_id = ? AND id = ?").get(userId, id) as RoleRow);
    this.piWorkspace.syncRole(userId, role);
    this.piWorkspace.syncRoles(userId, this.list(userId));
    return role;
  }

  remove(userId: number, id: number) {
    this.db.prepare("DELETE FROM agent_roles WHERE user_id = ? AND id = ?").run(userId, id);
    this.db.prepare("DELETE FROM role_skills WHERE role_id = ?").run(id);
    this.db.prepare("DELETE FROM role_plugins WHERE role_id = ?").run(id);
    this.piWorkspace.removeRole(userId, id);
  }

  updateCapabilities(userId: number, id: number, body: { skillIds?: number[]; pluginIds?: number[]; modelConfigId?: number | null }) {
    const existingRole = this.db.prepare("SELECT id, model_config_id FROM agent_roles WHERE user_id = ? AND id = ?").get(userId, id) as { id: number; model_config_id: number | null } | undefined;
    if (!existingRole) {
      throw new BadRequestException("角色不存在");
    }

    const skillIds = this.filterOwnedIds("pi_skills", userId, this.normalizeIds(body.skillIds));
    const pluginIds = this.filterOwnedIds("pi_plugins", userId, this.normalizeIds(body.pluginIds));
    const modelConfigId = body.modelConfigId === undefined ? existingRole.model_config_id : this.normalizeOwnedModelId(userId, body.modelConfigId);

    const insertSkill = this.db.prepare("INSERT OR IGNORE INTO role_skills (role_id, skill_id) VALUES (?, ?)");
    const insertPlugin = this.db.prepare("INSERT OR IGNORE INTO role_plugins (role_id, plugin_id) VALUES (?, ?)");
    this.db.prepare("DELETE FROM role_skills WHERE role_id = ?").run(id);
    this.db.prepare("DELETE FROM role_plugins WHERE role_id = ?").run(id);
    this.db.prepare("UPDATE agent_roles SET model_config_id = ? WHERE user_id = ? AND id = ?").run(modelConfigId, userId, id);
    for (const skillId of skillIds) {
      insertSkill.run(id, skillId);
    }
    for (const pluginId of pluginIds) {
      insertPlugin.run(id, pluginId);
    }

    const updatedRole = this.mapRow(
      this.db
        .prepare("SELECT id, user_id, name, responsibility, system_prompt, avatar, model_config_id, created_at FROM agent_roles WHERE user_id = ? AND id = ?")
        .get(userId, id) as RoleRow,
    );
    this.piWorkspace.syncRole(userId, updatedRole);
    this.piWorkspace.syncRoles(userId, this.list(userId));
    return updatedRole;
  }

  private mapRow(row: RoleRow) {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      responsibility: row.responsibility,
      systemPrompt: row.system_prompt,
      avatar: row.avatar,
      modelConfigId: row.model_config_id,
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

  private normalizeOwnedModelId(userId: number, value: unknown) {
    const id = Number(value || 0);
    if (!Number.isInteger(id) || id <= 0) return null;
    const found = this.db.prepare("SELECT id FROM user_models WHERE user_id = ? AND id = ?").get(userId, id);
    if (!found) throw new BadRequestException("模型配置不存在或不属于当前用户");
    return id;
  }

  private normalizeAvatar(value: unknown) {
    const avatar = String(value ?? "").trim();
    if (!avatar) return null;
    if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(avatar)) throw new BadRequestException("头像格式不支持");
    if (avatar.length > 1_400_000) throw new BadRequestException("头像不能超过 1 MB");
    return avatar;
  }
}
