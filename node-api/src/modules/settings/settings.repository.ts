import { BadRequestException, Injectable } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type DataSourceSettings = {
  dataSource: "auto" | "futu";
  futuHost: string;
  futuPort: number;
  updatedAt: string | null;
};

type SettingsRow = {
  user_id: number;
  data_source: string;
  futu_host: string;
  futu_port: number;
  updated_at: string;
};

@Injectable()
export class SettingsRepository {
  private readonly db: DatabaseSync;

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY,
        data_source TEXT NOT NULL,
        futu_host TEXT NOT NULL,
        futu_port INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(userId: number): DataSourceSettings {
    const row = this.db
      .prepare("SELECT user_id, data_source, futu_host, futu_port, updated_at FROM user_settings WHERE user_id = ?")
      .get(userId) as SettingsRow | undefined;
    if (!row) {
      return this.defaultSettings();
    }
    return {
      dataSource: row.data_source === "futu" ? "futu" : "auto",
      futuHost: row.futu_host || "127.0.0.1",
      futuPort: Number(row.futu_port || 11111),
      updatedAt: row.updated_at,
    };
  }

  save(userId: number, body: Partial<DataSourceSettings>): DataSourceSettings {
    const current = this.get(userId);
    const dataSource = body.dataSource ?? current.dataSource;
    const futuHost = String(body.futuHost ?? current.futuHost).trim() || "127.0.0.1";
    const futuPort = Number(body.futuPort ?? current.futuPort);

    if (!["auto", "futu"].includes(dataSource)) {
      throw new BadRequestException("数据源必须是 auto 或 futu");
    }
    if (!Number.isInteger(futuPort) || futuPort <= 0 || futuPort > 65535) {
      throw new BadRequestException("Futu OpenD 端口必须是 1-65535 的整数");
    }

    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, data_source, futu_host, futu_port, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           data_source = excluded.data_source,
           futu_host = excluded.futu_host,
           futu_port = excluded.futu_port,
           updated_at = excluded.updated_at`,
      )
      .run(userId, dataSource, futuHost, futuPort, updatedAt);

    return { dataSource, futuHost, futuPort, updatedAt };
  }

  private defaultSettings(): DataSourceSettings {
    return {
      dataSource: "auto",
      futuHost: "127.0.0.1",
      futuPort: 11111,
      updatedAt: null,
    };
  }
}
