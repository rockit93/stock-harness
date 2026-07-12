import crypto from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { SqliteUserRepository } from "./sqlite-user.repository";

export type JwtPayload = {
  sub: string;
  username: string;
  role: "admin" | "user";
  iat: number;
  exp: number;
};

@Injectable()
export class AuthService {
  private readonly jwtSecret = process.env.JWT_SECRET ?? "dev-only-change-me";
  private readonly sessionTokenTtlSeconds = Number(process.env.TOKEN_TTL_SECONDS ?? 60 * 60 * 12);
  private readonly rememberTokenTtlSeconds = 60 * 60 * 24 * 30;

  constructor(@Inject(SqliteUserRepository) private readonly users: SqliteUserRepository) {
    if (this.jwtSecret === "dev-only-change-me") {
      console.warn("JWT_SECRET is using the development default. Set JWT_SECRET for real use.");
    }
  }

  register(usernameInput?: string, passwordInput?: string, rememberMe = false) {
    const { username, password } = this.normalizeAuthBody(usernameInput, passwordInput);
    const existing = this.users.findByUsername(username);
    if (existing) {
      throw new ConflictException("用户名已存在");
    }

    const { passwordHash, salt } = this.hashPassword(password);
    const user = this.users.create(username, passwordHash, salt);
    return {
      token: this.signToken({ sub: String(user.id), username: user.username, role: user.role }, rememberMe),
      expiresIn: rememberMe ? this.rememberTokenTtlSeconds : this.sessionTokenTtlSeconds,
      user: { id: user.id, username: user.username, role: user.role },
    };
  }

  login(usernameInput?: string, passwordInput?: string, rememberMe = false) {
    const { username, password } = this.normalizeAuthBody(usernameInput, passwordInput);
    const user = this.users.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException("用户名或密码错误");
    }

    const { passwordHash } = this.hashPassword(password, user.salt);
    if (!crypto.timingSafeEqual(Buffer.from(passwordHash), Buffer.from(user.passwordHash))) {
      throw new UnauthorizedException("用户名或密码错误");
    }

    return {
      token: this.signToken({ sub: String(user.id), username: user.username, role: user.role }, rememberMe),
      expiresIn: rememberMe ? this.rememberTokenTtlSeconds : this.sessionTokenTtlSeconds,
      user: { id: user.id, username: user.username, role: user.role },
    };
  }

  verifyToken(token: string): JwtPayload {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new UnauthorizedException("无效 token");
    }

    const [header, body, signature] = parts;
    const expected = crypto.createHmac("sha256", this.jwtSecret).update(`${header}.${body}`).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new UnauthorizedException("token 验签失败");
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JwtPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException("token 已过期");
    }
    payload.role = payload.role === "admin" || payload.username.toLowerCase() === "admin" ? "admin" : "user";

    return payload;
  }

  private normalizeAuthBody(usernameInput?: string, passwordInput?: string) {
    const username = String(usernameInput ?? "").trim();
    const password = String(passwordInput ?? "");
    if (username.length < 3) {
      throw new BadRequestException("用户名至少 3 个字符");
    }
    if (password.length < 6) {
      throw new BadRequestException("密码至少 6 个字符");
    }
    return { username, password };
  }

  private signToken(payload: Pick<JwtPayload, "sub" | "username" | "role">, rememberMe: boolean) {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JwtPayload = {
      ...payload,
      iat: now,
      exp: now + (rememberMe ? this.rememberTokenTtlSeconds : this.sessionTokenTtlSeconds),
    };
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
    const signature = crypto.createHmac("sha256", this.jwtSecret).update(`${header}.${body}`).digest("base64url");
    return `${header}.${body}.${signature}`;
  }

  private hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
    const passwordHash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
    return { passwordHash, salt };
  }
}
