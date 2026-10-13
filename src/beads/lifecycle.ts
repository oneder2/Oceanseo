import { invoke } from "../personal/invoke";
import { flushAppData, withAppRestore } from "../appDataStore";
import { profileSessionStorage } from "../profileStorage";
import { TRANSFER_NOTICE } from "./transfer";
import type { BeadWork } from "./works";

export type WorkAction = "trash" | "restore" | "purge";
export interface WorkPreview { worksHash: string; work: BeadWork; action: WorkAction }
export async function previewLifecycle(workId: string, action: WorkAction) {
  await flushAppData();
  return invoke<WorkPreview>("preview_bead_lifecycle", { workId, action });
}
export async function commitLifecycle(preview: WorkPreview) {
  return withAppRestore(async () => {
    const receipt = await invoke<{ alreadyDone: boolean; snapshotPath: string | null }>("commit_bead_lifecycle", {
      workId: preview.work.id, action: preview.action, expectedWorksHash: preview.worksHash,
    });
    try { profileSessionStorage.setItem(TRANSFER_NOTICE, preview.action === "trash" ? "作品已移到最近删除，图纸、版本和拼放记录仍可恢复。"
      : preview.action === "restore" ? `作品已恢复到${preview.work.deletedFromArchive ? "已归档" : "进行中的作品"}。`
      : "作品已从当前资料库彻底删除。删除前的安全备份仍保留。"); } catch { /* Native transaction already committed. */ }
    window.location.reload();
    return receipt;
  });
}
