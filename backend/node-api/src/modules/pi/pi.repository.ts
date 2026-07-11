import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { PiWorkspaceService } from "./pi-workspace.service";

type SkillRow = {
  id: number;
  user_id: number;
  name: string;
  description: string;
  content: string;
  source_type: string;
  package_name: string | null;
  package_json: string | null;
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
  source_type: string;
  package_name: string | null;
  package_json: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type PiPackagePayload = {
  type?: "manual" | "folder" | "zip";
  name?: string;
  files?: Array<{
    path?: string;
    content?: string;
    encoding?: "utf8" | "base64";
    size?: number;
  }>;
};

type PackageFile = {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  size: number;
};

type NormalizedPackage = {
  type: "manual" | "folder" | "zip";
  name: string | null;
  files: PackageFile[];
};

@Injectable()
export class PiRepository {
  private readonly db: DatabaseSync;

  constructor(@Inject(PiWorkspaceService) private readonly piWorkspace: PiWorkspaceService) {
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
        source_type TEXT NOT NULL DEFAULT 'manual',
        package_name TEXT,
        package_json TEXT,
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
        source_type TEXT NOT NULL DEFAULT 'manual',
        package_name TEXT,
        package_json TEXT,
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
    this.ensureColumn("pi_skills", "source_type", "TEXT NOT NULL DEFAULT 'manual'");
    this.ensureColumn("pi_skills", "package_name", "TEXT");
    this.ensureColumn("pi_skills", "package_json", "TEXT");
    this.ensureColumn("pi_plugins", "source_type", "TEXT NOT NULL DEFAULT 'manual'");
    this.ensureColumn("pi_plugins", "package_name", "TEXT");
    this.ensureColumn("pi_plugins", "package_json", "TEXT");
  }

  listSkills(userId: number) {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, name, description, content, source_type, package_name, package_json, created_at
         FROM pi_skills WHERE user_id = ? ORDER BY id DESC`,
      )
      .all(userId) as SkillRow[];
    return rows.map((row) => this.mapSkill(row));
  }

  createSkill(userId: number, body: { name?: string; description?: string; content?: string; package?: PiPackagePayload }) {
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    const packagePayload = this.normalizePackage(body.package);
    const content = String(body.content ?? this.pickPackageText(packagePayload, ["SKILL.md", "README.md", ".md", ".txt"])).trim();
    if (!name) throw new BadRequestException("Skill 名称不能为空");
    if (!content) throw new BadRequestException("Skill 内容不能为空");

    const createdAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO pi_skills (user_id, name, description, content, source_type, package_name, package_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, name, description || name, content, packagePayload.type, packagePayload.name, JSON.stringify(packagePayload.files), createdAt);
    const skill = {
      id: Number(result.lastInsertRowid),
      userId,
      name,
      description: description || name,
      content,
      sourceType: packagePayload.type,
      packageName: packagePayload.name,
      packageFiles: this.publicPackageFiles(packagePayload.files),
      createdAt,
    };
    this.piWorkspace.syncSkillPackage(userId, { ...skill, packageFiles: packagePayload.files });
    return skill;
  }

  removeSkill(userId: number, id: number) {
    this.db.prepare("DELETE FROM pi_skills WHERE user_id = ? AND id = ?").run(userId, id);
    this.db.prepare("DELETE FROM role_skills WHERE skill_id = ?").run(id);
    this.piWorkspace.removeSkillPackage(userId, id);
  }

  listPlugins(userId: number) {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, name, description, source_url, code, status, source_type, package_name, package_json, created_at, updated_at, published_at
         FROM pi_plugins WHERE user_id = ? ORDER BY id DESC`,
      )
      .all(userId) as PluginRow[];
    return rows.map((row) => this.mapPlugin(row));
  }

  createPlugin(userId: number, body: { name?: string; description?: string; sourceUrl?: string; code?: string; package?: PiPackagePayload }) {
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    const sourceUrl = String(body.sourceUrl ?? "").trim() || null;
    const packagePayload = this.normalizePackage(body.package);
    const code = String(body.code ?? this.pickPackageText(packagePayload, ["plugin.js", "index.js", "main.js", ".js", ".ts"])).trim();
    if (!name) throw new BadRequestException("插件名称不能为空");
    if (!code) throw new BadRequestException("插件代码不能为空");

    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO pi_plugins (user_id, name, description, source_url, code, status, source_type, package_name, package_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
      )
      .run(userId, name, description || name, sourceUrl, code, packagePayload.type, packagePayload.name, JSON.stringify(packagePayload.files), now, now);
    const plugin = {
      id: Number(result.lastInsertRowid),
      userId,
      name,
      description: description || name,
      sourceUrl,
      code,
      status: "draft",
      sourceType: packagePayload.type,
      packageName: packagePayload.name,
      packageFiles: this.publicPackageFiles(packagePayload.files),
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    };
    this.piWorkspace.syncPluginPackage(userId, { ...plugin, packageFiles: packagePayload.files });
    return plugin;
  }

  updatePlugin(userId: number, id: number, body: { name?: string; description?: string; sourceUrl?: string; code?: string; package?: PiPackagePayload }) {
    const current = this.findPlugin(userId, id);
    const name = String(body.name ?? current.name).trim();
    const description = String(body.description ?? current.description).trim();
    const sourceUrl = String(body.sourceUrl ?? current.sourceUrl ?? "").trim() || null;
    const packagePayload = body.package ? this.normalizePackage(body.package) : null;
    const code = String(body.code ?? (packagePayload ? this.pickPackageText(packagePayload, ["plugin.js", "index.js", "main.js", ".js", ".ts"]) : current.code)).trim();
    if (!name) throw new BadRequestException("插件名称不能为空");
    if (!code) throw new BadRequestException("插件代码不能为空");

    const updatedAt = new Date().toISOString();
    if (packagePayload) {
      this.db
        .prepare(
          `UPDATE pi_plugins
           SET name = ?, description = ?, source_url = ?, code = ?, source_type = ?, package_name = ?, package_json = ?, updated_at = ?,
               status = CASE WHEN status = 'published' THEN 'draft' ELSE status END
           WHERE user_id = ? AND id = ?`,
        )
        .run(name, description || name, sourceUrl, code, packagePayload.type, packagePayload.name, JSON.stringify(packagePayload.files), updatedAt, userId, id);
    } else {
      this.db
        .prepare(
          `UPDATE pi_plugins
           SET name = ?, description = ?, source_url = ?, code = ?, updated_at = ?,
               status = CASE WHEN status = 'published' THEN 'draft' ELSE status END
           WHERE user_id = ? AND id = ?`,
        )
        .run(name, description || name, sourceUrl, code, updatedAt, userId, id);
    }
    const plugin = this.findPluginForWorkspace(userId, id);
    this.piWorkspace.syncPluginPackage(userId, plugin);
    return this.findPlugin(userId, id);
  }

  setPluginStatus(userId: number, id: number, status: "published" | "offline") {
    const publishedAt = status === "published" ? new Date().toISOString() : null;
    const updatedAt = new Date().toISOString();
    this.db.prepare("UPDATE pi_plugins SET status = ?, published_at = ?, updated_at = ? WHERE user_id = ? AND id = ?").run(status, publishedAt, updatedAt, userId, id);
    const plugin = this.findPluginForWorkspace(userId, id);
    this.piWorkspace.syncPluginPackage(userId, plugin);
    return this.findPlugin(userId, id);
  }

  removePlugin(userId: number, id: number) {
    this.db.prepare("DELETE FROM pi_plugins WHERE user_id = ? AND id = ?").run(userId, id);
    this.db.prepare("DELETE FROM role_plugins WHERE plugin_id = ?").run(id);
    this.piWorkspace.removePluginPackage(userId, id);
  }

  private findPlugin(userId: number, id: number) {
    const row = this.db
      .prepare(
        `SELECT id, user_id, name, description, source_url, code, status, source_type, package_name, package_json, created_at, updated_at, published_at
         FROM pi_plugins WHERE user_id = ? AND id = ?`,
      )
      .get(userId, id) as PluginRow | undefined;
    if (!row) throw new BadRequestException("插件不存在");
    return this.mapPlugin(row);
  }

  private findPluginForWorkspace(userId: number, id: number) {
    const row = this.db
      .prepare(
        `SELECT id, user_id, name, description, source_url, code, status, source_type, package_name, package_json, created_at, updated_at, published_at
         FROM pi_plugins WHERE user_id = ? AND id = ?`,
      )
      .get(userId, id) as PluginRow | undefined;
    if (!row) throw new BadRequestException("插件不存在");
    return this.mapPluginForWorkspace(row);
  }

  private mapSkill(row: SkillRow) {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      content: row.content,
      sourceType: row.source_type ?? "manual",
      packageName: row.package_name,
      packageFiles: this.publicPackageFiles(this.parsePackageFiles(row.package_json)),
      createdAt: row.created_at,
    };
  }

  private mapPlugin(row: PluginRow) {
    const packageFiles = this.parsePackageFiles(row.package_json);
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      sourceUrl: row.source_url,
      code: row.code,
      status: row.status,
      sourceType: row.source_type ?? "manual",
      packageName: row.package_name,
      packageFiles: this.publicPackageFiles(packageFiles),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
    };
  }

  private mapPluginForWorkspace(row: PluginRow) {
    return {
      ...this.mapPlugin(row),
      packageFiles: this.parsePackageFiles(row.package_json),
    };
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private normalizePackage(value: PiPackagePayload | undefined): NormalizedPackage {
    const type = value?.type === "folder" || value?.type === "zip" ? value.type : "manual";
    const name = String(value?.name ?? "").trim() || null;
    const files = Array.isArray(value?.files)
      ? value.files
          .map((file) => ({
            path: this.normalizePackagePath(file.path),
            content: String(file.content ?? ""),
            encoding: file.encoding === "base64" ? "base64" as const : "utf8" as const,
            size: Number(file.size ?? String(file.content ?? "").length),
          }))
          .filter((file) => file.path && file.content.length <= 2_000_000)
      : [];
    return { type, name, files };
  }

  private normalizePackagePath(value: unknown) {
    return String(value ?? "")
      .replaceAll("\\", "/")
      .split("/")
      .filter((part) => part && part !== "." && part !== "..")
      .join("/");
  }

  private pickPackageText(payload: ReturnType<PiRepository["normalizePackage"]>, preferredNames: string[]) {
    const files = payload.files.filter((file) => file.encoding === "utf8");
    for (const preferredName of preferredNames) {
      const exact = files.find((file) => file.path.toLowerCase().endsWith(preferredName.toLowerCase()));
      if (exact) return exact.content;
    }
    return files[0]?.content ?? "";
  }

  private parsePackageFiles(value: string | null | undefined) {
    if (!value) return [];
    try {
      return JSON.parse(value) as Array<{ path: string; content: string; encoding: "utf8" | "base64"; size: number }>;
    } catch {
      return [];
    }
  }

  private publicPackageFiles(files: Array<{ path: string; encoding: string; size: number }>) {
    return files.map((file) => ({ path: file.path, encoding: file.encoding, size: file.size }));
  }
}
