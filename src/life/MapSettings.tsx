import { useEffect, useState } from "react";
import {
  getMapSettings,
  saveMapSettings,
  type MapSettings as Summary,
} from "./maps";
import { errorText } from "./agent";
export default function MapSettings() {
  const [summary, setSummary] = useState<Summary>({
      configured: false,
      keyHint: null,
    }),
    [key, setKey] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void getMapSettings()
      .then(setSummary)
      .catch((e) => setMessage(errorText(e)));
  }, []);
  async function save(clear = false) {
    setBusy(true);
    try {
      setSummary(await saveMapSettings(key, clear));
      setKey("");
      setMessage(clear ? "地图 Key 已清除" : "地图配置已保存");
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="ai-settings-section life-map-settings"
      aria-label="旅行地图配置"
    >
      <header>
        <div>
          <strong>旅行地图 · 高德 Web 服务</strong>
          <p>
            用于地点检索及步行、驾车路线。国内地点优先；海外地点可能无法检索。底图使用
            OpenStreetMap。
          </p>
        </div>
        <span>
          {summary.configured ? `已配置 ${summary.keyHint}` : "未配置"}
        </span>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          高德 Web 服务 Key
          <input
            type="password"
            autoComplete="off"
            maxLength={512}
            placeholder={
              summary.configured
                ? "留空保留当前 Key"
                : "填写 Web 服务类型 Key（不是 JS API Key）"
            }
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <p>
          Key 保存在本机受限权限文件，不会发送给
          AI，也不进入数据备份。地图查询会把地点发送给高德；路线和价格需在出发前核实。
        </p>
        <div className="life-actions">
          <button className="primary-button" disabled={busy}>
            保存地图配置
          </button>
          {summary.configured && (
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void save(true)}
            >
              清除地图 Key
            </button>
          )}
        </div>
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
