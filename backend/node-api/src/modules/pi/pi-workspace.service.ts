import { Injectable } from "@nestjs/common";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

type WorkspaceRole = {
  id: number;
  userId: number;
  name: string;
  responsibility: string;
  systemPrompt: string;
  createdAt: string;
  skillIds: number[];
  pluginIds: number[];
};

type UserRow = {
  id: number;
  username: string;
  created_at: string;
};

type NamedRow = {
  id: number;
  name: string;
  description?: string;
  status?: string;
};

type PackageFile = {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  size: number;
};

type SkillPackage = {
  id: number;
  name: string;
  description: string;
  content: string;
  sourceType: string;
  packageName: string | null;
  packageFiles: PackageFile[];
  createdAt: string;
};

type PluginPackage = {
  id: number;
  name: string;
  description: string;
  sourceUrl: string | null;
  code: string;
  status: string;
  sourceType: string;
  packageName: string | null;
  packageFiles: PackageFile[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

@Injectable()
export class PiWorkspaceService {
  private readonly db: DatabaseSync;
  private readonly piRoot: string;
  private readonly projectName: string;

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = path.resolve(dirname, "../../../../..");
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.piRoot = path.join(projectRoot, ".pi");
    this.projectName = path.basename(projectRoot);
    mkdirSync(this.piRoot, { recursive: true });
  }

  syncRoles(userId: number, roles: WorkspaceRole[]) {
    const userWorkspace = this.ensureUserWorkspace(userId);
    for (const role of roles) {
      this.syncRole(userId, role);
    }
    this.writeJson(path.join(userWorkspace.defaultProjectDir, "roles.json"), {
      userId,
      account: userWorkspace.account,
      project: this.projectName,
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        responsibility: role.responsibility,
        directory: path.relative(this.piRoot, this.roleDir(userWorkspace.rolesDir, role)),
      })),
      updatedAt: new Date().toISOString(),
    });
  }

  syncRole(userId: number, role: WorkspaceRole) {
    const userWorkspace = this.ensureUserWorkspace(userId);
    const roleDir = this.roleDir(userWorkspace.rolesDir, role);
    mkdirSync(roleDir, { recursive: true });

    this.writeJson(path.join(roleDir, "role.json"), {
      id: role.id,
      userId: role.userId,
      name: role.name,
      responsibility: role.responsibility,
      systemPrompt: role.systemPrompt,
      createdAt: role.createdAt,
      updatedAt: new Date().toISOString(),
    });
    this.writeIfMissing(
      path.join(roleDir, "memory.md"),
      `# ${role.name}\n\nPersistent notes for this Pi role.\n`,
    );
    this.writeJson(path.join(roleDir, "skills.json"), {
      roleId: role.id,
      skills: this.describeNamedRows("pi_skills", userId, role.skillIds),
      updatedAt: new Date().toISOString(),
    });
    this.writeJson(path.join(roleDir, "plugins.json"), {
      roleId: role.id,
      plugins: this.describeNamedRows("pi_plugins", userId, role.pluginIds),
      updatedAt: new Date().toISOString(),
    });
  }

  removeRole(userId: number, roleId: number) {
    const userWorkspace = this.ensureUserWorkspace(userId);
    if (existsSync(userWorkspace.rolesDir)) {
      for (const entry of readdirSync(userWorkspace.rolesDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith(`${roleId}-`)) {
          rmSync(path.join(userWorkspace.rolesDir, entry.name), { recursive: true, force: true });
        }
      }
    }
    this.syncRoles(userId, this.loadRoles(userId));
  }

  syncSkillPackage(userId: number, skill: SkillPackage) {
    const userWorkspace = this.ensureUserWorkspace(userId);
    const skillDir = this.packageDir(userWorkspace.skillsDir, skill.id, skill.name);
    mkdirSync(skillDir, { recursive: true });
    this.writeJson(path.join(skillDir, "skill.json"), {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      sourceType: skill.sourceType,
      packageName: skill.packageName,
      createdAt: skill.createdAt,
      updatedAt: new Date().toISOString(),
      files: skill.packageFiles.map((file) => ({ path: file.path, encoding: file.encoding, size: file.size })),
    });
    this.writeFile(path.join(skillDir, "content.md"), skill.content, "utf8");
    this.writePackageFiles(path.join(skillDir, "package"), skill.packageFiles);
  }

  removeSkillPackage(userId: number, skillId: number) {
    const userWorkspace = this.ensureUserWorkspace(userId);
    this.removePackageDir(userWorkspace.skillsDir, skillId);
  }

  syncPluginPackage(userId: number, plugin: PluginPackage) {
    const userWorkspace = this.ensureUserWorkspace(userId);
    const pluginDir = this.packageDir(userWorkspace.pluginsDir, plugin.id, plugin.name);
    mkdirSync(pluginDir, { recursive: true });
    this.writeJson(path.join(pluginDir, "plugin.json"), {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      sourceUrl: plugin.sourceUrl,
      status: plugin.status,
      sourceType: plugin.sourceType,
      packageName: plugin.packageName,
      createdAt: plugin.createdAt,
      updatedAt: plugin.updatedAt,
      publishedAt: plugin.publishedAt,
      files: plugin.packageFiles.map((file) => ({ path: file.path, encoding: file.encoding, size: file.size })),
    });
    this.writeFile(path.join(pluginDir, "code.js"), plugin.code, "utf8");
    this.writePackageFiles(path.join(pluginDir, "package"), plugin.packageFiles);
  }

  removePluginPackage(userId: number, pluginId: number) {
    const userWorkspace = this.ensureUserWorkspace(userId);
    this.removePackageDir(userWorkspace.pluginsDir, pluginId);
  }

  private ensureProjectWorkspace(projectDir: string) {
    mkdirSync(path.join(projectDir, "tasks"), { recursive: true });
    mkdirSync(path.join(projectDir, "runs"), { recursive: true });
    mkdirSync(path.join(projectDir, "artifacts"), { recursive: true });
    mkdirSync(path.join(projectDir, "sessions"), { recursive: true });
    this.writeIfMissing(
      path.join(projectDir, "AGENTS.md"),
      `# ${this.projectName}\n\nUser-scoped Pi project context. Assign roles to this project through roles.json.\n`,
    );
    this.writeIfMissing(path.join(projectDir, "context.md"), `# ${this.projectName} Context\n`);
  }

  private ensureUserWorkspace(userId: number) {
    const user = this.findUser(userId);
    const account = this.slug(user?.username ?? "", `user-${userId}`);
    const userDir = path.join(this.piRoot, "users", account);
    const rolesDir = path.join(userDir, "roles");
    const skillsDir = path.join(userDir, "skills");
    const pluginsDir = path.join(userDir, "plugins");
    const projectsDir = path.join(userDir, "projects");
    const defaultProjectDir = path.join(projectsDir, this.slug(this.projectName, "project"));
    mkdirSync(rolesDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(projectsDir, { recursive: true });
    this.ensureProjectWorkspace(defaultProjectDir);
    this.writeJson(path.join(userDir, "profile.json"), {
      id: userId,
      username: user?.username ?? null,
      createdAt: user?.created_at ?? null,
      updatedAt: new Date().toISOString(),
    });
    return { account, userDir, rolesDir, skillsDir, pluginsDir, projectsDir, defaultProjectDir };
  }

  private roleDir(rolesDir: string, role: Pick<WorkspaceRole, "id" | "name">) {
    return path.join(rolesDir, `${role.id}-${this.slug(role.name, "role")}`);
  }

  private packageDir(parentDir: string, id: number, name: string) {
    this.removePackageDir(parentDir, id);
    return path.join(parentDir, `${id}-${this.slug(name, "package")}`);
  }

  private removePackageDir(parentDir: string, id: number) {
    if (!existsSync(parentDir)) return;
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(`${id}-`)) {
        rmSync(path.join(parentDir, entry.name), { recursive: true, force: true });
      }
    }
  }

  private findUser(userId: number) {
    return this.db.prepare("SELECT id, username, created_at FROM users WHERE id = ?").get(userId) as UserRow | undefined;
  }

  private loadRoles(userId: number): WorkspaceRole[] {
    const rows = this.db
      .prepare("SELECT id, user_id, name, responsibility, system_prompt, created_at FROM agent_roles WHERE user_id = ? ORDER BY id")
      .all(userId) as Array<{
      id: number;
      user_id: number;
      name: string;
      responsibility: string;
      system_prompt: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      responsibility: row.responsibility,
      systemPrompt: row.system_prompt,
      createdAt: row.created_at,
      skillIds: this.listRelationIds("role_skills", "skill_id", row.id),
      pluginIds: this.listRelationIds("role_plugins", "plugin_id", row.id),
    }));
  }

  private listRelationIds(table: string, idColumn: string, roleId: number) {
    const rows = this.db.prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE role_id = ?`).all(roleId) as Array<{ id: number }>;
    return rows.map((row) => row.id);
  }

  private describeNamedRows(table: "pi_skills" | "pi_plugins", userId: number, ids: number[]) {
    if (!ids.length) return [];
    const columns = table === "pi_plugins" ? "id, name, description, status" : "id, name, description";
    const rows = this.db
      .prepare(`SELECT ${columns} FROM ${table} WHERE user_id = ? ORDER BY id`)
      .all(userId) as NamedRow[];
    const wanted = new Set(ids);
    return rows.filter((row) => wanted.has(row.id));
  }

  private writeJson(filePath: string, value: unknown) {
    this.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private writeIfMissing(filePath: string, content: string) {
    if (!existsSync(filePath)) {
      this.writeFile(filePath, content, "utf8");
    }
  }

  private writePackageFiles(packageDir: string, files: PackageFile[]) {
    if (existsSync(packageDir)) {
      rmSync(packageDir, { recursive: true, force: true });
    }
    mkdirSync(packageDir, { recursive: true });
    for (const file of files) {
      const targetPath = path.join(packageDir, ...file.path.split("/"));
      if (!targetPath.startsWith(packageDir)) continue;
      this.writeFile(targetPath, file.content, file.encoding);
    }
  }

  private writeFile(filePath: string, content: string, encoding: "utf8" | "base64") {
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (encoding === "base64") {
      writeFileSync(filePath, Buffer.from(content, "base64"));
      return;
    }
    writeFileSync(filePath, content, "utf8");
  }

  private slug(value: string, fallback: string) {
    const slug = value
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .toLowerCase();
    return slug || fallback;
  }
}
