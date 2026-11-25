import { exportHtmlPayload } from "../components/PreviewDialog";
import { embedMediaInHtml } from "./embedMedia";

/**
 * 打印 / 导出 PDF：按当前缩放字号生成带样式文档（v0.30：本地媒体内嵌 base64），
 * 在隐藏 iframe 中调起系统打印对话框（Windows/macOS 打印机里选「另存为 PDF」即可）。
 */
export async function printDocument(
  source: string,
  title: string,
  fontSize: number,
  isMarkdown: boolean,
  mediaDir?: string | null
): Promise<void> {
  const doc = await embedMediaInHtml(exportHtmlPayload(source, title, fontSize, isMarkdown, mediaDir));
  const old = document.getElementById("notepp-print-frame");
  if (old) old.remove();

  const iframe = document.createElement("iframe");
  iframe.id = "notepp-print-frame";
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  if (!win) return;
  win.document.open();
  win.document.write(doc);
  win.document.close();

  // 等样式/图片渲染完成再调起打印
  const go = () => {
    try {
      win.focus();
      win.print();
    } catch {
      // 部分平台禁止 iframe.print，退回主窗口
      window.print();
    }
    // 打印面板关闭后清理（延迟避免中断渲染）
    window.setTimeout(() => iframe.remove(), 60_000);
  };
  if (win.document.readyState === "complete") window.setTimeout(go, 200);
  else iframe.onload = () => window.setTimeout(go, 200);
}
