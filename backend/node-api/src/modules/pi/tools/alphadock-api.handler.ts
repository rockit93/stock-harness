import { SubscriptionsRepository } from "../../subscriptions/subscriptions.repository";
import { ToolHandler } from "./tool.types";

type Input = {
  operation: "subscriptions.list" | "subscriptions.create" | "subscriptions.delete";
  parameters?: { id?: number; market?: string; symbol?: string; stockName?: string; remark?: string };
};

export class AlphaDockApiHandler implements ToolHandler<Input> {
  constructor(private readonly subscriptions: SubscriptionsRepository) {}

  async execute(input: Input, context: Parameters<ToolHandler<Input>["execute"]>[1]) {
    const parameters = input?.parameters || {};
    switch (input?.operation) {
      case "subscriptions.list": return this.subscriptions.list(context.userId);
      case "subscriptions.create": return this.subscriptions.create(context.userId, "AlphaDock Agent", {
        market: parameters.market, symbol: parameters.symbol, stockName: parameters.stockName, remark: parameters.remark,
      });
      case "subscriptions.delete":
        if (!Number.isInteger(parameters.id) || Number(parameters.id) <= 0) throw new Error("subscriptions.delete requires a valid id");
        this.subscriptions.remove(context.userId, Number(parameters.id)); return { ok: true };
      default: throw new Error(`Unsupported AlphaDock API operation: ${String(input?.operation || "")}`);
    }
  }
}
