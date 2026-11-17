import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

// Tauri 预期的固定端口；环境变量由 tauri CLI 注入
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // 版本号来自 package.json，发版时只改一处
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // pnpm 符号链接可能让 CodeMirror 核心包被解析为两份模块（instanceof 失效），强制去重
  resolve: {
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/commands",
      "@codemirror/search",
      "@codemirror/autocomplete",
    ],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // Tauri 使用平台自带的 WebView，无需转译旧浏览器
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
