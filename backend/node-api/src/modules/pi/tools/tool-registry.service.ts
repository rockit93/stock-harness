import { Injectable } from "@nestjs/common";
import path from "node:path";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { SystemCommandHandler } from "./system-command.handler";
import { ToolContext, ToolManifest, ToolResult } from "./tool.types";
import { WebFetchHandler } from "./web-fetch.handler";
import { SettingsRepository } from "../../settings/settings.repository";
import { LarkCliHandler } from "./lark-cli.handler";
import { SubscriptionsRepository } from "../../subscriptions/subscriptions.repository";
import { AlphaDockApiHandler } from "./alphadock-api.handler";

@Injectable()
export class ToolRegistryService {
  constructor(private readonly settings: SettingsRepository, private readonly subscriptions: SubscriptionsRepository) {}
  private readonly tools = this.loadTools();

  private loadTools() {
    const root = this.workspaceRoot();
    const packageJson = JSON.parse(readFileSync(path.join(root, "pi-harness", "package.json"), "utf8")) as { pi?: { tools?: string[] } };
    const handlers = { "builtin:system-command": new SystemCommandHandler(), "builtin:web-fetch": new WebFetchHandler(), "builtin:lark-cli": new LarkCliHandler(this.settings), "builtin:alphadock-api": new AlphaDockApiHandler(this.subscriptions) } as const;
    const entries = (packageJson.pi?.tools || []).map((relativePath) => {
      const manifest = JSON.parse(readFileSync(path.join(root, "pi-harness", relativePath), "utf8")) as ToolManifest;
      const handler = handlers[manifest.handler as keyof typeof handlers];
      if (!handler) throw new Error(`No runtime handler registered for ${manifest.handler}`);
      if (!/^[a-z][a-z0-9_]{1,63}$/.test(manifest.name)) throw new Error(`Invalid tool name: ${manifest.name}`);
      return [manifest.name, { manifest, handler }] as const;
    });
    return new Map(entries);
  }

  listForModel(names = this.names()) {
    return [...this.tools.values()].filter(({ manifest }) => names.includes(manifest.name)).map(({ manifest }) => ({ type: "function", function: { name: manifest.name, description: manifest.description, parameters: manifest.inputSchema } }));
  }

  names() { return [...this.tools.keys()]; }

  async execute(name: string, rawInput: string, base: Omit<ToolContext, "workspaceRoot" | "signal">): Promise<ToolResult> {
    const registered = this.tools.get(name);
    const started = performance.now();
    if (!registered) return { ok: false, error: { code: "TOOL_NOT_FOUND", message: `Unknown tool: ${name}` }, metadata: { durationMs: 0 } };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), registered.manifest.timeoutMs);
    try {
      const input = JSON.parse(rawInput || "{}");
      const output = await registered.handler.execute(input, { ...base, workspaceRoot: this.workspaceRoot(), signal: controller.signal });
      return { ok: true, output, metadata: { durationMs: Math.round(performance.now() - started), truncated: Boolean((output as any)?.truncated) } };
    } catch (error) {
      return { ok: false, error: { code: "TOOL_EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error) }, metadata: { durationMs: Math.round(performance.now() - started) } };
    } finally { clearTimeout(timer); }
  }

  private workspaceRoot() {
    return process.env.STOCK_HARNESS_WORKSPACE ? path.resolve(process.env.STOCK_HARNESS_WORKSPACE) : path.resolve(process.cwd(), "../..");
  }
}
