## NotePP v0.6.1 — 编辑器缩放手势

小版本更新，补全看板任务「编辑器具体样式规则」（rh5hL8）中提出但尚未实现的手势要求。

### 新增
- **Ctrl / ⌘ + 鼠标滚轮缩放字号**：在编辑器区域按住 Ctrl（macOS 为 ⌘）滚动滚轮，字号 11–24px 逐级增减，实时生效
- 缩放结果与「设置 → 字体大小」滑块同源，**自动持久化**，重启后保持

### 关于「行高亮规则」
看板任务中提到的「鼠标点击行高亮，规则是硬回车则为另一行」——CodeMirror 6 的行模型天然以 `\n`（硬回车）切分，`highlightActiveLine` 高亮的就是光标所在的逻辑行：
- 硬回车 → 新行，高亮独立
- 自动换行（软换行）→ 同一逻辑行，高亮连续
即当前行为已符合该规则，可在「设置 → 当前行高亮」开关控制。

### 安装
- macOS（Apple Silicon / Intel）：`.dmg`
- Windows：`.msi` 或 `_x64-setup.exe`
- Linux：`.deb` / `.rpm` / `.AppImage`

> ⚠️ macOS 首次打开若提示「已损坏，无法打开」，是 Gatekeeper 对未签名应用的拦截，非文件损坏。
> 解决方法见 [docs/INSTALL.md](https://github.com/tomuchgold/noteapp/blob/main/docs/INSTALL.md)，最快一条：
> `xattr -cr /Applications/NotePP.app`

### v0.6.0 已含功能（本版延续）
- 三栏布局（分类侧栏 + 文件列表 + 编辑器）
- 文件分类（自定义名称与颜色）
- 文件夹浏览树（懒加载，记住上次根目录）
- 编辑器样式设置面板（字号 / 行高 / Tab 宽 / 换行 / 空白符 / 当前行 / 明暗主题）
