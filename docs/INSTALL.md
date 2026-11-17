# NotePP 安装手册

> 应用未做代码签名 / 公证（需要 Apple Developer 与微软证书，年费订阅制），
> 因此首次安装时 macOS / Windows 会给出安全提示。**这是正常现象**，
> 按下面步骤放行即可。文件本体没有问题。

---

## macOS（Apple Silicon）

### 现象

双击打开时提示：

> "NotePP.app"已损坏，无法打开。你应该将它移到废纸篓。

这是 Gatekeeper 对**未公证应用**的标准拦截（下载时给文件打上了隔离属性），
**不要点「移到废纸篓」**。

### 解决办法（三选一）

**方法 1：终端解除隔离（推荐）**

把 NotePP.app 拖入「应用程序」文件夹，然后：

```bash
sudo xattr -rd com.apple.quarantine /Applications/NotePP.app
```

**方法 2：右键打开**

不要双击，**右键（或 Control+点击）→ 打开 → 再点一次「打开」**。

**方法 3：系统设置放行**

`系统设置 → 隐私与安全性`，底部找到「已阻止使用 NotePP」→ 点 **仍要打开**。

### 验证文件完整性（可选）

```bash
codesign -dv /Applications/NotePP.app   # 显示 adhoc 即正常
```

---

## Windows（x64）

### 现象

安装 .msi 或运行 .exe 时出现蓝色 **SmartScreen** 警告：
「Windows 已保护你的电脑」。

### 解决办法

点击 **更多信息 → 仍要运行 / 仍要安装**。

---

## Linux（x64）

### Debian / Ubuntu 及衍生版

```bash
sudo dpkg -i NotePP_0.5.0_amd64.deb
# 缺依赖时补一次：
sudo apt-get install -f
```

### Fedora / RHEL / openSUSE

```bash
sudo rpm -i NotePP-0.5.0-1.x86_64.rpm
# 或
sudo dnf install ./NotePP-0.5.0-1.x86_64.rpm
```

### AppImage（免安装）

```bash
chmod +x NotePP_0.5.0_amd64.AppImage
./NotePP_0.5.0_amd64.AppImage
```

> AppImage 需要系统有 libwebkit2gtk-4.1（Ubuntu 22.04+ / Fedora 38+ 默认满足）。
> 若无法启动，安装依赖：
> `sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0`

---

## 常见问题

| 问题 | 处理 |
|---|---|
| macOS 提示已损坏 | 见上方 macOS 章节，`xattr` 解除隔离 |
| Windows 报毒 / SmartScreen | 未签名应用的标准提示，加入信任即可 |
| Linux AppImage 双击无反应 | `chmod +x` 后从终端运行看报错 |
| 打开中文文件乱码 | 状态栏点击编码切换 UTF-8 / GBK |
| 想要双击即开无提示 | 需要 Apple Developer（$99/年）与 Windows 代码签名证书后由 CI 签名公证 |
