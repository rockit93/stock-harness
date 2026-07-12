import { spawn } from "node:child_process";
import path from "node:path";
import { ToolHandler } from "./tool.types";

type Input = { command: string; args?: string[]; cwd?: string; timeoutMs?: number };
const MAX_OUTPUT = 200_000;

export class SystemCommandHandler implements ToolHandler<Input> {
  async execute(input: Input, context: Parameters<ToolHandler<Input>["execute"]>[1]) {
    if (!input || typeof input.command !== "string" || !input.command.trim()) throw new Error("command is required");
    const args = Array.isArray(input.args) ? input.args.map(String) : [];
    const root = path.resolve(context.workspaceRoot);
    const cwd = path.resolve(root, String(input.cwd || "."));
    if (cwd !== root && !cwd.startsWith(root + path.sep)) throw new Error("cwd must stay inside the workspace");
    const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || 30_000, 100), 120_000);
    return await new Promise((resolve, reject) => {
      const child = spawn(input.command, args, { cwd, shell: false, windowsHide: true, env: process.env });
      let stdout = "", stderr = "", truncated = false, timedOut = false;
      const append = (current: string, chunk: Buffer) => {
        const next = current + chunk.toString("utf8");
        if (next.length <= MAX_OUTPUT) return next;
        truncated = true;
        return next.slice(0, MAX_OUTPUT);
      };
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.on("error", reject);
      const stop = () => { timedOut = true; child.kill("SIGKILL"); };
      const timer = setTimeout(stop, timeoutMs);
      context.signal.addEventListener("abort", stop, { once: true });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        context.signal.removeEventListener("abort", stop);
        resolve({ exitCode: code, signal, stdout, stderr, timedOut, truncated });
      });
    });
  }
}
