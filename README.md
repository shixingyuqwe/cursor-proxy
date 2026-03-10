# Cursor Proxy

让 Cursor 编辑器通过第三方 API（如 nagara.top）使用 Claude 模型。

GitHub: https://github.com/shixingyuqwe/cursor-proxy

## 前提条件

> **Cursor Pro 用户专属：** 自定义模型接入需要 Cursor Pro 订阅。免费版用户无法添加自定义模型。如果你不使用 Cursor，也可以选择 VS Code + [Continue](https://continue.dev) 或 [Cline](https://github.com/cline/cline) 插件，同样支持自定义 API 接入，且免费。

> **模型可能被自动删除：** Cursor 可能会在更新或多次请求失败后自动移除你手动添加的自定义模型。如果发现模型消失，只需重新到 Settings -> Models -> Add Custom Model 添加并开启即可，无需重新配置其他选项。

## 为什么需要这个？

Cursor Pro 的所有请求都经过 Cursor 云服务器中转。如果你的 API 有 IP 白名单限制，Cursor 的服务器 IP 会被拒绝。本代理解决了这个问题：

```
Cursor --> Cursor 云服务器 --> ngrok --> 你的电脑(代理) --> API 服务
```

## 功能

- OpenAI 格式 <-> Anthropic Messages API 格式自动转换
- 流式响应实时转发
- 重复请求自动去重（解决 Cursor 发送双份请求的问题）
- Web 管理面板（实时日志、配置管理、请求统计）
- 支持 Cursor Agent 模式（工具调用、读写文件等）

## 快速开始

### 1. 克隆并安装

```bash
git clone https://github.com/shixingyuqwe/cursor-proxy.git
cd cursor-proxy
npm install
```

### 2. 配置

复制示例配置文件并编辑：

```bash
cp config.example.json config.json
```

编辑 `config.json`，填入你的 API 信息：

```json
{
  "apiBase": "https://your-api-provider.com",
  "apiKey": "sk-your-api-key-here",
  "model": "claude-opus-4-6",
  "port": 34567
}
```

也可以启动后在 Web 管理面板中修改配置。

### 3. 启动代理

**Windows：** 双击 `start.bat`

**Mac / Linux：**
```bash
node server.js
```

启动后会自动打开浏览器管理面板（`http://localhost:34567`）。

### 4. 启动 ngrok 隧道（必须）

Cursor 的请求经过其云服务器，无法直接访问你的 localhost，所以需要 ngrok 把本地服务暴露到公网。

```bash
# 首次使用：注册 https://ngrok.com 获取 authtoken
ngrok authtoken 你的token

# 启动隧道
ngrok http 34567
```

启动后会得到一个公网地址，如 `https://xxx.ngrok-free.app`。

### 5. 配置 Cursor

打开 Cursor -> Settings -> Models：

| 配置项 | 值 |
|--------|-----|
| **Add Custom Model** | 输入模型名（如 `claude-opus-4-6`）并开启 |
| **OpenAI API Key** | 开启，填 `sk-xxx`（任意值即可，真实 Key 在代理配置中） |
| **Override OpenAI Base URL** | 开启，填 ngrok 地址 + `/v1`，如 `https://xxx.ngrok-free.app/v1` |
| **Anthropic API Key** | 关闭 |

在聊天窗口底部选择对应模型即可使用。

## 管理面板

启动后访问 `http://localhost:34567` 可以看到：

- 服务状态和请求统计（请求总数、去重节省、错误数）
- 在线修改配置（API 地址、Key、模型名、端口）
- 实时请求日志（带颜色标注：绿色成功、红色错误、黄色去重）
- 给同事的 Cursor 配置步骤说明

## 团队使用

只需**一个人**部署代理 + ngrok，团队其他人只需在 Cursor 中做以下配置：

1. Settings -> Models -> **Add Custom Model** -> 输入模型名（如 `claude-opus-4-6`）并开启
2. **OpenAI API Key** -> 开启，填 `sk-xxx`（随意填写）
3. **Override OpenAI Base URL** -> 开启，填共享的 ngrok 地址 + `/v1`
4. 聊天窗口底部选择对应模型

不需要安装任何东西，不需要运行代理，只改 Cursor 设置就行。

## 文件说明

```
cursor-proxy/
├── server.js           # 代理服务主程序
├── admin.html          # Web 管理面板
├── config.json         # 配置文件（首次启动自动生成，已 gitignore）
├── config.example.json # 配置文件示例
├── start.bat           # Windows 一键启动脚本
├── package.json        # 依赖配置
├── .gitignore          # Git 忽略规则
└── README.md           # 本文件
```

## 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| Network Error | ngrok 未运行或地址错误 | 检查 ngrok 和代理是否启动，确认地址正确 |
| IP_NOT_ALLOWED | 请求没走代理 | 确认 Override Base URL 是 ngrok 公网地址 |
| Rate Limit Exceeded | Cursor 发送重复请求 | 通常可忽略，代理已做去重处理 |
| SSRF Blocked | Cursor 设置中填了 localhost | 必须填 ngrok 公网地址，不能填 localhost |
| Invalid API Key | Anthropic API Key 开关被打开 | 关掉 Cursor 设置中的 Anthropic API Key 开关 |
| config.json 不存在 | 首次运行 | 复制 `config.example.json` 为 `config.json` 并填入配置 |

## 技术细节

- 代理监听 `/v1/chat/completions`（OpenAI 格式），自动转换为 Anthropic Messages API `/v1/messages` 格式
- 同时支持 `/v1/messages` 直接透传（Anthropic 原生格式）
- 流式响应从 Anthropic SSE 转换为 OpenAI SSE
- 支持 tool_use / tool_result 格式互转，兼容 Cursor Agent 模式
- 重复请求实时流广播（piggybacking），避免触发上游速率限制
- WebSocket 实时推送日志到 Web 管理面板

## License

MIT
