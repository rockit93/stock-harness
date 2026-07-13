import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { SettingsRepository } from "../settings/settings.repository";
import { HoldingBody, HoldingsRepository } from "./holdings.repository";

@UseGuards(AuthGuard) @Controller("holdings")
export class HoldingsController {
  constructor(@Inject(HoldingsRepository) private readonly holdings: HoldingsRepository, @Inject(SettingsRepository) private readonly settings: SettingsRepository) {}
  @Get() list(@Req() req: AuthenticatedRequest, @Query("type") type = "personal") { return this.holdings.list(Number(req.user.sub), type); }
  @Post() create(@Req() req: AuthenticatedRequest, @Body() body: HoldingBody & { type?: string }) { return this.holdings.upsert(Number(req.user.sub), body.type || "personal", body); }
  @Put(":id") update(@Req() req: AuthenticatedRequest, @Param("id") _id: string, @Body() body: HoldingBody & { type?: string }) { return this.holdings.upsert(Number(req.user.sub), body.type || "personal", body); }
  @Delete(":id") remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) { this.holdings.remove(Number(req.user.sub), Number(id)); return { ok: true }; }
  @Post("import") importRows(@Req() req: AuthenticatedRequest, @Body() body: { holdings?: HoldingBody[] }) { return this.holdings.importMany(Number(req.user.sub), body.holdings || []); }
  @Post("vision-parse") async parse(@Req() req: AuthenticatedRequest, @Body() body: { image?: string; modelConfigId?: number; privateModel?: string }) {
    const userId = Number(req.user.sub); const image = String(body.image || "");
    if (!/^data:image\/(png|jpeg|webp);base64,/i.test(image) || image.length > 12_000_000) throw new BadRequestException("请上传不超过约 8MB 的 PNG、JPG 或 WebP 图片");
    const privateModel = String(body.privateModel || "").trim();
    if (privateModel && !this.settings.isPrivateModelEnabled(privateModel)) throw new BadRequestException("该系统私有模型未启用");
    const privateModelBaseUrl = this.settings.privateModelStates().find((item) => item.model === privateModel)?.base_url || this.settings.getSystemOllamaBaseUrl();
    const model = privateModel
      ? { id: 0, provider: "ollama", model: privateModel, baseUrl: privateModelBaseUrl }
      : this.settings.getModelById(userId, Number(body.modelConfigId || 0));
    const prompt = "识别这张证券账户持仓截图。只输出 JSON，不要 markdown：{\"holdings\":[{\"market\":\"A Share|Hong Kong|US\",\"symbol\":\"股票代码\",\"stockName\":\"名称\",\"shares\":股数,\"costAmount\":总成本金额}],\"warnings\":[\"不确定项\"]}。costAmount 必须是总成本；若截图只有成本价，则用成本价乘股数。不要猜测看不清的数据。";
    let content = "";
    if (model.provider === "ollama") {
      const response = await fetch(`${model.baseUrl.replace(/\/$/, "")}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: model.model, stream: false, format: "json", messages: [{ role: "user", content: prompt, images: [image.split(",", 2)[1]] }] }), signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new BadRequestException(`视觉模型请求失败 (${response.status})`); content = String((await response.json() as any)?.message?.content || "");
    } else {
      const apiKey = this.settings.getModelApiKey(userId, model.id); if (!apiKey) throw new BadRequestException("视觉模型 API Key 未配置");
      const response = await fetch(`${model.baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: model.model, temperature: 0, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: image } }] }] }), signal: AbortSignal.timeout(180_000) });
      if (!response.ok) { const detail = (await response.text()).slice(0, 800); throw new BadRequestException(`视觉模型请求失败 (${response.status})：${detail || "模型不支持图片输入或请求格式不兼容"}`); } content = String((await response.json() as any)?.choices?.[0]?.message?.content || "");
    }
    try { const parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")); return { holdings: Array.isArray(parsed.holdings) ? parsed.holdings : [], warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [], model: model.model }; } catch { throw new BadRequestException("视觉模型未返回有效的持仓数据，请换一张清晰截图重试"); }
  }
}
