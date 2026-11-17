import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  APP_VERSION,
  getUpdateApi,
  getUpdateToken,
  setUpdateApi,
  setUpdateToken,
  type UpdateInfo,
} from "../lib/update";

interface Props {
  checking: boolean;
  error: string | null;
  info: UpdateInfo | null;
  onCheck: () => void;
  onClose: () => void;
}

export default function UpdateDialog({ checking, error, info, onCheck, onClose }: Props) {
  const [api, setApi] = useState(() => getUpdateApi());
  const [token, setToken] = useState(() => getUpdateToken());
  const [saved, setSaved] = useState(false);

  function saveSource() {
    setUpdateApi(api);
    setUpdateToken(token);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal update-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>检查更新</h2>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="hint">当前版本：v{APP_VERSION}</p>

          {checking ? (
            <div className="ai-loading">
              <span className="spinner" /> 正在查询最新版本…
            </div>
          ) : error ? (
            <div className="msg err">
              {error}
              <p className="hint">
                仓库为私有的时候匿名查询会失败：可在下方填入一个只读 Token，或把「更新源」指向任意返回
                {" "}
                <code>{`{"tag_name":"vX.Y.Z","html_url":"..."}`}</code> 的地址。
              </p>
            </div>
          ) : info ? (
            info.newer ? (
              <div className="msg ok">
                发现新版本 <b>v{info.latest}</b>
                {info.published_at && <span className="hint">（{info.published_at.slice(0, 10)}）</span>}
              </div>
            ) : (
              <div className="msg ok">已是最新版本（v{info.latest}）</div>
            )
          ) : null}

          {info?.newer && info.notes && (
            <details className="ai-source" open>
              <summary>更新说明</summary>
              <pre>{info.notes}</pre>
            </details>
          )}

          <details className="ai-source">
            <summary>更新源设置（私有仓库 / 自建清单）</summary>
            <div className="field" style={{ marginTop: 8 }}>
              <span>检查地址（留空用 GitHub Releases API）</span>
              <input value={api} placeholder="https://api.github.com/repos/tomuchgold/noteapp/releases/latest" onChange={(e) => setApi(e.target.value)} />
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <span>访问 Token（可选，仅读取 release）</span>
              <input type="password" value={token} placeholder="github_pat_..." onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            </div>
            <div className="row-actions" style={{ marginTop: 8 }}>
              <button onClick={saveSource}>保存更新源</button>
              {saved && <span className="hint">已保存，下次检查生效</span>}
            </div>
          </details>
        </div>

        <div className="modal-foot">
          <div className="grow" />
          <button onClick={onCheck} disabled={checking}>
            重新检查
          </button>
          {info?.newer && (
            <button className="primary" onClick={() => void openUrl(info.url)}>
              打开发布页
            </button>
          )}
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
