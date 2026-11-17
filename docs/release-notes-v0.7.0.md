## NotePP v0.7.0 — AI 选中文本操作

对应看板任务「增加 ai 功能」。选中任意文本 → 右键 → AI 操作。

### 新增

**右键 AI 菜单（选中文本后生效）**
- 解释这段内容 / 润色改写 / 提炼要点 / 翻译成中文 / 翻译成英文 / 生成代码注释 / 自定义指令…
- 结果弹窗：可直接编辑、复制、**插入到光标**或**替换选中**，显示模型与 token 消耗
- 未配置时菜单会提示「点此设置」，一键直达配置面板

**多厂商 AI 配置（全部走 OpenAI 兼容协议）**
- 内置预设：**DeepSeek**、**Agnes AI**（`apihub.agnes-ai.com/v1`）、**商汤日日新 SenseNova**（`api.sensenova.cn/compatible-mode/v1`）、智谱 GLM、月之暗面 Kimi、通义千问、OpenAI、OpenRouter、Ollama 本地、自定义网关
- 每个厂商的 Key / 地址 / 模型**独立保存**，下拉即切
- 「拉取模型列表」一键从服务商拉取可用模型
- **配置导出 / 导入 JSON**（含 Key，明文，请妥善保管）
- 网络请求走 Rust 侧 reqwest（无 CORS 限制，120s 超时），错误信息带 HTTP 状态与响应摘要

### 安全提示
- API Key 保存在本机 localStorage（明文），导出的配置文件同样是明文
- 建议在服务商后台设置额度上限；不要把导出的 JSON 分享给别人

### 使用方法
1. 菜单栏「AI」→ 选厂商 → 填 API Key（如 Agnes 平台 / 日日新控制台申请）→ 保存
2. 在编辑器选中一段文本 → 右键 → 选择 AI 动作
3. 「自定义指令」输入任意要求，例如「改写成正式邮件语气」「提取所有 URL」

### 安装
- macOS：`NotePP_0.7.0_aarch64.dmg`
- Windows：`.msi` 或 `_x64-setup.exe`
- Linux：`.deb` / `.rpm` / `.AppImage`

> ⚠️ macOS「已损坏」提示是 Gatekeeper 拦截，`xattr -cr /Applications/NotePP.app` 即可，详见 [docs/INSTALL.md](https://github.com/tomuchgold/noteapp/blob/main/docs/INSTALL.md)

### 质量验证
- Rust：`cargo check` 通过；新增 `ai_chat` / `ai_models` 两个命令
- 前端：22 项 Playwright 自动化测试全过（厂商覆盖、Agnes 预设地址、导出/导入往返、右键菜单、调用参数、结果替换写入、无选区不弹菜单、自定义指令）
- 修复：导入配置后提示被误清除的问题

---
- v0.6.2：文件列表可隐藏 + 面板拖宽
- v0.6.1：Ctrl/⌘ + 滚轮缩放字号
- v0.6.0：三栏布局 / 文件分类 / 文件夹树 / 样式设置
