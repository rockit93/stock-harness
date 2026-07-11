# Node API

Node API 是前后端分离架构里的后端入口，使用 NestJS + Fastify。它不托管 Vue 页面，只负责：

- 给 Vue Web 提供统一 HTTP API
- 转发请求到 Python Core
- 签发和验签 JWT
- 通过 `x-jwt-token` 做鉴权
- 用 SQLite 保存用户，后续可迁移 MongoDB
- 预留 agent harness、任务队列、审计日志等扩展位置

## 启动

先启动 Python Core：

```powershell
powershell -ExecutionPolicy Bypass -File ..\python-core\start.ps1
```

再启动 Node API：

```powershell
npm install
npm start
```

或直接使用本服务启动脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

默认地址：

```text
http://127.0.0.1:8787
```

## 接口

```text
GET  /health
POST /auth/register
POST /auth/login
GET  /auth/me
GET  /strategies
POST /backtest
```

`/auth/me`、`/strategies`、`/backtest` 都需要请求头：

```text
x-jwt-token: <token>
```
