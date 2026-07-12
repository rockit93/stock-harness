import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { ToolHandler } from "./tool.types";

type Input = { url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs?: number };
const MAX_BYTES = 2_000_000;

function isPrivateIp(ip: string) {
  const normalized = ip.replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "0.0.0.0") return true;
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

export class WebFetchHandler implements ToolHandler<Input> {
  async execute(input: Input, context: Parameters<ToolHandler<Input>["execute"]>[1]) {
    let url = new URL(String(input?.url || ""));
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, Math.min(Math.max(Number(input.timeoutMs) || 20_000, 100), 60_000));
    try {
      let response: Response | null = null;
      for (let redirects = 0; redirects <= 5; redirects++) {
        await this.assertPublicUrl(url);
        response = await fetch(url, { method: redirects ? "GET" : (input.method || "GET"), headers: { accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.1", "user-agent": "StockHarnessPi/1.0", ...(input.headers || {}) }, body: !redirects && input.method === "POST" ? input.body : undefined, redirect: "manual", signal: controller.signal });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        if (!location || redirects === 5) throw new Error("too many or invalid redirects");
        url = new URL(location, url);
      }
      if (!response) throw new Error("request did not return a response");
      const buffer = new Uint8Array(await response.arrayBuffer());
      const truncated = buffer.byteLength > MAX_BYTES;
      let content = new TextDecoder().decode(buffer.slice(0, MAX_BYTES));
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html")) content = content.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return { status: response.status, finalUrl: response.url, contentType, content, truncated };
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener("abort", abort);
    }
  }

  private async assertPublicUrl(url: URL) {
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("only http and https URLs are supported");
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) throw new Error("private, loopback, and link-local addresses are not allowed");
  }
}
