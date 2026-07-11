# stock-harness

关于股票咨询 / 推荐的本地 agent harness。项目定位是量化研究助手，不是自动荐股或投资建议系统。

## 架构

```text
Vue 3 + Vite Web
    -> x-jwt-token
NestJS + Fastify Node API
    -> HTTP JSON
Python FastAPI Core
    -> Backtrader / AkShare / Futu
```

核心分工：

- `vue-web/`: Vue 3 + Vite 前端，前后端分离
- `node-api/`: NestJS + Fastify API，登录鉴权、JWT、SQLite 用户库、agent harness 扩展层
- `src/quant_lab/`: Python 量化核心，行情数据、Backtrader 回测、指标计算

## 启动

在 PowerShell 里进入项目目录，分别启动三层服务：

```powershell
cd C:\Users\Administrator\Documents\Codex\2026-07-11\r\outputs\quant-lab
powershell -ExecutionPolicy Bypass -File .\run_api.ps1
powershell -ExecutionPolicy Bypass -File .\run_node_api.ps1
powershell -ExecutionPolicy Bypass -File .\run_vue.ps1
```

打开 Vue 前端：

```text
http://127.0.0.1:5173
```

服务端口：

- Python Core: `http://127.0.0.1:8765`
- Node API: `http://127.0.0.1:8787`
- Vue Web: `http://127.0.0.1:5173`

## 登录鉴权

Node API 自己签发和验签 JWT。前端和 API 统一使用请求头：

```text
x-jwt-token: <token>
```

认证接口：

```text
POST /auth/register
POST /auth/login
GET  /auth/me
```

用户数据先存在 SQLite：

```text
node-api/data/auth.sqlite
```

该目录已加入 `.gitignore`。后续迁移 MongoDB 时，替换 `SqliteUserRepository` 即可。

## 数据源

页面左侧“行情来源”支持：

- 自动数据源：A 股优先 AkShare，港股/美股优先 AkShare，失败时尝试 yfinance
- Futu OpenD：通过本机或局域网 Futu OpenD 获取历史日 K

使用 Futu 前需要：

1. 安装并启动富途 OpenD。
2. 登录 OpenD，并确认对应市场行情权限可用。
3. 页面选择“Futu OpenD”。
4. 设置 Host 和 Port，默认是 `127.0.0.1:11111`。

Futu 代码格式由系统自动转换：

- A 股 `600519` -> `SH.600519`
- A 股 `000001` -> `SZ.000001`
- 港股 `00700` -> `HK.00700`
- 美股 `AAPL` -> `US.AAPL`

## 项目结构

```text
src/quant_lab/
  api.py                       Python FastAPI Core
  data.py                      A 股、港股、美股数据适配器，含 Futu OpenD
  engine.py                    Backtrader 回测入口
  strategies.py                策略注册表
  metrics.py                   指标工具
  ai.py                        本地 Ollama 客户端
node-api/                      NestJS + Fastify API，SQLite + JWT
vue-web/                       Vue 3 + Vite 前端
.pi/AGENTS.md                  Pi 项目上下文
pi-harness/                    Pi skill 和 prompt 包骨架
```

## 添加策略

在 `src/quant_lab/strategies.py` 里新增 Backtrader 策略，然后注册：

```python
STRATEGIES["my_strategy"] = StrategySpec(
    key="my_strategy",
    label="My Strategy",
    strategy_cls=MyStrategy,
    default_params={"period": 20},
)
```

前端会通过 Node API -> Python Core 读取策略列表。

## Ollama

安装并启动 Ollama 后，拉取本地模型：

```powershell
ollama pull qwen2.5-coder:14b
ollama pull glm4:9b
```

## 范围

本项目仅用于量化研究和学习，不构成投资建议。实盘前必须补齐数据校验、滑点建模、风控、模拟盘、审计日志和券商接口。
