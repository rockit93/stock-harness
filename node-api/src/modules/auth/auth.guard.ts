import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService, JwtPayload } from "./auth.service";

export type AuthenticatedRequest = {
  headers: Record<string, string | string[] | undefined>;
  user: JwtPayload;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers["x-jwt-token"];
    const token = Array.isArray(header) ? header[0] : header;

    if (!token) {
      throw new UnauthorizedException("缺少 x-jwt-token");
    }

    req.user = this.auth.verifyToken(token);
    return true;
  }
}
