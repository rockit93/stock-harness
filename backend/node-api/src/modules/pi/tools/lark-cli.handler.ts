import { spawn } from "node:child_process";
import { SettingsRepository } from "../../settings/settings.repository";
import { ToolHandler } from "./tool.types";

const MAX_OUTPUT = 100_000;
const WRITE_WORDS = new Set(["send", "create", "update", "delete", "remove", "add", "reply", "upload", "overwrite", "patch", "move", "copy"]);

export class LarkCliHandler implements ToolHandler<{ args: string[] }> {
  constructor(private readonly settings: SettingsRepository) {}
  async execute(input: { args: string[] }, context: Parameters<ToolHandler<{ args: string[] }>["execute"]>[1]) {
    const config = this.settings.getImConnector(context.userId);
    if (!config.enabled) throw new Error("飞书 IM 连接器未启用，请先在系统管理中完成配置");
    const args = Array.isArray(input?.args) ? input.args.map(String) : [];
    if (!args.length || args.some((arg) => arg.includes("\0"))) throw new Error("args is required");
    const isWrite = args.some((arg) => WRITE_WORDS.has(arg.replace(/^\+/, "").toLowerCase()));
    if (isWrite && !config.allowWrite) throw new Error("飞书连接器当前仅允许读取操作");
    return await new Promise((resolve, reject) => {
      const command = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli";
      const child = spawn(command, ["--profile", `alphadock-${context.userId}`, ...args], { shell: false, windowsHide: true, env: process.env });
      let stdout = "", stderr = "", truncated = false;
      const append = (value: string, chunk: Buffer) => { const next = value + chunk.toString("utf8"); if (next.length <= MAX_OUTPUT) return next; truncated = true; return next.slice(0, MAX_OUTPUT); };
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.on("error", reject);
      const stop = () => child.kill("SIGKILL");
      context.signal.addEventListener("abort", stop, { once: true });
      child.on("close", (exitCode) => { context.signal.removeEventListener("abort", stop); resolve({ exitCode, stdout, stderr, truncated }); });
    });
  }
}
