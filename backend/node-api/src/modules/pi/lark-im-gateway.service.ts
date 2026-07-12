import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as Lark from "@larksuiteoapi/node-sdk";
import { SettingsRepository } from "../settings/settings.repository";
import { PiRuntimeService, PiStreamEvent } from "./pi-runtime.service";

type MessageEvent = {
  sender?: { sender_id?: { open_id?: string }; sender_type?: string };
  message?: { message_id?: string; chat_id?: string; chat_type?: string; message_type?: string; content?: string; mentions?: unknown[] };
};

@Injectable()
export class LarkImGatewayService implements OnModuleInit {
  private readonly logger = new Logger(LarkImGatewayService.name);
  private readonly seen = new Map<string, number>();
  private readonly conversations = new Map<string, number>();

  constructor(
    @Inject(SettingsRepository) private readonly settings: SettingsRepository,
    @Inject(PiRuntimeService) private readonly runtime: PiRuntimeService,
  ) {}

  onModuleInit() {
    for (const connector of this.settings.listEnabledImConnectors()) this.start(connector.userId, connector.config, connector.appSecret);
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
    const ws = new Lark.WSClient({ ...base, loggerLevel: Lark.LoggerLevel.info });
    void ws.start({ eventDispatcher: dispatcher }).then(() => this.logger.log(`飞书长连接已启动 user=${userId}`)).catch((error) => this.logger.error(`飞书长连接启动失败 user=${userId}: ${error instanceof Error ? error.stack : String(error)}`));
  }

  private async handleMessage(userId: number, client: Lark.Client, event: MessageEvent) {
    const message = event.message; const messageId = String(message?.message_id || ""); const chatId = String(message?.chat_id || "");
    if (!messageId || !chatId || message?.message_type !== "text" || event.sender?.sender_type === "app") return;
    if (message.chat_type !== "p2p" && !(message.mentions?.length)) return;
    const now = Date.now();
    for (const [key, timestamp] of this.seen) if (now - timestamp > 24 * 60 * 60 * 1000) this.seen.delete(key);
    if (this.seen.has(messageId)) return; this.seen.set(messageId, now);
    let text = "";
    try { text = String(JSON.parse(String(message.content || "{}")).text || ""); } catch { text = String(message.content || ""); }
    text = text.replace(/@_user_\d+/g, "").trim();
    if (!text) return;

    let answer = ""; let conversationId = this.conversations.get(`${userId}:${chatId}`);
    const emit = (item: PiStreamEvent) => {
      if (item.type === "meta") conversationId = item.conversationId;
      if (item.type === "delta") answer += item.content;
      if (item.type === "error") answer += `\n${item.message}`;
    };
    try {
      await this.runtime.chat(userId, { message: text, conversationId }, emit);
      if (conversationId) this.conversations.set(`${userId}:${chatId}`, conversationId);
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
