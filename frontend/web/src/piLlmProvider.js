import { BaseProvider } from "@anvaka/vue-llm/providers";

export const PI_RUNTIME_PROVIDER = "pi-runtime";

export class PiRuntimeProvider extends BaseProvider {
  prepareRequest(messages, options = {}) {
    const userMessage = [...messages].reverse().find((item) => item.role === "user")?.content ?? "";
    return {
      sessionId: options.sessionId ?? null,
      roleId: options.roleId ?? null,
      model: options.model ?? this.config.model ?? null,
      modelConfigId: options.modelConfigId ?? null,
      message: userMessage,
    };
  }

  async streamRequest(messages, options, onChunk) {
    const request = this.prepareRequest(messages, options);
    const controller = new AbortController();
    const requestId = options.requestId || this.generateRequestId();
    this.activeRequests.set(requestId, controller);

    try {
      const response = await fetch(this.getStreamingEndpoint(), {
        method: "POST",
        headers: this.buildHeaders(options),
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => "");
        throw new Error(`Pi Runtime API Error (${response.status}): ${body || response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let meta = null;

      const consumeLine = (line) => {
        if (!line.trim()) return;
        const event = this.parseStreamingLine(line);
        if (!event) return;
        if (event.type === "meta") {
          meta = event;
          onChunk?.({ content: "", fullContent, done: false, meta });
          return;
        }
        if (event.type === "delta") {
          const content = event.content ?? "";
          fullContent += content;
          onChunk?.({ content, fullContent, done: false, meta });
          return;
        }
        if (event.type === "error") {
          throw new Error(event.message ?? "Pi Runtime chat failed");
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
        if (done) break;
      }

      if (buffer.trim()) consumeLine(buffer);
      onChunk?.({ content: "", fullContent, done: true, meta, finishReason: "stop" });
      return { content: fullContent, usage: null, meta };
    } catch (error) {
      throw error.name === "AbortError" ? new Error("Request cancelled") : error;
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  buildHeaders(options = {}) {
    const headers = { "Content-Type": "application/json" };
    if (options.jwtToken) headers["x-jwt-token"] = options.jwtToken;
    return headers;
  }

  parseStreamingLine(line) {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }

  extractStreamingContent() {
    return null;
  }

  processResponse(response) {
    return { content: response?.content ?? "" };
  }

  getApiPath() {
    return "/pi/chat";
  }

  getModelsEndpoint() {
    return `${this.config.baseUrl}/settings/model`;
  }

  parseModelsResponse(response) {
    return response?.model ? [response.model] : [];
  }
}
