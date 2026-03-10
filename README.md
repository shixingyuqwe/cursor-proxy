# Cursor Proxy

让 Cursor 编辑器通过第三方 API（如 nagara.top）使用 Claude 模型。

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

### 1. 安装

```bash
git clone <本仓库地址>
cd openai-proxy
npm install
```

### 2. 启动代理

**Windows：** 双击 `start.bat`

**命令行：**
```bash
node server.js
```

启动后会自动打开浏览器管理面板（`http://localhost:34567`），在面板中填入：
- **API 地址**：你的 API Base URL（如 `https://nagara.top`）
- **API Key**：你的 API Key
- **模型名称**：API 支持的模型名（如 `claude-opus-4-6`）

### 3. 启动 ngrok 隧道

```bash
# 首次使用需配置 authtoken（从 https://ngrok.com 注册获取）
ngrok authtoken 你的token

# 启动隧道
ngrok http 34567
```

启动后会得到一个公网地址，如 `https://xxx.ngrok-free.app`。

### 4. 配置 Cursor

打开 Cursor -> Settings -> Models：

| 配置项 | 值 |
|--------|-----|
| **Add Custom Model** | 输入模型名（如 `claude-opus-4-6`） |
| **OpenAI API Key** | 开启，填 `sk-xxx`（任意值） |
| **Override OpenAI Base URL** | 开启，填 ngrok 地址 + `/v1`，如 `https://xxx.ngrok-free.app/v1` |
| **Anthropic API Key** | 关闭 |

在聊天窗口底部选择对应模型即可使用。

## 管理面板

启动后访问 `http://localhost:34567` 可以看到：

- 服务状态和请求统计
- 配置修改（API 地址、Key、模型名）
- 实时请求日志

## 文件说明

```
openai-proxy/
├── server.js      # 代理服务主程序
├── admin.html     # Web 管理面板
├── config.json    # 配置文件（自动生成）
├── start.bat      # Windows 一键启动脚本
├── package.json   # 依赖配置
└── README.md      # 本文件
```

## 团队使用

只需一个人部署代理 + ngrok，其他人只需在 Cursor 中配置：

1. 添加自定义模型名
2. OpenAI API Key 填任意值
3. Override OpenAI Base URL 填共享的 ngrok 地址 + `/v1`

## 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| Network Error | ngrok 未运行或地址错误 | 检查 ngrok 和代理是否启动 |
| IP_NOT_ALLOWED | 没走代理 | 确认 Base URL 是 ngrok 地址 |
| Rate Limit Exceeded | Cursor 重复请求 | 可忽略，代理已做去重 |
| SSRF Blocked | 填了 localhost | 必须填 ngrok 公网地址 |
| Invalid API Key | Anthropic Key 被开启 | 关掉 Anthropic API Key 开关 |

## 技术细节

- 代理监听 `/v1/chat/completions`（OpenAI 格式），自动转换为 Anthropic Messages API `/v1/messages` 格式
- 流式响应从 Anthropic SSE 转换为 OpenAI SSE
- 支持 tool_use/tool_result 格式互转，兼容 Cursor Agent 模式
- WebSocket 实时推送日志到管理面板
