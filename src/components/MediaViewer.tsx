/**
 * v0.30：媒体查看标签——点击文件夹树里的图片/音频/视频，在新标签中以引用方式查看。
 * 只读渲染，不修改原文件；按扩展名决定渲染方式。
 */
import { mediaKindOf, resolveMediaSrc } from "../lib/mediaView";

export default function MediaViewer({ path, name }: { path: string | null; name: string }) {
  const kind = path ? mediaKindOf(path) : null;
  const src = path ? resolveMediaSrc(path, null) : "";
  return (
    <div className="media-viewer">
      <div className="media-viewer-body">
        {kind === "img" && <img className="mv-img" src={src} alt={name} />}
        {kind === "audio" && <audio className="mv-audio" controls src={src} />}
        {kind === "video" && <video className="mv-video" controls src={src} />}
        {!kind && <p className="mv-missing">无法预览该文件：{name}</p>}
      </div>
      <div className="media-viewer-foot">
        <span title={path ?? ""}>🖼 {name}{path ? `　·　${path}` : ""}</span>
        <span className="dim">只读预览（引用原文件，不会修改）</span>
      </div>
    </div>
  );
}
