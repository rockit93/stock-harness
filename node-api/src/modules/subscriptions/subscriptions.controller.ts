import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { SubscriptionsRepository } from "./subscriptions.repository";

type SubscriptionBody = {
  market?: string;
  symbol?: string;
  name?: string;
};

@UseGuards(AuthGuard)
@Controller("subscriptions")
export class SubscriptionsController {
  constructor(@Inject(SubscriptionsRepository) private readonly subscriptions: SubscriptionsRepository) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.subscriptions.list(Number(req.user.sub));
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() body: SubscriptionBody) {
    return this.subscriptions.create(Number(req.user.sub), body);
  }

  @Delete(":id")
  remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.subscriptions.remove(Number(req.user.sub), Number(id));
    return { ok: true };
  }
}
