import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Download, LockKeyhole, X } from "lucide-react";
import type { DataBackup, WorkArchive } from "../backupStore";
import { useFocusScope } from "../useFocusScope";
import { colorCode, counts, isPattern, type BeadPattern } from "../beads/model";
import { activeWork, currentPattern, isBeadWorksDocument } from "../beads/works";
import { moduleCatalog, type ModuleId } from "./catalog";
import { can } from "./capabilities";
import "./archive.css";

const labels: Record<string, string> = {
  title:"名称", name:"姓名 / 名称", notes:"笔记", horizon:"计划周期", priority:"优先级",
  start_date:"开始日期", due_date:"截止日期", completed_at:"完成时间", startDate:"开始日期", endDate:"结束日期",
  targetDate:"关键日期", birthday:"生日", relationship:"关系", dietary:"忌口", preferences:"偏好",
  hobbies:"爱好", strengths:"特长", healthNotes:"健康备注", archived:"已归档", exercises:"训练项目",
  sets:"组数", reps:"每组数量", unit:"单位", intervalDays:"间隔天数", cycles:"训练周期数", actual:"实际完成情况",
  training:"训练计划", workouts:"完成记录",
  goal:"目标", advice:"建议", completed:"已完成", date:"日期", origin:"出发地", destination:"目的地",
  budget:"预算", purpose:"目的", transport:"交通", accommodation:"住宿", summary:"概要", stops:"行程安排",
  routes:"路线", address:"地址", days:"每日安排", breakfast:"早餐", lunch:"午餐", dinner:"晚餐",
  planTitle:"食谱名称", weekSummary:"本周说明", shoppingList:"食材清单", amount:"数量", category:"分类",
  checked:"已采购", sourceLabel:"来源", hosts:"主机档案", domains:"域名", services:"服务", providers:"服务商",
  goals:"目标", actions:"行动", conversation:"对话", messages:"消息", content:"内容", text:"内容",
  role:"发言人", status:"状态", understanding:"已梳理的内容", pending:"待确认更改", receipts:"执行记录",
  threads:"对话", decisions:"决策", clarification:"待补充信息", facts:"已知信息", questions:"待确认问题",
  question:"问题", answer:"回答", result:"结果", description:"说明", explanation:"说明", conditions:"执行条件",
  kind:"来源类型", label:"来源名称", reference:"关联引用",
  tables:"历史档案", config:"设置", projects:"项目", scans:"检查历史", scanProjects:"项目检查详情", reports:"总结历史", drafts:"进度草稿", assistant:"助手对话",
  weekly_summary:"每周总结", feedback:"反馈", project_analysis_json:"项目分析", highlight_zh:"中文摘要", highlight_en:"英文摘要", evidence_json:"变更证据",
  path:"项目路径", branch:"分支", workspace_root:"项目根目录", gworkspace_root:"GWorkspace 路径", enabled:"自动检查已启用",
  schedule_weekday:"检查星期（0 为周日）", schedule_time:"检查时间", significance_threshold:"变化阈值", excluded_projects_json:"排除的项目",
  started_at:"开始时间", finished_at:"结束时间", project_count:"项目总数", active_count:"活跃项目数", significant_count:"明显变化项目数",
  target_public_id:"关联项目编号", target_title:"关联项目", last_scanned_at:"最近检查", commit_count:"提交数", changed_file_count:"变更文件数", untracked_file_count:"新增文件数",
  latest_commit:"最近提交", latest_commit_at:"最近提交时间", activity_score:"活跃度", activity_status:"变化状态", commit_titles_json:"提交记录", changed_paths_json:"变更路径", synced_at:"同步时间", sync_error:"同步错误",
};
const internal = new Set(["id", "version", "schemaVersion", "schema_version", "createdAt", "updatedAt", "created_at", "updated_at", "sourceId", "personId", "taskId", "goalId", "planId", "requestId", "persona"]);
const names: Record<string,string> = {short:"短期",mid:"中期",long:"长期",normal:"普通",important:"重要",user:"我",assistant:"小汐",manual:"手动记录",local:"本机记录","ai-recipe":"AI 食谱"};
const enumFields = new Set(["horizon", "priority", "role", "source", "kind"]);

/** Bounded, escaped, read-only rendering of the user's own stored content. */
function ReadValue({ value, depth = 0, field }: { value: unknown; depth?: number; field?: string }) {
  const [limit, setLimit] = useState(30);
  if (value == null || value === "") return <span className="archive-empty-value">未填写</span>;
  if (typeof value === "boolean") return <span>{value ? "是" : "否"}</span>;
  if (typeof value === "string" || typeof value === "number") return <span className="archive-text">{enumFields.has(field ?? "") ? names[String(value)] ?? String(value) : String(value)}</span>;
  if (depth > 10) return <p>内容层级较多，可导出备份查看完整记录。</p>;
  if (Array.isArray(value)) return value.length ? <div className="archive-records">
    {value.slice(0,limit).map((item,index)=><article className="archive-record" key={index}><ReadValue value={item} depth={depth+1} field={field}/></article>)}
    {value.length>limit && <button type="button" className="secondary-button" onClick={()=>setLimit(limit+30)}>继续查看（还有 {value.length-limit} 条）</button>}
  </div> : <span className="archive-empty-value">暂无记录</span>;
  if (typeof value === "object") {
    const fields=Object.entries(value).filter(([key])=>!internal.has(key));
    return <dl className="archive-fields">{fields.map(([key,item])=><div key={key}><dt>{key==="origin"&&item&&typeof item==="object"?"记录来源":labels[key] ?? key}</dt><dd><ReadValue value={item} depth={depth+1} field={key}/></dd></div>)}</dl>;
  }
  return null;
}

function BeadPreview({ pattern }: { pattern: BeadPattern }) {
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const context=canvas.current?.getContext("2d");if(!context)return;
    context.clearRect(0,0,pattern.width*8,pattern.height*8);
    pattern.cells.forEach((index,cell)=>{if(index<0)return;context.fillStyle=pattern.palette[index].hex;context.fillRect(cell%pattern.width*8,Math.floor(cell/pattern.width)*8,8,8)});
  },[pattern]);
  const quantities=counts(pattern);
  return <div className="archive-beads"><h3>{pattern.title}</h3><p>{pattern.width} × {pattern.height} 格 · {quantities.reduce((a,b)=>a+b,0)} 颗豆</p>
    <div className="archive-bead-preview"><canvas ref={canvas} width={pattern.width*8} height={pattern.height*8} role="img" aria-label={`${pattern.title}的只读图纸预览`}/></div>
    <ul className="archive-palette">{pattern.palette.map((color,index)=>quantities[index]>0&&<li key={index}><span style={{background:color.hex}}/><strong>{colorCode(index,pattern)}</strong><span>{color.name}</span><span>{quantities[index]} 颗</span></li>)}</ul>
  </div>;
}

export default function DataArchive({ snapshot, workArchive, workArchiveError, onClose, onExport, onExportWork, exporting, error }: {
  snapshot: DataBackup; workArchive?:WorkArchive; workArchiveError?:string; onClose:()=>void; onExport:()=>void; onExportWork?:()=>void; exporting:boolean; error?:string;
}) {
  const ref=useRef<HTMLElement>(null);
  useFocusScope(true,ref);
  const groups=useMemo(()=>{
    const data=snapshot.appState, life=data["tideplan.life.v1"] as Record<string,unknown> | undefined;
    const works = data["tideplan.bead-works.v1"];
    const beadValue = isBeadWorksDocument(works) ? currentPattern(activeWork(works)) : data["tideplan.bead-pattern.v1"];
    const entries:[ModuleId,unknown][]=[
      ["tasks",snapshot.tasks],["goals",data["tideplan.goals.v1"]||data["tideplan.assistant.v1"]?{goals:data["tideplan.goals.v1"],assistant:data["tideplan.assistant.v1"]}:undefined],
      ["countdowns",data["tideplan.countdowns.v1"]],["people",life?.people],
      ["fitness",{training:life?.training??[],workouts:life?.workouts??[]}],["travel",life?.trips],
      ["meal-planner",data["tideplan.meal-plan.v1"]],["shopping-list",data["tideplan.purchase-list.v1"]],
      ["bead-studio",beadValue],["infrastructure",data["tideplan.infrastructure.v1"]],
      ["work-monitor",workArchive?.tables],
    ];
    return entries.filter(([,value])=>value!==undefined&&value!==null);
  },[snapshot,workArchive]);
  const [selected,setSelected]=useState<ModuleId>(()=>groups.find(([id])=>!can(id))?.[0]??groups[0]?.[0]??"tasks");
  const value=groups.find(([id])=>id===selected)?.[1];
  return <div className="modal-backdrop archive-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!exporting)onClose()}}>
    <section className="data-archive" role="dialog" aria-modal="true" aria-labelledby="archive-title" ref={ref} tabIndex={-1}
      onKeyDown={event=>{if(event.key==="Escape"&&!exporting){event.stopPropagation();onClose()}}}>
      <header className="archive-heading"><div><span><Archive size={16}/>当前资料库 · 只读</span><h2 id="archive-title">已有资料一直在这里</h2><p>工具是否开放，不影响你查看这份本机记录。此处不会编辑、调用 AI 或上传内容。</p></div>
        <button className="icon-button" type="button" aria-label="关闭已有资料" disabled={exporting} onClick={onClose}><X size={20}/></button></header>
      <div className="archive-body"><nav aria-label="已有资料分类">{groups.map(([id])=><button key={id} type="button" aria-current={id===selected?"page":undefined} onClick={()=>setSelected(id)}><span>{moduleCatalog[id].title}</span>{!can(id,"write")&&<LockKeyhole size={14} aria-label="工具受限"/>}</button>)}</nav>
        <div className="archive-reader" key={selected}><h3>{moduleCatalog[selected].title}</h3>{selected==="bead-studio"&&isPattern(value)?<BeadPreview pattern={value}/>:<ReadValue value={value}/>}</div></div>
      <footer>{(error||workArchiveError)&&<p className="backup-error" role="alert">{error||workArchiveError}</p>}<span>{selected==="work-monitor"?"工作历史单独导出为只读档案，不包含在普通恢复备份中。":"显示数据库中已保存的内容。待保存草稿和未迁移旧资料继续保留在原资料库。"}</span><button type="button" className="secondary-button" disabled={exporting} onClick={selected==="work-monitor"?onExportWork:onExport}><Download size={16}/>{exporting?"正在导出…":selected==="work-monitor"?"导出工作历史":"导出备份"}</button></footer>
    </section>
  </div>;
}
