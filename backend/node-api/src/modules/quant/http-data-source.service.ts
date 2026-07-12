import { BadGatewayException, Inject, Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";
import vm from "node:vm";
import { HttpDataSource, SettingsRepository } from "../settings/settings.repository";

type Source = Required<Pick<HttpDataSource, "id" | "name" | "key" | "baseUrl" | "method" | "authType" | "adapterScript">> & HttpDataSource;

@Injectable()
export class HttpDataSourceService {
  constructor(@Inject(SettingsRepository) private readonly settings: SettingsRepository) {}

  async request(userId: number, capability: string, input: Record<string, unknown>) {
    const market = String(input.market ?? "");
    const configured = this.settings.listHttpDataSources(userId) as Source[];
    const chain = this.settings.get(userId).providerChains[market as "A Share" | "Hong Kong" | "US"] ?? [];
    const candidates = configured
      .filter((source) => source.enabled && source.capabilities?.includes(capability) && source.markets?.includes(market))
      .sort((left, right) => this.rank(chain, left.key!) - this.rank(chain, right.key!));
    const failures: string[] = [];
    for (const source of candidates) {
      try {
        const payload = await this.fetchSource(source, input);
        return { data: this.adapt(source, payload, input), source: source.key };
      } catch (error) {
        failures.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { data: undefined, source: undefined, failures };
  }

  async test(source: HttpDataSource, input: Record<string, unknown>) {
    const payload = await this.fetchSource(source as Source, input);
    return { ok: true, message: "连接与适配校验成功", normalized: this.adapt(source as Source, payload, input), sample: payload };
  }

  private rank(chain: string[], key: string) { const index = chain.indexOf(key); return index < 0 ? Number.MAX_SAFE_INTEGER : index; }

  private async fetchSource(source: Source, input: Record<string, unknown>) {
    let url = source.baseUrl!;
    for (const [key, value] of Object.entries(input)) url = url.replaceAll(`{${key}}`, encodeURIComponent(String(value ?? "")));
    const headers: Record<string, string> = { accept: "application/json", ...(source.headers ?? {}) };
    const config = source.authConfig ?? {};
    const secret = config.secretRef ? process.env[config.secretRef] ?? "" : "";
    if (source.authType !== "none" && !secret) throw new Error(`未找到认证环境变量 ${config.secretRef || "secretRef"}`);
    if (source.authType === "api_key") headers[config.headerName || "x-api-key"] = secret;
    if (source.authType === "bearer") headers.authorization = `Bearer ${secret}`;
    if (source.authType === "hmac") {
      const timestamp = String(Date.now());
      headers[config.timestampHeader || "x-timestamp"] = timestamp;
      headers[config.signatureHeader || "x-signature"] = createHmac(config.algorithm || "sha256", secret).update(`${timestamp}\n${source.method}\n${new URL(url).pathname}`).digest("hex");
    }
    const method = source.method === "POST" ? "POST" : "GET";
    if (method === "GET" && !source.baseUrl!.includes("{")) {
      const target = new URL(url); for (const [key, value] of Object.entries(input)) if (value !== undefined) target.searchParams.set(key, String(value)); url = target.toString();
    }
    if (method === "POST") headers["content-type"] = "application/json";
    const response = await fetch(url, { method, headers, body: method === "POST" ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(12_000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { throw new Error("响应不是有效 JSON"); }
  }

  private adapt(source: Source, payload: unknown, input: Record<string, unknown>) {
    const script = source.adapterScript!.replace(/export\s+default/, "const adapt =");
    const context = vm.createContext({ payload: structuredClone(payload), input: structuredClone(input), result: undefined }, { codeGeneration: { strings: false, wasm: false } });
    new vm.Script(`"use strict"; ${script}; result = adapt(payload, input);`).runInContext(context, { timeout: 500 });
    return this.validate(context.result);
  }

  private validate(value: unknown) {
    const data = value as Record<string, unknown>;
    const bars = Array.isArray(value) ? value : Array.isArray(data?.bars) ? data.bars : null;
    if (bars) return { bars: bars.map((item: any) => ({ date: String(item.date ?? item.timestamp), open: Number(item.open), high: Number(item.high), low: Number(item.low), close: Number(item.close), volume: Number(item.volume ?? 0) })).filter((item) => item.date && [item.open, item.high, item.low, item.close].every(Number.isFinite)) };
    if (Array.isArray(data?.symbols)) return { symbols: data.symbols };
    if (Array.isArray(data?.metrics)) return data;
    throw new BadGatewayException("适配结果不符合系统规范：应返回 bars、symbols 或 metrics");
  }
}
