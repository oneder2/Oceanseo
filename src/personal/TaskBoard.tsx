import { CalendarDays, CheckCircle2, Circle, Flag, NotebookPen, Plus } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import type { Task } from "../types";
import { personalSnapshot, subscribePersonal } from "./runtime";
import { MAIN, ownershipRank, taskOwnerLabel } from "./model";
export default function PersonalTaskBoard({ tasks, onOpen, onToggle, onNotebook, onNew }: {
  tasks: Task[]; onOpen: (task: Task) => void; onToggle: (id: string) => void;
  onNotebook: (task: Task) => void; onNew: () => void;
}) {
  const doc = useSyncExternalStore(subscribePersonal, personalSnapshot)!;
  const current = doc.workspaces.find(w => w.id === doc.activeId)!;
  const [limit, setLimit] = useState(60);
  const groups = doc.activeId === MAIN ? [{ rank: 0, title: "总体待办", subtitle: "来自所有工作区与待定任务" }] : [
    { rank: 0, title: current.name, subtitle: "归属于当前工作区的任务" },
    { rank: 1, title: "待定", subtitle: "还没有明确的工作区归属" },
    { rank: 2, title: "其他工作区", subtitle: "同一份共享清单中的其他任务" },
  ];
  return <div className="personal-task-board">
    <div className="personal-task-notice"><strong>{current.main ? "所有工作区共享同一份任务" : `${current.name} 的任务优先显示`}</strong><span>更改与完成状态，在所有工作区一致</span></div>
    {groups.map(group => {
      const items = tasks.filter(t => ownershipRank(doc,t.id) === group.rank);
      return <section className="personal-task-group" key={group.rank} aria-label={group.title}>
        <header><div><h2>{group.title}<span>{items.length}</span></h2><p>{group.subtitle}</p></div>{group.rank===0 && <button type="button" onClick={onNew}><Plus size={15}/>添加待办</button>}</header>
        <div className="personal-task-rows">
          {items.slice(0,limit).map(task => <article className={`task-card ${task.completedAt ? "is-completed" : ""}`} key={task.id}>
            <button className="check-button" type="button" onClick={() => onToggle(task.id)} aria-label={task.completedAt ? `恢复计划：${task.title}` : `完成计划：${task.title}`}>{task.completedAt ? <CheckCircle2 size={19}/> : <Circle size={19}/>}</button>
            <button className="task-main" type="button" onClick={() => onOpen(task)}><span className="task-title-row"><strong>{task.title}</strong>{task.priority==="important" && <Flag size={14} aria-label="重要"/>}</span>
              {task.notes && <span className="task-notes">{task.notes}</span>}
              <span className="task-meta"><span className="task-workspace-label">{taskOwnerLabel(doc,task.id)}</span><span>{{short:"短期",mid:"中期",long:"长期"}[task.horizon]}</span>{task.dueDate && <span><CalendarDays size={12}/>{task.dueDate} 截止</span>}</span>
            </button>
            <button className="task-notebook-button" type="button" onClick={() => onNotebook(task)} aria-label={`${task.title}的记事本`}><NotebookPen size={15}/><span>笔记</span></button>
          </article>)}
          {!items.length && <p className="personal-task-group-empty">{group.rank===0 ? "这里还没有待办。记下一件想完成的事。" : "暂无任务"}</p>}
          {items.length>limit && <button className="load-more-tasks" type="button" onClick={()=>setLimit(n=>n+60)}>加载更多 · 还有 {items.length-limit} 项</button>}
        </div>
      </section>;
    })}
  </div>;
}
