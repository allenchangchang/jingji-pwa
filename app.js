import {
  CHANNELS, EXPENSE_CATEGORIES, INCOME_CATEGORIES, KIND_LABELS, KINDS,
  backupObject, deleteEntry, formatMoney, moneyInput, monthPeriod, parseMoney,
  records, remainingCents, returnedCents, saveEntry, summary, today, uuid, validateLedger
} from "./ledger-core.js";
import { loadBeforeRestore, loadLedger, requestPersistentStorage, saveBeforeRestore, saveLedger } from "./storage.js";

const $ = selector => document.querySelector(selector);
const elements = Object.fromEntries([
  "offline-banner", "period-title", "net-amount", "purchase-amount", "refund-amount",
  "marked-transfer-line", "marked-transfer-amount", "recovery-line", "recovery-amount",
  "income-amount", "categories-card", "category-list", "record-filter", "search-input",
  "record-list", "empty-state", "empty-title", "empty-text", "empty-action", "entry-dialog", "entry-form",
  "entry-dialog-title", "entry-amount", "refund-default-hint", "entry-title", "entry-day",
  "entry-channel", "entry-category", "category-row", "counts-row", "counts-as-expense",
  "relation-card", "original-label", "entry-original", "original-summary", "detail-editor-list",
  "detail-totals", "allocated-amount", "unallocated-amount", "entry-note", "detail-dialog",
  "entry-detail", "period-dialog", "period-form", "period-start", "period-end", "settings-dialog",
  "storage-status", "restore-previous", "backup-file", "install-button", "toast"
].map(id => [id, document.getElementById(id)]));

let ledger;
let activeMonth = today().slice(0, 7);
let period = monthPeriod(activeMonth);
let customPeriod = false;
let editingID = null;
let defaultAmountCents = null;
let draftDetails = [];
let deferredInstallPrompt = null;
let toastTimer;

const filterKinds = {
  consumption: ["expense", "refund"], all: KINDS, transfers: ["transferOut", "transferIn"],
  expense: ["expense"], income: ["income"], refund: ["refund"], transferOut: ["transferOut"], transferIn: ["transferIn"]
};
const icons = { expense: "▢", income: "▣", refund: "↩", transferOut: "↗", transferIn: "↙" };

function node(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== "") item.textContent = text;
  return item;
}
function currency(cents, sign = "") { return `${sign}¥${formatMoney(cents)}`; }
function subentries(entry) { return entry.subentries ?? []; }
function entryByID(id) { return ledger.entries.find(item => item.id === id); }
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 2800);
}
function closeDialog(id) { document.getElementById(id).close(); }

function periodLabel() {
  if (customPeriod) return `${period.start} 至 ${period.end}`;
  const [year, month] = activeMonth.split("-");
  return `${year}年${Number(month)}月`;
}

function render() {
  const result = summary(ledger, period.start, period.end);
  elements["period-title"].textContent = periodLabel();
  elements["net-amount"].textContent = currency(result.net);
  elements["purchase-amount"].textContent = currency(result.purchases);
  elements["refund-amount"].textContent = currency(result.refunds, "−");
  elements["income-amount"].textContent = currency(result.income);
  elements["marked-transfer-line"].hidden = result.markedTransfers === 0 && result.recoveries === 0;
  elements["recovery-line"].hidden = result.markedTransfers === 0 && result.recoveries === 0;
  elements["marked-transfer-amount"].textContent = currency(result.markedTransfers, "+");
  elements["recovery-amount"].textContent = currency(result.recoveries, "−");
  renderCategories(result);
  renderRecords();
}

function renderCategories(result) {
  const categories = Object.entries(result.categories).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  elements["categories-card"].hidden = categories.length === 0;
  elements["category-list"].replaceChildren();
  for (const [name, value] of categories) {
    const row = node("div", "category-row");
    const heading = node("div", "category-heading");
    heading.append(node("span", "", name), node("span", "", currency(value)));
    const bar = node("div", "category-bar");
    const fill = node("span");
    fill.style.width = `${Math.min(100, result.net > 0 ? value / result.net * 100 : 0)}%`;
    bar.append(fill); row.append(heading, bar); elements["category-list"].append(row);
  }
}

function searchable(entry) {
  return [entry.title, entry.note, entry.category, entry.channel, ...subentries(entry).flatMap(item => [item.title, item.note])].join(" ").toLocaleLowerCase("zh-CN");
}

function renderRecords() {
  const query = elements["search-input"].value.trim().toLocaleLowerCase("zh-CN");
  const visible = records(ledger, period.start, period.end, filterKinds[elements["record-filter"].value]).filter(item => !query || searchable(item).includes(query));
  elements["record-list"].replaceChildren();
  const grouped = new Map();
  for (const item of visible) grouped.set(item.day, [...(grouped.get(item.day) ?? []), item]);
  for (const [day, entries] of grouped) {
    elements["record-list"].append(node("div", "day-heading", day));
    const group = node("div", "record-group");
    for (const entry of entries) group.append(recordRow(entry));
    elements["record-list"].append(group);
  }
  elements["empty-state"].hidden = visible.length !== 0;
  elements["empty-title"].textContent = ledger.entries.length === 0 ? "从第一笔开始，记清每一分" : "当前筛选下没有流水";
  elements["empty-text"].textContent = ledger.entries.length === 0 ? "原生 App 的旧记录需先在原生净记的设置中导出 JSON 备份，再在这里导入。" : `账本共 ${ledger.entries.length} 笔记录，当前日期、类型或搜索条件下没有匹配记录。`;
  elements["empty-action"].textContent = ledger.entries.length === 0 ? "导入原生 App 账本" : `查看全部 ${ledger.entries.length} 笔记录`;
}

function recordRow(entry) {
  const button = node("button", "record-row");
  button.type = "button"; button.dataset.id = entry.id;
  const icon = node("span", "record-icon", icons[entry.kind]);
  const main = node("span", "record-main");
  main.append(node("span", "record-title", entry.title));
  const meta = entry.kind === "transferOut" ? `转出 · ${entry.countsAsExpense ? "计入消费" : "不计消费"} · ${entry.channel}` :
    entry.kind === "transferIn" ? `${entry.originalID ? "收回款" : "转入"} · ${entry.channel}` : `${KIND_LABELS[entry.kind]} · ${entry.category} · ${entry.channel}`;
  main.append(node("span", "record-meta", meta));
  const details = subentries(entry);
  if (details.length) main.append(node("span", "record-details", `${details.length} 项明细 · ${details.map(item => item.title).join("、")}`));
  const money = node("span", "record-money", `${["income", "refund", "transferIn"].includes(entry.kind) ? "+" : "−"}${formatMoney(entry.cents)}`);
  const returned = returnedCents(ledger, entry.id);
  if (returned) money.append(node("small", "record-deduction", returned === entry.cents ? (entry.kind === "expense" ? "已全额退款" : "已全部收回") : `已抵扣 ${currency(returned)}`));
  button.append(icon, main, money);
  return button;
}

function setSelectOptions(select, values, selected) {
  select.replaceChildren(...values.map(value => {
    const option = node("option", "", value); option.value = value; option.selected = value === selected; return option;
  }));
}

function setKind(kind) {
  const radio = elements["entry-form"].querySelector(`input[name=kind][value=${kind}]`);
  radio.checked = true;
}
function currentKind() { return new FormData(elements["entry-form"]).get("kind"); }

function openEntry({ entry = null, kind = "expense", original = null } = {}) {
  editingID = entry?.id ?? null;
  defaultAmountCents = null;
  draftDetails = structuredClone(subentries(entry ?? {}));
  elements["entry-form"].reset();
  const actualKind = entry?.kind ?? (original?.kind === "expense" ? "refund" : original?.kind === "transferOut" ? "transferIn" : kind);
  setKind(actualKind);
  elements["entry-dialog-title"].textContent = entry ? "编辑记录" : "记一笔";
  elements["entry-amount"].value = entry ? moneyInput(entry.cents) : "";
  elements["entry-title"].value = entry?.title ?? (original ? `${original.title}${original.kind === "expense" ? "退款" : "收回"}` : "");
  elements["entry-day"].value = entry?.day ?? today();
  setSelectOptions(elements["entry-channel"], CHANNELS, entry?.channel ?? original?.channel ?? "其他");
  elements["entry-note"].value = entry?.note ?? "";
  elements["counts-as-expense"].checked = entry?.countsAsExpense ?? false;
  updateEntryForm(actualKind, entry?.category ?? original?.category, entry?.originalID ?? original?.id);
  if (!entry && original?.kind === "expense") defaultAmountCents = remainingCents(ledger, original);
  updateAmountDefault();
  renderDetailEditor();
  elements["entry-dialog"].showModal();
}

function relationCandidates(kind, editingOriginalID) {
  const expected = kind === "refund" ? "expense" : "transferOut";
  return ledger.entries.filter(entry => entry.kind === expected && (entry.id === editingOriginalID || remainingCents(ledger, entry, editingID) > 0)).sort((a, b) => b.day.localeCompare(a.day));
}

function updateEntryForm(kind = currentKind(), requestedCategory = null, requestedOriginalID = null) {
  const categories = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const fallbackCategory = kind === "income" ? "工资" : "其他";
  setSelectOptions(elements["entry-category"], [...new Set([...categories, requestedCategory].filter(Boolean))].sort(), requestedCategory ?? fallbackCategory);
  elements["category-row"].hidden = !["expense", "income", "transferOut"].includes(kind);
  elements["counts-row"].hidden = kind !== "transferOut";
  elements["relation-card"].hidden = !["refund", "transferIn"].includes(kind);
  if (!["refund", "transferIn"].includes(kind)) { defaultAmountCents = null; updateAmountDefault(); return; }
  const placeholder = node("option", "", kind === "refund" ? "请选择原消费" : "不关联（普通转入）");
  placeholder.value = "";
  const options = relationCandidates(kind, requestedOriginalID).map(entry => {
    const option = node("option", "", `${entry.day} · ${entry.title} · 可${kind === "refund" ? "退" : "收回"} ${currency(remainingCents(ledger, entry, editingID))}`);
    option.value = entry.id; option.selected = entry.id === requestedOriginalID; return option;
  });
  elements["entry-original"].replaceChildren(placeholder, ...options);
  elements["original-label"].firstChild.textContent = kind === "refund" ? "关联原消费" : "关联原转出";
  updateOriginalSummary();
}

function updateOriginalSummary() {
  const kind = currentKind();
  const original = entryByID(elements["entry-original"].value);
  if (!original) {
    elements["original-summary"].textContent = kind === "refund" ? "退款必须关联原消费。" : "对方归还之前的转账时选择原转出；其他转入可不关联。";
    if (kind === "refund") defaultAmountCents = null;
  } else {
    const remaining = remainingCents(ledger, original, editingID);
    elements["original-summary"].textContent = `${original.day} · 原金额 ${currency(original.cents)} · 当前剩余${kind === "refund" ? "可退" : "可收回"} ${currency(remaining)}`;
    if (kind === "refund") defaultAmountCents = remaining;
    if (!elements["entry-title"].value.trim()) elements["entry-title"].value = `${original.title}${kind === "refund" ? "退款" : "收回"}`;
  }
  updateAmountDefault();
}

function updateAmountDefault() {
  const kind = currentKind();
  elements["entry-amount"].placeholder = kind === "refund" && defaultAmountCents ? moneyInput(defaultAmountCents) : "0.00";
  const blank = !elements["entry-amount"].value.trim();
  elements["refund-default-hint"].hidden = !(kind === "refund" && defaultAmountCents && blank);
  elements["refund-default-hint"].textContent = defaultAmountCents ? `留空将按 ${currency(defaultAmountCents)} 全额退款` : "";
  updateDetailTotals();
}

function effectiveAmount() {
  const typed = elements["entry-amount"].value.trim();
  if (typed) return parseMoney(typed);
  if (currentKind() === "refund" && defaultAmountCents) return defaultAmountCents;
  throw new Error("请输入金额。");
}

function renderDetailEditor() {
  elements["detail-editor-list"].replaceChildren();
  for (const detail of draftDetails) {
    const row = node("div", "detail-editor"); row.dataset.id = detail.id;
    const title = document.createElement("input"); title.placeholder = "名称，例如酒店"; title.maxLength = 80; title.value = detail.title; title.dataset.field = "title";
    const amount = document.createElement("input"); amount.placeholder = "金额"; amount.inputMode = "decimal"; amount.value = detail.cents ? moneyInput(detail.cents) : ""; amount.dataset.field = "amount";
    const remove = node("button", "delete-detail", "×"); remove.type = "button"; remove.setAttribute("aria-label", `删除${detail.title || "子账单"}`);
    const note = document.createElement("input"); note.className = "detail-note"; note.placeholder = "备注（可选）"; note.maxLength = 1000; note.value = detail.note ?? ""; note.dataset.field = "note";
    row.append(title, amount, remove, note); elements["detail-editor-list"].append(row);
  }
  elements["detail-totals"].hidden = draftDetails.length === 0;
  updateDetailTotals();
}

function syncDetailDraft(target) {
  const row = target.closest(".detail-editor");
  if (!row) return;
  const detail = draftDetails.find(item => item.id === row.dataset.id);
  if (!detail) return;
  if (target.dataset.field === "amount") detail.cents = target.value.trim() ? parseMoney(target.value) : 0;
  else detail[target.dataset.field] = target.value;
  updateDetailTotals();
}

function updateDetailTotals() {
  const allocated = draftDetails.reduce((sum, item) => sum + (Number.isSafeInteger(item.cents) ? item.cents : 0), 0);
  let total = null;
  try { total = effectiveAmount(); } catch { /* invalid/blank non-refund amount */ }
  elements["allocated-amount"].textContent = currency(allocated);
  elements["unallocated-amount"].textContent = total == null ? "先填写主金额" : currency(total - allocated);
  elements["unallocated-amount"].style.color = total != null && allocated > total ? "var(--danger)" : "";
}

async function submitEntry(event) {
  event.preventDefault();
  try {
    syncVisibleDetails();
    const kind = currentKind();
    const originalID = ["refund", "transferIn"].includes(kind) ? elements["entry-original"].value : "";
    const candidate = {
      id: editingID ?? uuid(), kind, cents: effectiveAmount(), day: elements["entry-day"].value,
      title: elements["entry-title"].value, category: ["expense", "income", "transferOut"].includes(kind) ? elements["entry-category"].value : (entryByID(originalID)?.category ?? "其他"),
      channel: elements["entry-channel"].value, note: elements["entry-note"].value,
      countsAsExpense: kind === "transferOut" && elements["counts-as-expense"].checked,
      ...(originalID ? { originalID } : {}), ...(draftDetails.length ? { subentries: draftDetails.map(detail => ({ ...detail })) } : {})
    };
    ledger = saveEntry(ledger, candidate);
    await saveLedger(ledger);
    elements["entry-dialog"].close();
    render(); showToast(editingID ? "记录已更新" : "已记一笔");
  } catch (error) { alert(error.message); }
}

function syncVisibleDetails() {
  for (const row of elements["detail-editor-list"].querySelectorAll(".detail-editor")) {
    for (const input of row.querySelectorAll("input")) syncDetailDraft(input);
  }
}

function detailLine(label, value) {
  const line = node("div", "detail-line"); line.append(node("span", "", label), node("span", "", value)); return line;
}

function openDetail(id) {
  const entry = entryByID(id); if (!entry) return;
  const container = elements["entry-detail"]; container.replaceChildren();
  const hero = node("section", "detail-hero");
  hero.append(node("p", "card-label", KIND_LABELS[entry.kind]), node("p", "section-amount", currency(entry.cents)), node("h3", "", entry.title));
  container.append(hero);
  const basics = node("section", "detail-list");
  basics.append(detailLine("日期", entry.day), detailLine("渠道", entry.channel));
  if (["expense", "income", "transferOut"].includes(entry.kind)) basics.append(detailLine("分类", entry.category));
  if (entry.kind === "transferOut") basics.append(detailLine("统计口径", entry.countsAsExpense ? "计入消费" : "仅记往来，不计消费"));
  if (entry.note) basics.append(detailLine("备注", entry.note));
  container.append(basics);
  if (subentries(entry).length) {
    const details = node("section", "detail-list");
    for (const detail of subentries(entry)) details.append(detailLine(detail.title, currency(detail.cents)));
    details.append(detailLine("未分配金额", currency(entry.cents - subentries(entry).reduce((sum, item) => sum + item.cents, 0))));
    container.append(node("h3", "", `子账单 · ${subentries(entry).length} 项`), details);
  }
  if (["expense", "transferOut"].includes(entry.kind)) {
    const returned = returnedCents(ledger, entry.id);
    const deduction = node("section", "detail-list");
    deduction.append(detailLine(entry.kind === "expense" ? "已退款" : "已收回", currency(returned)), detailLine(entry.countsAsExpense || entry.kind === "expense" ? "剩余净消费" : "尚未抵回金额", currency(entry.cents - returned)));
    container.append(deduction);
    if (returned < entry.cents) {
      const action = node("button", "primary-button", entry.kind === "expense" ? "记一笔退款" : "记一笔收回款");
      action.addEventListener("click", () => { elements["detail-dialog"].close(); openEntry({ original: entry }); });
      container.append(action);
    }
  }
  if (entry.originalID) {
    const original = entryByID(entry.originalID);
    if (original) container.append(node("h3", "", "关联原记录"), detailLine(original.title, `${original.day} · ${currency(original.cents)}`));
  }
  const actions = node("div", "button-stack");
  const edit = node("button", "secondary-button", "编辑记录"); edit.addEventListener("click", () => { elements["detail-dialog"].close(); openEntry({ entry }); });
  const remove = node("button", "secondary-button danger-button", "删除记录"); remove.addEventListener("click", async () => {
    if (!confirm("删除这笔记录？统计会立即重新计算。")) return;
    try { ledger = deleteEntry(ledger, entry.id); await saveLedger(ledger); elements["detail-dialog"].close(); render(); showToast("记录已删除"); }
    catch (error) { alert(error.message); }
  });
  actions.append(edit, remove); container.append(actions);
  elements["detail-dialog"].showModal();
}

function changeMonth(offset) {
  const [year, month] = activeMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  activeMonth = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  period = monthPeriod(activeMonth); customPeriod = false; render();
}

function downloadBackup(object, filename) {
  const blob = new Blob([JSON.stringify(backupObject(object), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showAllRecords() {
  if (ledger.entries.length) {
    let start = ledger.entries[0].day, end = start;
    for (const entry of ledger.entries) {
      if (entry.day < start) start = entry.day;
      if (entry.day > end) end = entry.day;
    }
    period = { start, end }; activeMonth = end.slice(0, 7); customPeriod = true;
  } else {
    activeMonth = today().slice(0, 7); period = monthPeriod(activeMonth); customPeriod = false;
  }
  elements["record-filter"].value = "all";
  elements["search-input"].value = "";
  render();
}

async function importBackup(file) {
  if (!file) return;
  if (file.size > 64 * 1024 * 1024) throw new Error("文件超过 64 MB，无法读取。");
  const candidate = validateLedger(JSON.parse(await file.text()));
  if (!confirm(`备份包含 ${candidate.entries.length} 笔记录，将完整替换当前账本。继续吗？`)) return;
  await saveBeforeRestore(ledger); await saveLedger(candidate); ledger = candidate;
  showAllRecords(); elements["settings-dialog"].close();
  elements["restore-previous"].hidden = false; showToast(`已恢复 ${candidate.entries.length} 笔记录`);
}

function registerEvents() {
  document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => closeDialog(button.dataset.close)));
  $("#previous-month").addEventListener("click", () => changeMonth(-1));
  $("#next-month").addEventListener("click", () => changeMonth(1));
  $("#period-button").addEventListener("click", () => { elements["period-start"].value = period.start; elements["period-end"].value = period.end; elements["period-dialog"].showModal(); });
  $("#use-this-month").addEventListener("click", () => { const value = monthPeriod(); elements["period-start"].value = value.start; elements["period-end"].value = value.end; });
  $("#use-last-month").addEventListener("click", () => { const current = today().slice(0, 7); const [year, month] = current.split("-").map(Number); const date = new Date(Date.UTC(year, month - 2, 1)); const value = monthPeriod(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`); elements["period-start"].value = value.start; elements["period-end"].value = value.end; });
  elements["period-form"].addEventListener("submit", event => { event.preventDefault(); const start = elements["period-start"].value, end = elements["period-end"].value; if (start > end) return alert("结束日期不能早于开始日期。"); period = { start, end }; customPeriod = true; elements["period-dialog"].close(); render(); });
  $("#add-entry").addEventListener("click", () => openEntry());
  elements["empty-action"].addEventListener("click", () => { if (ledger.entries.length) showAllRecords(); else elements["backup-file"].click(); });
  $("#settings-button").addEventListener("click", () => elements["settings-dialog"].showModal());
  $("#show-income").addEventListener("click", () => { elements["record-filter"].value = "income"; elements["search-input"].value = ""; renderRecords(); document.querySelector(".records-section").scrollIntoView({ behavior: "smooth" }); });
  elements["record-filter"].addEventListener("change", renderRecords);
  elements["search-input"].addEventListener("input", renderRecords);
  elements["record-list"].addEventListener("click", event => { const row = event.target.closest(".record-row"); if (row) openDetail(row.dataset.id); });
  elements["entry-form"].addEventListener("submit", submitEntry);
  elements["entry-form"].querySelectorAll("input[name=kind]").forEach(radio => radio.addEventListener("change", () => { defaultAmountCents = null; updateEntryForm(radio.value); renderDetailEditor(); }));
  elements["entry-original"].addEventListener("change", updateOriginalSummary);
  elements["entry-amount"].addEventListener("input", updateAmountDefault);
  $("#add-detail").addEventListener("click", () => { if (draftDetails.length >= 100) return alert("每笔记录最多支持 100 个子账单。"); draftDetails.push({ id: uuid(), title: "", cents: 0, note: "" }); renderDetailEditor(); });
  elements["detail-editor-list"].addEventListener("input", event => { try { syncDetailDraft(event.target); } catch { updateDetailTotals(); } });
  elements["detail-editor-list"].addEventListener("click", event => { const button = event.target.closest(".delete-detail"); if (!button) return; draftDetails = draftDetails.filter(item => item.id !== button.closest(".detail-editor").dataset.id); renderDetailEditor(); });
  $("#export-backup").addEventListener("click", () => { downloadBackup(ledger, `净记备份-${today()}.json`); showToast("备份已导出"); });
  $("#import-backup").addEventListener("click", () => elements["backup-file"].click());
  elements["backup-file"].addEventListener("change", async () => { try { await importBackup(elements["backup-file"].files[0]); } catch (error) { alert(error.message); } finally { elements["backup-file"].value = ""; } });
  elements["restore-previous"].addEventListener("click", async () => { const previous = await loadBeforeRestore(); if (!previous || !confirm("恢复上次导入前的账本？当前账本将被替换。")) return; await saveLedger(previous); ledger = previous; showAllRecords(); elements["settings-dialog"].close(); showToast("已恢复上次导入前账本"); });
  elements["install-button"].addEventListener("click", async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; elements["install-button"].hidden = true; });
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt = event; elements["install-button"].hidden = false; });
  window.addEventListener("online", updateConnectivity); window.addEventListener("offline", updateConnectivity);
}

function updateConnectivity() { elements["offline-banner"].hidden = navigator.onLine; }

async function start() {
  try {
    ledger = await loadLedger();
    setSelectOptions(elements["entry-channel"], CHANNELS, "其他");
    registerEvents(); render(); updateConnectivity();
    elements["restore-previous"].hidden = !(await loadBeforeRestore());
    const persisted = await requestPersistentStorage();
    elements["storage-status"].textContent = persisted ? "账本只保存在此设备，浏览器已允许持久存储。" : "账本只保存在此设备；请定期导出备份，防止卸载或系统清理造成丢失。";
    if ("serviceWorker" in navigator) await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch (error) {
    document.body.replaceChildren(node("main", "empty-state", `账本无法读取：${error.message}`));
  }
}

start();
