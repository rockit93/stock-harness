import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import * as Lark from "@larksuiteoapi/node-sdk";
import { SettingsRepository } from "../settings/settings.repository";
import { PiRuntimeService, PiStreamEvent } from "./pi-runtime.service";

type MessageEvent = {
  sender?: { sender_id?: { open_id?: string }; sender_type?: string };
  message?: { message_id?: string; chat_id?: string; chat_type?: string; message_type?: string; content?: string; mentions?: unknown[] };
};

type GatewayLogLevel = "info" | "warning" | "error";
type GatewayLogEntry = { id: number; timestamp: string; level: GatewayLogLevel; event: string; message: string };
type GatewayConnection = { ws: Lark.WSClient; startedAt: string; lastHeartbeatAt: string | null; logs: GatewayLogEntry[] };

@Injectable()
export class LarkImGatewayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LarkImGatewayService.name);
  private readonly seen = new Map<string, number>();
  private readonly connections = new Map<number, GatewayConnection>();
  private logSequence = 0;

  constructor(
    @Inject(SettingsRepository) private readonly settings: SettingsRepository,
    @Inject(PiRuntimeService) private readonly runtime: PiRuntimeService,
  ) {}

  onModuleInit() {
    for (const connector of this.settings.listEnabledImConnectors()) this.start(connector.userId, connector.config, connector.appSecret);
  }

  onModuleDestroy() {
    for (const connection of this.connections.values()) connection.ws.close({ force: true });
    this.connections.clear();
  }

  restart(userId: number) {
    this.connections.get(userId)?.ws.close({ force: true });
    this.connections.delete(userId);
    const config = this.settings.getImConnector(userId);
    if (!config.enabled || !config.hasAppSecret || !config.appId) return this.getStatus(userId);
    this.start(userId, config, this.settings.getImConnectorSecret(userId));
    return this.getStatus(userId);
  }

  getStatus(userId: number) {
    const connection = this.connections.get(userId);
    if (!connection) return { state: "idle", connected: false, heartbeat: { enabled: false, intervalSeconds: 120, timeoutSeconds: 15, lastAt: null }, reconnectAttempts: 0 };
    const status = connection.ws.getConnectionStatus();
    if (status.state === "connected") connection.lastHeartbeatAt = new Date().toISOString();
    return { ...status, connected: status.state === "connected", startedAt: connection.startedAt, heartbeat: { enabled: true, intervalSeconds: 120, timeoutSeconds: 15, lastAt: connection.lastHeartbeatAt } };
  }

  getLogs(userId: number, limit = 100) {
    const logs = this.connections.get(userId)?.logs || [];
    return logs.slice(-Math.max(1, Math.min(200, limit))).reverse();
  }

  clearLogs(userId: number) {
    const connection = this.connections.get(userId);
    if (connection) connection.logs.length = 0;
    return { ok: true };
  }

  private addLog(userId: number, level: GatewayLogLevel, event: string, message: string) {
    const connection = this.connections.get(userId);
    if (!connection) return;
    connection.logs.push({ id: ++this.logSequence, timestamp: new Date().toISOString(), level, event, message });
    if (connection.logs.length > 200) connection.logs.splice(0, connection.logs.length - 200);
  }

  private start(userId: number, config: ReturnType<SettingsRepository["getImConnector"]>, appSecret: string) {
    const domain = config.brand === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;
    const base = { appId: config.appId, appSecret, domain };
    const client = new Lark.Client(base);
    const dispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: MessageEvent) => {
        void this.handleMessage(userId, client, data).catch((error) => this.logger.error(`飞书消息处理失败: ${error instanceof Error ? error.stack : String(error)}`));
      },
    });
    const ws = new Lark.WSClient({
      ...base,
      loggerLevel: Lark.LoggerLevel.info,
      autoReconnect: true,
      handshakeTimeoutMs: 15_000,
      wsConfig: { pingTimeout: 15 },
      onReady: () => this.addLog(userId, "info", "connected", "WebSocket 连接已建立，心跳监测已启动"),
      onReconnecting: () => this.addLog(userId, "warning", "reconnecting", "连接中断，正在自动重连"),
      onReconnected: () => this.addLog(userId, "info", "reconnected", "WebSocket 已重新连接"),
      onError: (error) => this.addLog(userId, "error", "connection_error", error.message),
    });
    this.connections.set(userId, { ws, startedAt: new Date().toISOString(), lastHeartbeatAt: null, logs: [] });
    this.addLog(userId, "info", "starting", `正在连接${config.brand === "lark" ? " Lark" : "飞书"}长连接`);
    void ws.start({ eventDispatcher: dispatcher }).then(() => this.addLog(userId, "info", "started", "WebSocket 客户端启动完成")).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.addLog(userId, "error", "start_failed", message);
      this.logger.error(`Lark WebSocket start failed user=${userId}: ${message}`);
    });
  }

  private async handleMessage(userId: number, client: Lark.Client, event: MessageEvent) {
    const message = event.message; const messageId = String(message?.message_id || ""); const chatId = String(message?.chat_id || "");
    if (!messageId || !chatId || message?.message_type !== "text" || event.sender?.sender_type === "app") return;
    this.addLog(userId, "info", "message_received", `收到文本消息 message=${messageId} chat=${chatId}`);
    if (message.chat_type !== "p2p" && !(message.mentions?.length)) return;
    const now = Date.now();
    for (const [key, timestamp] of this.seen) if (now - timestamp > 24 * 60 * 60 * 1000) this.seen.delete(key);
    if (this.seen.has(messageId)) return; this.seen.set(messageId, now);
    let text = "";
    try { text = String(JSON.parse(String(message.content || "{}")).text || ""); } catch { text = String(message.content || ""); }
    text = text.replace(/@_user_\d+/g, "").trim();
    if (!text) return;

    const command = text.toLowerCase().split(/\s+/)[0];
    if (command === "/new") {
      const previous = this.runtime.clearImConversation(userId, "feishu", chatId);
      await this.reply(client, messageId, previous ? "已结束并归档当前会话。请发送新问题，我会创建一个新会话。" : "当前没有进行中的会话。请发送新问题开始会话。");
      return;
    }
    if (command === "/status") {
      const current = this.runtime.getImConversation(userId, "feishu", chatId);
      const projectId = this.runtime.getImProject(userId, "feishu", chatId);
      const project = projectId ? this.runtime.listProjects(userId).find((item) => item.id === projectId) : null;
      await this.reply(client, messageId, [`当前项目：${project ? `${project.name} (#${project.id})` : "个人空间"}`, current ? `当前会话：#${current}` : "当前会话：尚未创建", "发送 /help 查看切换命令。"].join("\n"));
      return;
    }
    if (command === "/projects") {
      const projects = this.runtime.listProjects(userId);
      await this.reply(client, messageId, ["可用项目：", "- my · 个人空间", ...projects.map((item) => `- ${item.id} · ${item.name}`), "使用 /project <编号|my> 切换。"].join("\n"));
      return;
    }
    if (command === "/project") {
      const target = text.split(/\s+/)[1];
      if (!target) { await this.reply(client, messageId, "请使用 /project <项目编号|my>，或发送 /projects 查看列表。"); return; }
      const projectId = target.toLowerCase() === "my" ? null : Number(target);
      const project = projectId ? this.runtime.listProjects(userId).find((item) => item.id === projectId) : null;
      if (projectId && !project) { await this.reply(client, messageId, `找不到项目 #${target}，发送 /projects 查看可用项目。`); return; }
      this.runtime.clearImConversation(userId, "feishu", chatId, false);
      this.runtime.setImProject(userId, "feishu", chatId, projectId);
      await this.reply(client, messageId, `已切换到${project ? `项目“${project.name}” (#${project.id})` : "个人空间"}。下一条消息将创建该项目下的新会话。`);
      return;
    }
    if (command === "/sessions") {
      const projectId = this.runtime.getImProject(userId, "feishu", chatId);
      const sessions = this.runtime.listConversations(userId).filter((item) => item.project_id === projectId && !item.archived_at).slice(0, 10);
      await this.reply(client, messageId, sessions.length ? ["最近会话：", ...sessions.map((item) => `- ${item.id} · ${item.title}`), "使用 /session <编号> 继续会话。"].join("\n") : "当前项目还没有可用会话。发送普通消息即可创建。");
      return;
    }
    if (command === "/session") {
      const sessionId = Number(text.split(/\s+/)[1]);
      const session = Number.isInteger(sessionId) ? this.runtime.listConversations(userId).find((item) => item.id === sessionId && !item.archived_at) : null;
      if (!session) { await this.reply(client, messageId, "会话不存在或已归档。发送 /sessions 查看可用会话。"); return; }
      this.runtime.setImProject(userId, "feishu", chatId, session.project_id);
      this.runtime.setImConversation(userId, "feishu", chatId, session.id);
      await this.reply(client, messageId, `已切换到会话 #${session.id}：${session.title}`);
      return;
    }
    if (command === "/help") {
      await this.reply(client, messageId, ["AlphaDock IM 指令：", "/new — 归档当前会话并开始新会话", "/status — 查看当前项目与会话", "/projects — 列出项目", "/project <编号|my> — 切换项目", "/sessions — 列出当前项目最近会话", "/session <编号> — 继续指定会话", "/help — 查看指令说明", "普通消息会持续复用当前会话上下文。"].join("\n"));
      return;
    }

    let answer = ""; let conversationId = this.runtime.getImConversation(userId, "feishu", chatId) || undefined;
    const emit = (item: PiStreamEvent) => {
      if (item.type === "meta") conversationId = item.conversationId;
      if (item.type === "delta") answer += item.content;
      if (item.type === "error") answer += `\n${item.message}`;
    };
    try {
      const projectId = this.runtime.getImProject(userId, "feishu", chatId);
      await this.runtime.chat(userId, { message: text, conversationId, projectId }, emit);
      if (conversationId) this.runtime.setImConversation(userId, "feishu", chatId, conversationId);
      await this.reply(client, messageId, answer.trim() || "任务已处理，但没有生成文本结果。");
    } catch (error) {
      this.logger.error(`智能体执行失败 user=${userId} message=${messageId}: ${error instanceof Error ? error.stack : String(error)}`);
      await this.reply(client, messageId, `处理失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async reply(client: Lark.Client, messageId: string, content: string) {
    const chunks = content.match(/[\s\S]{1,3800}/g) || [content];
    for (const text of chunks) await client.im.message.reply({ path: { message_id: messageId }, data: { msg_type: "text", content: JSON.stringify({ text }) } });
  }
}
