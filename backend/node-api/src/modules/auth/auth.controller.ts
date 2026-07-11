import { Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthGuard, AuthenticatedRequest } from "./auth.guard";

type AuthBody = {
  username?: string;
  password?: string;
  rememberMe?: boolean;
};

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() body: AuthBody) {
    return this.auth.register(body.username, body.password, Boolean(body.rememberMe));
  }

  @Post("login")
  login(@Body() body: AuthBody) {
    return this.auth.login(body.username, body.password, Boolean(body.rememberMe));
  }

  @UseGuards(AuthGuard)
  @Get("me")
  me(@Req() req: AuthenticatedRequest) {
    return {
      user: {
        id: Number(req.user.sub),
        username: req.user.username,
      },
    };
  }
}
