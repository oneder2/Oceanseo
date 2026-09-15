import { useState } from "react";
import { Plus, Users, Archive, Save } from "lucide-react";
import DatePicker from "../DatePicker";
import { dateKey } from "../dateUtils";
import {
  birthdayInfo,
  type LifeData,
  type Person,
  uid,
  validDate,
} from "./model";
import { Choice } from "./Fields";
export type UpdateLife = (update: (data: LifeData) => LifeData) => void;
const blank = (): Person => ({
  id: uid(),
  name: "",
  birthday: "",
  relationship: "自己",
  dietary: "",
  preferences: "",
  hobbies: "",
  strengths: "",
  healthNotes: "",
  notes: "",
  archived: false,
});
export default function PeoplePage({
  data,
  update,
}: {
  data: LifeData;
  update: UpdateLife;
}) {
  const [draft, setDraft] = useState<Person>(() =>
    data.people[0] ? { ...data.people[0] } : blank(),
  );
  const [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [message, setMessage] = useState("");
  const info = birthdayInfo(draft.birthday);
  const field = (key: keyof Person, value: string) =>
    setDraft((p) => ({ ...p, [key]: value }));
  function save() {
    if (!draft.name.trim()) {
      setMessage("请填写姓名");
      return;
    }
    if (
      draft.birthday &&
      (!validDate(draft.birthday) || draft.birthday > dateKey())
    ) {
      setMessage("生日应为有效日期，且不能晚于今天");
      return;
    }
    const person = { ...draft, name: draft.name.trim() };
    update((d) => ({
      ...d,
      people: d.people.some((p) => p.id === person.id)
        ? d.people.map((p) => (p.id === person.id ? person : p))
        : [...d.people, person],
    }));
    setMessage("人物档案已保存");
  }
  return (
    <section className="life-page people-page" aria-label="人物档案">
      <div className="life-intro">
        <Users />
        <div>
          <strong>让计划记得每一个人</strong>
          <p>生日与个人偏好保存于本机。生成计划时，仅使用你选中的人物画像。</p>
        </div>
      </div>
      <div className="life-split">
        <aside className="life-list">
          <button
            className="primary-button"
            onClick={() => {
              setDraft(blank());
              setMessage("");
            }}
          >
            <Plus size={16} />
            新增人物
          </button>
          <label>
            搜索人物
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="姓名或关系"
            />
          </label>
          <label className="life-check">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            显示归档人物
          </label>
          {data.people
            .filter(
              (p) =>
                (archived || !p.archived) &&
                `${p.name}${p.relationship}`.includes(search),
            )
            .map((p) => (
              <button
                className={`life-list-item ${p.id === draft.id ? "selected" : ""}`}
                key={p.id}
                onClick={() => {
                  setDraft({ ...p });
                  setMessage("");
                }}
              >
                <span className="person-avatar">{p.name.slice(0, 1)}</span>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.relationship || "未分类"}
                    {p.archived ? " · 已归档" : ""}
                  </small>
                </span>
              </button>
            ))}
          {!data.people.length && (
            <p className="life-muted">
              从自己的档案开始，也可以记录家人和朋友。
            </p>
          )}
        </aside>
        <form
          className="life-card"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="life-section-head">
            <h2>
              {data.people.some((p) => p.id === draft.id)
                ? "编辑档案"
                : "建立人物档案"}
            </h2>
            <button className="primary-button" type="submit">
              <Save size={16} />
              保存档案
            </button>
          </div>
          <div className="life-form-grid">
            <label>
              姓名
              <input
                required
                maxLength={80}
                value={draft.name}
                onChange={(e) => field("name", e.target.value)}
              />
            </label>
            <Choice
              label="关系"
              value={draft.relationship}
              options={["自己", "家人", "伴侣", "朋友", "同事"]}
              onChange={(s) => field("relationship", s)}
            />
            <DatePicker
              label="公历生日"
              value={draft.birthday}
              onChange={(s) => field("birthday", s)}
            />
            <div className="person-derived">
              <strong>
                {info.age === null ? "年龄待补充" : `${info.age} 岁`}
              </strong>
              <span>
                属相：{info.zodiac} · {info.sign}
              </span>
              <small>属相以农历新年分界；星座按常见公历日期区间。</small>
            </div>
          </div>
          <div className="life-form-grid">
            {(
              [
                ["dietary", "忌口与过敏", "例如：花生过敏、不吃香菜"],
                ["preferences", "个人喜好", "例如：安静住宿、喜欢自然风光"],
                ["hobbies", "爱好", "例如：徒步、摄影、阅读"],
                ["strengths", "特长", "例如：驾驶、急救、语言"],
                [
                  "healthNotes",
                  "训练与出行注意",
                  "例如：膝盖不适、避免长距离步行",
                ],
                ["notes", "私人备注（不发送给 Agent）", ""],
              ] as const
            ).map(([key, label, placeholder]) => (
              <label key={key}>
                {label}
                <textarea
                  maxLength={2000}
                  rows={3}
                  placeholder={placeholder}
                  value={draft[key]}
                  onChange={(e) => field(key, e.target.value)}
                />
              </label>
            ))}
          </div>
          {data.people.some((p) => p.id === draft.id) && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const next = { ...draft, archived: !draft.archived };
                setDraft(next);
                update((d) => ({
                  ...d,
                  people: d.people.map((p) =>
                    p.id === draft.id ? { ...p, archived: next.archived } : p,
                  ),
                }));
                setMessage(
                  next.archived ? "已归档，既有计划仍保留关联" : "已恢复人物",
                );
              }}
            >
              <Archive size={15} />
              {draft.archived ? "恢复人物" : "归档人物"}
            </button>
          )}
          {message && (
            <p role="status" className="life-message">
              {message}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
