# 🐱 猫的第六感 · 中文潜台词解码器

> 粘贴一条消息（或一整段聊天记录），猫猫帮你读出对方没说出口的部分。

占位符团队 · 华清黑客松参赛作品

---

## ✨ 核心功能

| 能力 | 说明 |
|---|---|
| **单条消息解码** | 输入对方发的一句话，输出字面意思、真实情绪、潜台词、建议回复 |
| **整段对话分析** | 粘贴你俩的聊天记录，分析权力动态、沟通死结、关系健康度 |
| **聊天截图识别** | 上传聊天截图，自动 OCR 提取对话内容（基于 stepfun step-3.7-flash 视觉模型）|
| **人物档案系统** | 为不同对象建档（恋人/前任/领导/同事…），同一句话在不同档案下解读不同 |
| **解码历史** | 本地保存最近 50 条解码记录，可回放 |
| **生成分享图** | 把解码结果渲染成 720×1180 的分享卡片，可下载 |
| **沉浸式氛围音** | Web Audio API 实时合成的"电脑主机白噪音"背景音（无音频文件、零版权）|

## 🎯 产品定位

中文沟通有大量"言外之意"。「随便吧」可能是真的没偏好，也可能是已经累到不想做决定；「我没事」往往是求救信号。

猫的第六感把这类消息的**真实情绪**、**对方真正想要**、**潜台词**、**建议回复**一次性解码出来，并以温柔的猫猫话收尾。

## 🛠️ 技术栈

- **前端**：原生 HTML / CSS / JavaScript（零构建、零依赖）
- **后端**：Python 标准库 `http.server`（零依赖、零框架）
- **音频**：Web Audio API 实时合成（白噪声 + 棕噪声 + 粉噪声 + 工频蜂鸣 + 硬盘读写模拟）
- **AI 接口**：StepFun `step-3.7-flash`（多模态，文字解码 + 聊天截图 OCR 共用同一模型）
- **素材**：Canvas 像素猫动画 + `<video>` 切片

## 🚀 本地运行

```bash
cd pixelpet
python server.py
# 访问 http://localhost:8000
```

依赖只有 Python 3.10+ 标准库，无需 pip install。

## ☁️ 部署到 Render

仓库已含 `render.yaml`，Render 后台 **New → Web Service → 连接本仓库** 即可，会自动读取配置：

- runtime: `python`
- startCommand: `python server.py`
- plan: `free`

push 到 `main` 分支会自动触发 Render 重新构建并部署。

### 必须配置的环境变量

部署后**务必**在 Render 后台 **Environment** 面板添加：

| 变量 | 值 | 用途 |
|---|---|---|
| `STEPFUN_KEY` | 你的 stepfun API key（去 [platform.stepfun.com](https://platform.stepfun.com) 申请） | **必需**。文字解码和图片识别都依赖它，不配则所有 AI 功能走兜底预录 |

本地开发时设环境变量：
```bash
# Windows PowerShell
$env:STEPFUN_KEY="你的key"; python server.py

# Git Bash / Linux / macOS
STEPFUN_KEY=你的key python server.py
```

## 📁 目录结构

```
pixelpet/
├── index.html         # 单页应用主结构
├── style.css          # 全部样式（响应式、CRT 扫描线、暗色主题）
├── app.js             # 前端主逻辑（解码、历史、档案、分享图）
├── audio.js           # Web Audio 主机白噪音引擎
├── videocat.js        # 像素猫动画 + 视频切片渲染
├── server.py          # 后端 API（/api/decode, /api/decode_batch, /api/parse_image）
├── cat.mp4            # 像素猫视频素材
├── render.yaml        # Render 部署配置
├── requirements.txt   # 空文件（仅用标准库）
└── start.bat          # Windows 启动脚本
```

## 🔌 API 接口

| 端点 | 入参 | 出参 |
|---|---|---|
| `POST /api/decode` | `{ text, profile }` | `{ surface_meaning, real_emotion, what_they_want, subtext, context_clue, danger_level, suggested_reply, cat_whisper, emotion_tag }` |
| `POST /api/decode_batch` | `{ text }` | `{ power_dynamic, their_hidden_state, your_hidden_state, deadlock, health_level, health_detail, advice, cat_whisper }` |
| `POST /api/parse_image` | `{ image, mime }` | `{ text }` |
| `GET /api/status` | — | `{ model, provider, key_configured }` |
| `GET /api/demos` | — | `{ demos }` |

所有出参 JSON 直出，无 Markdown 包裹。`decode` / `decode_batch` 在网络失败时有本地兜底数据。

## 🧠 Prompt 设计

`SYSTEM_PROMPT` 嵌入了"慧眼侧写引擎"16 条核心规则，包括：

- **散弹枪冷读**：context_clue 必须给出极度具体的细节，让用户起鸡皮疙瘩
- **生存焦虑定律**：所有反常措辞底层都是掩饰匮乏
- **镜像法则**：suggested_reply 必须用绝对尊重解锁对方真实意图
- **危险等级**：green / yellow / red 三档，red 含冷暴力、PUA、情绪勒索
- **危机处理**：涉及自伤/暴力时 cat_whisper 必须建议联系专业资源

## 📝 License

MIT
