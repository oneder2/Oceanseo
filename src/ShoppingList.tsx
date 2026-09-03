import { useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Download,
  ListPlus,
  LoaderCircle,
  PackageCheck,
  Pencil,
  Plus,
  Save,
  ShoppingBasket,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { DEFAULT_PURCHASE_CATEGORIES, exportPurchaseItems } from "./shoppingStore";
import type { PurchaseItem, PurchaseItemDraft, PurchaseSource, ShoppingExportFormat } from "./types";

type SourceFilter = "all" | PurchaseSource;

interface Props {
  items: PurchaseItem[];
  onAdd: (draft: PurchaseItemDraft) => boolean;
  onUpdate: (id: string, draft: PurchaseItemDraft) => boolean;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  onClearCompleted: () => void;
  onToast: (message: string) => void;
}

const emptyDraft: PurchaseItemDraft = { name: "", amount: "", category: "其他" };

export default function ShoppingList({ items, onAdd, onUpdate, onDelete, onToggle, onClearCompleted, onToast }: Props) {
  const [draft, setDraft] = useState<PurchaseItemDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<PurchaseItemDraft>(emptyDraft);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [exportFormat, setExportFormat] = useState<ShoppingExportFormat>("markdown");
  const [exporting, setExporting] = useState(false);

  const categories = useMemo(
    () => Array.from(new Set([...DEFAULT_PURCHASE_CATEGORIES, ...items.map((item) => item.category)])),
    [items],
  );
  const filteredItems = useMemo(
    () => items.filter((item) => filter === "all" || item.source === filter),
    [filter, items],
  );
  const groupedItems = useMemo(() => {
    const groups = new Map<string, PurchaseItem[]>();
    for (const item of filteredItems) {
      groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    }
    return Array.from(groups.entries()).map(([category, group]) => ({
      category,
      items: [...group].sort((a, b) => Number(a.checked) - Number(b.checked) || b.createdAt.localeCompare(a.createdAt)),
    }));
  }, [filteredItems]);

  const completedCount = items.filter((item) => item.checked).length;
  const manualCount = items.filter((item) => item.source === "manual").length;
  const aiCount = items.filter((item) => item.source === "ai-recipe").length;

  function addItem(event: React.FormEvent) {
    event.preventDefault();
    if (!onAdd(draft)) return;
    setDraft(emptyDraft);
  }

  function beginEdit(item: PurchaseItem) {
    setEditingId(item.id);
    setEditingDraft({ name: item.name, amount: item.amount, category: item.category });
  }

  function saveEdit(event: React.FormEvent, id: string) {
    event.preventDefault();
    if (onUpdate(id, editingDraft)) setEditingId(null);
  }

  async function handleExport() {
    if (!filteredItems.length) return;
    setExporting(true);
    try {
      const saved = await exportPurchaseItems(filteredItems, exportFormat);
      if (saved) onToast(`采购清单已保存为 ${exportFormat === "csv" ? "CSV" : "Markdown"}`);
    } catch {
      onToast("导出失败，请确认目标位置可写后重试");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="purchase-workspace" aria-label="采购清单">
      <section className="purchase-overview" aria-label="采购进度">
        <div className="purchase-progress-copy">
          <span><ShoppingBasket size={16} />本次采购</span>
          <strong>{items.length ? `${items.length - completedCount} 项待采购` : "清单还是空的"}</strong>
          <p>{items.length ? `已完成 ${completedCount} 项，共 ${items.length} 项` : "先在下方添加物品，或从 AI 食谱导入。"}</p>
        </div>
        <div className="purchase-tally" aria-label="来源统计">
          <span><i className="manual" />手动<strong>{manualCount}</strong></span>
          <span><i className="ai" />AI 食谱<strong>{aiCount}</strong></span>
        </div>
        <div className="purchase-progress-mark" aria-hidden="true">
          <strong>{items.length ? Math.round((completedCount / items.length) * 100) : 0}</strong><span>%</span>
        </div>
      </section>

      <form className="purchase-add-bar" onSubmit={addItem}>
        <span className="purchase-add-icon"><ListPlus size={17} /></span>
        <label className="purchase-name-field"><span>物品</span><input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：番茄" aria-label="物品名称" /></label>
        <label><span>数量</span><input value={draft.amount} maxLength={40} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="2 斤" aria-label="采购数量" /></label>
        <label><span>分类</span><input list="purchase-categories" value={draft.category} maxLength={40} onChange={(event) => setDraft({ ...draft, category: event.target.value })} aria-label="采购分类" /></label>
        <datalist id="purchase-categories">{categories.map((category) => <option value={category} key={category} />)}</datalist>
        <button className="primary-button" type="submit" disabled={!draft.name.trim()}><Plus size={16} />添加</button>
      </form>

      <div className="purchase-toolbar">
        <div className="purchase-source-filter" role="tablist" aria-label="按来源筛选">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")} role="tab" aria-selected={filter === "all"}>全部 <span>{items.length}</span></button>
          <button type="button" className={filter === "manual" ? "active" : ""} onClick={() => setFilter("manual")} role="tab" aria-selected={filter === "manual"}>手动 <span>{manualCount}</span></button>
          <button type="button" className={filter === "ai-recipe" ? "active" : ""} onClick={() => setFilter("ai-recipe")} role="tab" aria-selected={filter === "ai-recipe"}>AI 食谱 <span>{aiCount}</span></button>
        </div>
        <div className="purchase-tools">
          {completedCount > 0 && <button className="purchase-clear" type="button" onClick={onClearCompleted}><PackageCheck size={15} />清除已采购</button>}
          <label className="purchase-export-select"><select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ShoppingExportFormat)} aria-label="导出格式"><option value="markdown">Markdown</option><option value="csv">CSV</option></select><ChevronDown size={13} /></label>
          <button className="secondary-button" type="button" disabled={!filteredItems.length || exporting} onClick={() => void handleExport()}>
            {exporting ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
            {exporting ? "正在保存" : "导出到…"}
          </button>
        </div>
      </div>

      <div className="purchase-ledger">
        {groupedItems.map((group) => (
          <section className="purchase-category" key={group.category}>
            <header><div><span>{group.category}</span><small>{group.items.filter((item) => !item.checked).length} 项待采购</small></div><strong>{String(group.items.length).padStart(2, "0")}</strong></header>
            <div>
              {group.items.map((item) => editingId === item.id ? (
                <form className={`purchase-row purchase-edit-row source-${item.source}`} key={item.id} onSubmit={(event) => saveEdit(event, item.id)}>
                  <span className="purchase-source-rail" aria-hidden="true" />
                  <input value={editingDraft.name} maxLength={80} onChange={(event) => setEditingDraft({ ...editingDraft, name: event.target.value })} aria-label="编辑物品名称" />
                  <input value={editingDraft.amount} maxLength={40} onChange={(event) => setEditingDraft({ ...editingDraft, amount: event.target.value })} aria-label="编辑采购数量" />
                  <input list="purchase-categories" value={editingDraft.category} maxLength={40} onChange={(event) => setEditingDraft({ ...editingDraft, category: event.target.value })} aria-label="编辑采购分类" />
                  <span className="purchase-row-actions"><button type="submit" aria-label="保存修改" title="保存修改"><Save size={15} /></button><button type="button" onClick={() => setEditingId(null)} aria-label="取消修改" title="取消修改"><X size={15} /></button></span>
                </form>
              ) : (
                <article className={`purchase-row source-${item.source} ${item.checked ? "is-checked" : ""}`} key={item.id}>
                  <span className="purchase-source-rail" aria-hidden="true" />
                  <button className="purchase-check-button" type="button" onClick={() => onToggle(item.id)} aria-label={item.checked ? `恢复 ${item.name}` : `已采购 ${item.name}`}>
                    {item.checked ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                  </button>
                  <div className="purchase-item-copy"><strong>{item.name}</strong><span>{item.source === "ai-recipe" ? <><Sparkles size={11} />AI 食谱 · {item.sourceLabel}</> : "手动添加"}</span></div>
                  <span className="purchase-amount">{item.amount || "未填写"}</span>
                  <span className="purchase-row-actions"><button type="button" onClick={() => beginEdit(item)} aria-label={`编辑 ${item.name}`} title="编辑"><Pencil size={14} /></button><button type="button" onClick={() => onDelete(item.id)} aria-label={`删除 ${item.name}`} title="删除"><Trash2 size={14} /></button></span>
                </article>
              ))}
            </div>
          </section>
        ))}

        {!groupedItems.length && (
          <div className="purchase-empty">
            {filter === "ai-recipe" ? <Sparkles size={23} /> : filter === "manual" ? <ListPlus size={23} /> : <ShoppingBasket size={23} />}
            <strong>{filter === "all" ? "开始准备下一次采购" : "这个来源下还没有物品"}</strong>
            <span>{filter === "all" ? "手动添加需要购买的物品，或在 AI 食谱中导入食材。" : "切换到其他来源，或添加新的采购物品。"}</span>
          </div>
        )}
      </div>
    </section>
  );
}
