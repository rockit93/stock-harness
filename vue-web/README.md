# Vue Web

Vue Web 是 Vite 驱动的独立前端，只调用 Node API，不直接调用 Python Core。

默认地址：

```text
http://127.0.0.1:5173
```

默认 API：

```text
http://127.0.0.1:8787
```

## 启动

```powershell
npm install
npm run dev
```

如需修改 API 地址，创建 `.env.local`：

```text
VITE_API_BASE=http://127.0.0.1:8787
```
