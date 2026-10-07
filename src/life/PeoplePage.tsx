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
import { useDraft, DraftNotice } from "../drafts";
export type UpdateLife = (update: (data: LifeData) => LifeData) => boolean;
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
  const editor = useDraft<Person>(
    "people",
    () => (data.people[0] ? { ...data.people[0] } : blank()),
    (p) => p.id,
    (p) => data.people.find((saved) => saved.id === p.id) ?? blank(),
  );
  const { value: draft, set: setDraft } = editor;
  const [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [confirmClear, setConfirmClear] = useState(false),
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
    if (
      !update((d) => ({
        ...d,
        people: d.people.some((p) => p.id === person.id)
          ? d.people.map((p) => (p.id === person.id ? person : p))
          : [...d.people, person],
      }))
    )
      return;
    editor.clear();
    setMessage("人物档案已提交，写入结果见顶部保存状态");
  }
  return (
    <section className="life-page people-page" aria-label="人物档案">
      <DraftNotice draft={editor} label={(p) => p.name} />
      <div className="life-intro">
        <Users />
        <div>
          <strong>{data.people.filter(person => !person.archived).length} 份人物档案</strong>
        </div>
      </div>
      <div className="life-split">
        <aside className="life-list">
          <button
            className="primary-button"
            onClick={() => {
              editor.open(blank());
              setConfirmClear(false);
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
                  editor.open({ ...p });
                  setConfirmClear(false);
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
          {data.people.some((p) => p.id === draft.id) && (
            <div className="life-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirmClear(!confirmClear)}
              >
                清除个人信息
              </button>
            </div>
          )}
          {confirmClear && (
            <div className="life-message" role="alert">
              <p>
                清除这位人物的姓名、生日、偏好及全部档案备注，并归档为匿名人物。训练和旅行保留匿名关联。既有计划文本、AI
                服务记录及导出的备份不会随之删除，需要单独检查。
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirmClear(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  const anonymous = {
                    ...blank(),
                    id: draft.id,
                    name: "已清除档案的人物",
                    relationship: "",
                    archived: true,
                  };
                  if (
                    !update((d) => ({
                      ...d,
                      people: d.people.map((p) =>
                        p.id === draft.id ? anonymous : p,
                      ),
                    }))
                  )
                    return;
                  editor.clear();
                  editor.open(anonymous);
                  setConfirmClear(false);
                  setMessage(
                    "个人档案信息已清除，历史计划保留匿名关联；写入结果见顶部",
                  );
                }}
              >
                确认清除个人信息
              </button>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}
