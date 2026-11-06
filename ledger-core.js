export const MAX_MONEY = 99_999_999_999;
export const MAX_ENTRIES = 100_000;
export const MAX_DETAILS = 100;
export const KINDS = ["expense", "income", "refund", "transferOut", "transferIn"];
export const CHANNELS = ["微信", "支付宝", "银行卡", "现金", "其他"];
export const EXPENSE_CATEGORIES = ["餐饮", "购物", "交通", "居家", "健康", "娱乐", "学习", "旅行", "人情", "其他"];
export const INCOME_CATEGORIES = ["工资", "奖金", "兼职", "投资收益", "其他"];
export const KIND_LABELS = { expense: "消费", income: "收入", refund: "退款", transferOut: "转出", transferIn: "转入" };

const moneyFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function emptyLedger() { return { schemaVersion: 2, entries: [] }; }
export function uuid() { return crypto.randomUUID(); }
export function formatMoney(cents) { return moneyFormatter.format(cents / 100); }
export function moneyInput(cents) { return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`; }

export function parseMoney(input) {
  const value = String(input ?? "").trim();
  if (!/^[0-9]{1,9}(\.[0-9]{1,2})?$/.test(value)) throw new Error("请输入有效金额，最多两位小数（例如 100.50）。");
  const [yuan, fraction = ""] = value.split(".");
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_MONEY) throw new Error("金额必须大于 0，且不超过 999,999,999.99 元。");
  return cents;
}

export function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validDay(value) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 2199) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function monthPeriod(month = today().slice(0, 7)) {
  if (!/^[0-9]{4}-[0-9]{2}$/.test(month)) throw new Error("月份无效。");
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

function cleanText(value, name, maximum, required = true) {
  const text = String(value ?? "").trim();
  if ((required && !text) || text.length > maximum) throw new Error(`${name}${required ? "必填，" : ""}最多 ${maximum.toLocaleString("zh-CN")} 字。`);
  return text;
}

function cleanInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_MONEY) throw new Error(`${name}必须大于 0 且在支持范围内。`);
  return value;
}

function cleanUUID(value, name) {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error(`${name}无效。`);
  return value.toLowerCase();
}

function cleanDetail(detail) {
  return {
    id: cleanUUID(detail?.id, "子账单编号"),
    title: cleanText(detail?.title, "子账单名称", 80),
    cents: cleanInteger(detail?.cents, "子账单金额"),
    note: cleanText(detail?.note ?? "", "子账单备注", 1000, false)
  };
}

function cleanEntry(entry) {
  if (!KINDS.includes(entry?.kind)) throw new Error("交易类型无效。");
  if (!validDay(entry.day)) throw new Error("日期不存在或超出支持范围（1900–2199）。");
  if (!CHANNELS.includes(entry.channel)) throw new Error("支付渠道无效。");
  const originalID = entry.originalID == null ? null : cleanUUID(entry.originalID, "关联记录编号");
  const details = (entry.subentries ?? []).map(cleanDetail);
  if (details.length > MAX_DETAILS) throw new Error("每笔记录最多支持 100 个子账单。");
  const detailIDs = new Set(details.map(item => item.id));
  if (detailIDs.size !== details.length) throw new Error("子账单编号重复，无法保存。");
  const cents = cleanInteger(entry.cents, "记录金额");
  if (details.reduce((sum, item) => sum + item.cents, 0) > cents) throw new Error("子账单合计不能超过主账单总额，请调整子项或总额。");
  const countsAsExpense = Boolean(entry.countsAsExpense);
  if (countsAsExpense && entry.kind !== "transferOut") throw new Error("只有转出记录可以设置“计入消费”。");
  if (entry.kind === "refund" && !originalID) throw new Error("退款必须关联原消费记录。");
  return {
    id: cleanUUID(entry.id, "记录编号"),
    kind: entry.kind,
    cents,
    day: entry.day,
    title: cleanText(entry.title, "名称", 80),
    category: cleanText(entry.category, "分类", 32),
    channel: entry.channel,
    note: cleanText(entry.note ?? "", "备注", 1000, false),
    countsAsExpense,
    ...(originalID ? { originalID } : {}),
    ...(details.length ? { subentries: details } : {})
  };
}

export function validateLedger(input) {
  if (!input || ![1, 2].includes(input.schemaVersion) || !Array.isArray(input.entries)) throw new Error("文件不是有效的净记备份，原账本未改动。");
  if (input.entries.length > MAX_ENTRIES) throw new Error("账本最多支持 100,000 条记录。");
  const entries = input.entries.map(cleanEntry);
  const byID = new Map();
  for (const entry of entries) {
    if (byID.has(entry.id)) throw new Error("账本含有重复记录编号，未导入。");
    byID.set(entry.id, entry);
  }
  const returned = new Map();
  for (const entry of entries) {
    if (!entry.originalID) continue;
    const original = byID.get(entry.originalID);
    if (!original || original.id === entry.id) throw new Error("找不到关联的原记录。");
    if (!((entry.kind === "refund" && original.kind === "expense") || (entry.kind === "transferIn" && original.kind === "transferOut"))) {
      throw new Error("退款只能关联消费；收回款只能关联转出。");
    }
    if (entry.day < original.day) throw new Error("退款或收回日期不能早于原记录。");
    const total = (returned.get(original.id) ?? 0) + entry.cents;
    if (total > original.cents) throw new Error("累计退款或收回金额不能超过原记录金额。");
    returned.set(original.id, total);
  }
  return { schemaVersion: 2, entries };
}

export function saveEntry(ledger, candidate) {
  const entries = ledger.entries.filter(item => item.id.toLowerCase() !== candidate.id.toLowerCase());
  return validateLedger({ schemaVersion: 2, entries: [...entries, candidate] });
}

export function deleteEntry(ledger, id) {
  const key = id.toLowerCase();
  if (ledger.entries.some(item => item.originalID?.toLowerCase() === key)) throw new Error("此记录已有退款或收回款，请先处理关联记录再删除。");
  return validateLedger({ schemaVersion: 2, entries: ledger.entries.filter(item => item.id.toLowerCase() !== key) });
}

export function returnedCents(ledger, id, excludedID = null) {
  const key = id.toLowerCase();
  return ledger.entries.filter(item => item.originalID?.toLowerCase() === key && item.id !== excludedID).reduce((sum, item) => sum + item.cents, 0);
}

export function remainingCents(ledger, original, excludedID = null) {
  return original.cents - returnedCents(ledger, original.id, excludedID);
}

export function summary(ledger, start, end) {
  if (!validDay(start) || !validDay(end) || start > end) throw new Error("统计周期无效。");
  const returned = new Map();
  for (const entry of ledger.entries) if (entry.originalID) returned.set(entry.originalID, (returned.get(entry.originalID) ?? 0) + entry.cents);
  const result = { income: 0, purchases: 0, refunds: 0, markedTransfers: 0, recoveries: 0, categories: {}, net: 0 };
  for (const entry of ledger.entries) {
    if (entry.day < start || entry.day > end) continue;
    if (entry.kind === "income") result.income += entry.cents;
    const consumption = entry.kind === "expense" || (entry.kind === "transferOut" && entry.countsAsExpense);
    if (!consumption) continue;
    const deduction = returned.get(entry.id) ?? 0;
    if (entry.kind === "expense") { result.purchases += entry.cents; result.refunds += deduction; }
    else { result.markedTransfers += entry.cents; result.recoveries += deduction; }
    result.categories[entry.category] = (result.categories[entry.category] ?? 0) + entry.cents - deduction;
  }
  result.net = result.purchases - result.refunds + result.markedTransfers - result.recoveries;
  return result;
}

export function records(ledger, start, end, kinds = KINDS) {
  const allowed = new Set(kinds);
  return ledger.entries.filter(item => item.day >= start && item.day <= end && allowed.has(item.kind))
    .sort((a, b) => b.day.localeCompare(a.day) || a.id.localeCompare(b.id));
}

export function backupObject(ledger) { return validateLedger(ledger); }
