# stock-harness

关于股票咨询 / 推荐的本地 agent harness。项目定位是量化研究助手，不是自动荐股或投资建议系统。

## 架构

```text
frontend/web (Vue 3 + Vite)
    -> x-jwt-token
backend/node-api (NestJS + Fastify)
    -> HTTP JSON
backend/python-core (FastAPI + quant core)
    -> Backtrader / AkShare / Futu
```

核心分工：

- `backend/python-core/`: Python 量化核心和 FastAPI 接口，包含行情数据、Backtrader 回测、指标计算
- `backend/node-api/`: NestJS + Fastify API，登录鉴权、JWT、SQLite 用户库、agent harness 扩展层
- `frontend/web/`: Vue 3 + Vite 前端，前后端分离
- `frontend/desktop/`: 桌面端预留目录，待建设

## 启动

推荐使用根目录的统一入口启动本地开发环境：

```bash
python bootstrap.py
# 或只启动单个服务
python bootstrap.py web
# Ollama 已安装时，也可以单独启动
python bootstrap.py ollama
```

Linux / macOS 可以使用 shell 包装：

```bash
bash ./bootstrap.sh
# 或只启动单个服务
bash ./bootstrap.sh web
```

Windows PowerShell 也可以使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1
# 或只启动单个服务
powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1 -Service web
# Ollama 已安装时，也可以单独启动
powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1 -Service ollama
```

统一入口执行 `all` 时会检测 Ollama：已安装且尚未运行则自动执行 `ollama serve`，未安装则跳过；如果 Ollama 已在 `11434` 端口运行，则直接复用现有服务。

默认启动的是开发模式，支持热更新：

- Python Core: `uvicorn --reload`
- Node API: `tsx watch src/main.ts`
- Vue Web: `vite`

如需单独启动某一层服务：

```bash
python backend/python-core/start.py
cd backend/node-api && npm run dev
cd frontend/web && npm run dev
```

When services are started through `bootstrap.py` / `bootstrap.ps1`, runtime logs are written under `logs/`:

```powershell
powershell -ExecutionPolicy Bypass -File .\logs.ps1 all
powershell -ExecutionPolicy Bypass -File .\logs.ps1 python-core -Follow
```

```powershell
powershell -ExecutionPolicy Bypass -File .\backend\python-core\start.ps1
powershell -ExecutionPolicy Bypass -File .\backend\node-api\start.ps1
powershell -ExecutionPolicy Bypass -File .\frontend\web\start.ps1
```

服务端口：

- Python Core: `http://127.0.0.1:8765`
- Node API: `http://127.0.0.1:8787`
- Vue Web: `http://127.0.0.1:5173`

如果启动时报端口占用，通常是上一次开发服务还在运行。先确认占用进程：

```powershell
Get-NetTCPConnection -LocalPort 8765,8787,5173 | Select-Object LocalPort,State,OwningProcess
```

确认是旧服务后再停止：

```powershell
Stop-Process -Id <PID>
```

Linux / macOS：

```bash
lsof -i :8765 -i :8787 -i :5173
kill <PID>
```

也可以只启动没有冲突的单个服务：

```bash
python bootstrap.py web
python bootstrap.py node-api
python bootstrap.py python-core
```

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
backend/node-api/data/auth.sqlite
```

该目录已加入 `.gitignore`。后续迁移 MongoDB 时，替换 `SqliteUserRepository` 即可。

## 数据源

页面左侧“行情来源”支持：

- 自动数据源：支持为 A 股配置 AkShare、Tushare Pro（需用户 Token）、BaoStock、Futu 与 yfinance 主备顺序；港股/美股按已配置路由降级
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
backend/
  python-core/
    start.py
    start.sh
    start.ps1
    requirements.txt
    app.py
    src/quant_lab/
      api.py                 Python FastAPI Core
      data.py                A 股、港股、美股数据适配器，含 Futu OpenD
      engine.py              Backtrader 回测入口
      strategies.py          策略注册表
      metrics.py             指标工具
      ai.py                  本地 Ollama 客户端
  node-api/
    start.sh
    start.ps1
    package.json
    src/                    NestJS + Fastify API，SQLite + JWT
frontend/
  web/
    start.sh
    start.ps1
    package.json
    src/                    Vue 3 + Vite 前端
  desktop/                  桌面端预留
.pi/AGENTS.md               Pi 项目上下文
pi-harness/                 Pi skill 和 prompt 包骨架
```

## 添加策略

在 `backend/python-core/src/quant_lab/strategies.py` 里新增 Backtrader 策略，然后注册：

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
ollama pull deepseek-r1:8b
```

Pi 对话页选择 Ollama 模型配置后，会读取该 Ollama 实例中已安装的模型；可在“具体模型”中直接切换到 `deepseek-r1:8b`。
系统会为每个用户初始化 Qwen 3 8B、Gemma 4 和 DeepSeek R1 8B 三个本地模型模板；用户可以独立选择默认模型、修改或删除自己的配置。

## 范围

本项目仅用于量化研究和学习，不构成投资建议。实盘前必须补齐数据校验、滑点建模、风控、模拟盘、审计日志和券商接口。

## 前端主题规范

AlphaDock 提供三套界面主题，默认主题为 `midnight`：

- `midnight`：深海量化，墨绿色深色主题。
- `obsidian`：曜石终端，蓝黑色深色主题。
- `daylight`：晨雾研究，浅色主题。

主题状态保存在浏览器的 `alphadock-theme` 键中，并通过 `<html data-theme="...">` 和 `html.dark` 应用。主题变量与全局组件适配集中维护在：

```text
frontend/web/src/themes.css
```

开发新页面或组件时必须遵守以下规则：

1. 业务组件使用 `--app-*` 变量，不直接写死页面背景、文字、边框和强调色。
2. 常用变量包括 `--app-bg`、`--app-canvas`、`--app-surface`、`--app-surface-raised`、`--app-border`、`--app-text-strong`、`--app-text-secondary`、`--app-text-muted`、`--app-accent` 和 `--app-hover`。
3. Arco Design 与 Element Plus 的主题覆盖统一写入 `themes.css`；不要在单个页面重复覆盖通用输入框、抽屉、表格或弹窗。
4. 表格 hover 必须覆盖整行，包括固定列、斑马纹单元格和操作列。
5. 深色主题正文与背景必须保持清晰对比；禁止在深色容器中遗留 `#fff`、`white`、`#f8fafc` 等浅色面板。
6. 状态色可以固定，但普通品牌色、选择态和主按钮必须使用当前主题的 accent 变量。
7. 每次新增或修改页面后，至少检查三套主题下的默认态、hover、focus、disabled、selected、drawer/modal 和空状态。

提交前运行：

```bash
cd frontend/web
npm run build
```

可使用下面的命令辅助审计硬编码颜色；结果需要人工判断，登录页插画、涨跌色等允许保留专用颜色：

```bash
rg -n "#[0-9a-fA-F]{3,8}|background:\\s*(white|#fff)" frontend/web/src
```
