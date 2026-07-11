import { BadGatewayException, Injectable } from "@nestjs/common";

@Injectable()
export class PythonCoreService {
  private readonly baseUrl = process.env.PYTHON_CORE_URL ?? "http://127.0.0.1:8765";

  health() {
    return this.request("/health");
  }

  strategies() {
    return this.request("/strategies");
  }

  backtest(body: unknown) {
    return this.request("/backtest", { method: "POST", body });
  }

  private async request(path: string, options: { method?: string; body?: unknown } = {}) {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: { "content-type": "application/json" },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new BadGatewayException(payload.detail ?? payload.message ?? "Python Core 请求失败");
      }
      return payload;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      throw new BadGatewayException(error instanceof Error ? error.message : String(error));
    }
  }
}
