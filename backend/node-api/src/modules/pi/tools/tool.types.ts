export type ToolRisk = "read" | "write" | "execute" | "network";

export type ToolManifest = {
  name: string;
  version: number;
  description: string;
  risk: ToolRisk;
  timeoutMs: number;
  inputSchema: Record<string, unknown>;
  handler?: string;
};

export type ToolContext = {
  userId: number;
  conversationId: number;
  workspaceRoot: string;
  signal: AbortSignal;
};

export type ToolResult = {
  ok: boolean;
  output?: unknown;
  error?: { code: string; message: string };
  metadata: { durationMs: number; truncated?: boolean };
};

export interface ToolHandler<TInput = unknown> {
  execute(input: TInput, context: ToolContext): Promise<unknown>;
}

export type RegisteredTool = { manifest: ToolManifest; handler: ToolHandler };
