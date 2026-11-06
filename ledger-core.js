export const MAX_MONEY = 99_999_999_999;
export const MAX_ENTRIES = 100_000;
export const MAX_DETAILS = 100;
export const MAX_GROUP_DEPTH = 8;
export const KINDS = ["expense", "income", "refund", "transferOut", "transferIn"];
export const CHANNELS = ["微信", "支付宝", "银行卡", "现金", "其他"];
export const EXPENSE_CATEGORIES = ["餐饮", "购物", "交通", "居家", "健康", "娱乐", "学习", "旅行", "人情", "其他"];
export const INCOME_CATEGORIES = ["工资", "奖金", "兼职", "投资收益", "其他"];
export const KIND_LABELS = { expense: "消费", income: "收入", refund: "退款", transferOut: "转出", transferIn: "转入" };

const moneyFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function emptyLedger() { return { schemaVersion: 3, entries: [], groups: [] }; }
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

function exactSum(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error("账本金额合计超出精确计算范围。");
  return total;
}

export function sumAmounts(values) {
  if (!Array.isArray(values) || !values.length || values.length > MAX_DETAILS) throw new Error("一次请输入 1 至 100 笔金额。");
  const total = exactSum(values.map(parseMoney));
  if (total > MAX_MONEY) throw new Error("总账单不能超过 999,999,999.99 元。");
  return total;
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

function cleanGroup(group) {
  if (!Array.isArray(group?.childIDs) || !group.childIDs.length || group.childIDs.length > MAX_DETAILS) throw new Error("父账单需包含 1 至 100 项子账单。");
  const childIDs = group.childIDs.map(id => cleanUUID(id, "子账单编号"));
  if (new Set(childIDs).size !== childIDs.length) throw new Error("父账单不能重复包含同一项记录。");
  return { id: cleanUUID(group.id, "父账单编号"), title: cleanText(group.title, "父账单名称", 80), note: cleanText(group.note ?? "", "备注", 1000, false), childIDs };
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
  if (!input || ![1, 2, 3].includes(input.schemaVersion) || !Array.isArray(input.entries)) throw new Error("文件不是有效的净记备份，原账本未改动。");
  if (input.entries.length > MAX_ENTRIES) throw new Error("账本最多支持 100,000 条记录。");
  const entries = input.entries.map(cleanEntry);
  exactSum(entries.map(entry => entry.cents));
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
  if (input.schemaVersion === 3 && !Array.isArray(input.groups)) throw new Error("多级账本缺少父账单目录。");
  const groups = (input.groups ?? []).map(cleanGroup);
  if (groups.length > MAX_ENTRIES) throw new Error("父账单数量超出支持范围。");
  for (const group of groups) {
    if (byID.has(group.id)) throw new Error("账单编号重复，无法读取多级结构。");
    byID.set(group.id, group);
  }
  const parents = new Map();
  for (const group of groups) {
    for (const id of group.childIDs) {
      if (!byID.has(id)) throw new Error("父账单引用了不存在的记录。");
      if (parents.has(id)) throw new Error("一项账单不能同时属于多个父账单。");
      parents.set(id, group.id);
    }
  }
  const visiting = new Set(), checked = new Map();
  function inspect(id) {
    if (visiting.has(id)) throw new Error("账单目录存在循环引用。");
    if (checked.has(id)) return checked.get(id);
    const item = byID.get(id);
    if (!item.childIDs) return { depth: 0, entries: [item] };
    if (visiting.size >= MAX_GROUP_DEPTH) throw new Error(`父账单最多支持 ${MAX_GROUP_DEPTH} 层。`);
    visiting.add(id);
    const children = item.childIDs.map(inspect);
    const depth = 1 + Math.max(...children.map(child => child.depth));
    if (depth > MAX_GROUP_DEPTH) throw new Error(`父账单最多支持 ${MAX_GROUP_DEPTH} 层。`);
    const leaves = children.flatMap(child => child.entries);
    const kinds = new Set(leaves.map(entry => entry.kind));
    if (kinds.size > 1 && [...kinds].some(kind => !["expense", "refund"].includes(kind))) throw new Error("仅同类型账单可以合并；消费及其关联退款可以合并。");
    if (kinds.has("expense") && kinds.has("refund")) {
      const expenseIDs = new Set(leaves.filter(entry => entry.kind === "expense").map(entry => entry.id));
      if (leaves.some(entry => entry.kind === "refund" && !expenseIDs.has(entry.originalID))) throw new Error("消费只能与这些消费自己的退款合并，请一并选择退款对应的原消费。");
    }
    visiting.delete(id);
    const result = { depth, entries: leaves }; checked.set(id, result); return result;
  }
  for (const group of groups) inspect(group.id);
  return { schemaVersion: 3, entries, groups };
}

export function saveEntry(ledger, candidate, parentID = null) {
  const base = validateLedger(ledger), entry = cleanEntry(candidate);
  const exists = base.entries.some(item => item.id === entry.id);
  const entries = base.entries.filter(item => item.id !== entry.id);
  const groups = structuredClone(base.groups);
  const parent = parentID ?? (entry.kind === "refund" ? parentGroup(base, entry.originalID)?.id : null);
  if (!exists && parent) {
    const group = groups.find(item => item.id === parent);
    if (!group) throw new Error("找不到要添加到的父账单。");
    group.childIDs.push(entry.id);
  }
  return validateLedger({ ...base, entries: [...entries, entry], groups });
}

export function deleteEntry(ledger, id) {
  const key = id.toLowerCase();
  if (ledger.entries.some(item => item.originalID?.toLowerCase() === key)) throw new Error("此记录已有退款或收回款，请先处理关联记录再删除。");
  const base = validateLedger(ledger);
  const groups = structuredClone(base.groups);
  let removed = key;
  do {
    for (const group of groups) group.childIDs = group.childIDs.filter(id => id !== removed);
    const empty = groups.find(group => !group.childIDs.length);
    removed = empty?.id;
    if (empty) groups.splice(groups.indexOf(empty), 1);
  } while (removed);
  return validateLedger({ ...base, entries: base.entries.filter(item => item.id !== key), groups });
}

export function parentGroup(ledger, id) { return ledger.groups?.find(group => group.childIDs.includes(id)) ?? null; }

export function rootBills(ledger) {
  const nested = new Set((ledger.groups ?? []).flatMap(group => group.childIDs));
  return [...ledger.entries, ...(ledger.groups ?? [])].filter(item => !nested.has(item.id));
}

export function billEntries(ledger, id) {
  const index = new Map([...ledger.entries, ...(ledger.groups ?? [])].map(item => [item.id, item]));
  const seen = new Set();
  function visit(key) {
    if (seen.has(key)) throw new Error("账单目录存在循环或重复引用。");
    seen.add(key);
    const item = index.get(key);
    if (!item) throw new Error("找不到此账单。");
    return item.childIDs ? item.childIDs.flatMap(visit) : [item];
  }
  return visit(id);
}

export function billInfo(ledger, id) {
  const entries = billEntries(ledger, id);
  const kind = entries.some(entry => entry.kind === "expense") ? "expense" : entries[0].kind;
  const originals = new Set(entries.filter(entry => entry.kind === "expense").map(entry => entry.id));
  const refunds = kind === "expense" ? ledger.entries.filter(entry => entry.kind === "refund" && originals.has(entry.originalID)) : [];
  const grossCents = exactSum(entries.filter(entry => entry.kind === kind).map(entry => entry.cents));
  const refundCents = exactSum(refunds.map(entry => entry.cents));
  let start = entries[0].day, end = start;
  for (const entry of entries) { if (entry.day < start) start = entry.day; if (entry.day > end) end = entry.day; }
  return { entries, kind, grossCents, refundCents, cents: grossCents - refundCents, start, end };
}

export function mergeBills(ledger, ids, title, id = uuid()) {
  const base = validateLedger(ledger);
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > MAX_DETAILS || new Set(ids).size !== ids.length) throw new Error("请选择 2 至 100 项不同账单进行合并。");
  const parentIDs = ids.map(key => parentGroup(base, key)?.id ?? null);
  if (new Set(parentIDs).size !== 1) throw new Error("请选择同一目录下的账单进行合并。");
  for (const key of ids) billEntries(base, key);
  const groups = structuredClone(base.groups);
  groups.push({ id, title, note: "", childIDs: [...ids] });
  if (parentIDs[0]) {
    const parent = groups.find(group => group.id === parentIDs[0]);
    parent.childIDs = parent.childIDs.filter(key => !ids.includes(key)); parent.childIDs.push(id);
  }
  return validateLedger({ ...base, groups });
}

export function createBill(ledger, { id = uuid(), title, note = "", entries, parentID = null }) {
  const base = validateLedger(ledger);
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_DETAILS) throw new Error("一次最多添加 100 笔金额。");
  const known = new Set([...base.entries, ...base.groups].map(item => item.id));
  if (entries.some(entry => known.has(entry.id.toLowerCase()))) throw new Error("新账单不能覆盖现有记录。");
  const groups = structuredClone(base.groups);
  groups.push({ id, title, note, childIDs: entries.map(entry => entry.id) });
  const parent = parentID ?? (entries[0].kind === "refund" ? parentGroup(base, entries[0].originalID)?.id : null);
  if (parent) {
    const target = groups.find(group => group.id === parent);
    if (!target) throw new Error("找不到要添加到的父账单。");
    target.childIDs.push(id);
  }
  return validateLedger({ ...base, entries: [...base.entries, ...entries], groups });
}

export function dissolveBill(ledger, id) {
  const base = validateLedger(ledger), group = base.groups.find(item => item.id === id);
  if (!group) throw new Error("找不到此父账单。");
  const groups = structuredClone(base.groups.filter(item => item.id !== id));
  const parent = groups.find(item => item.childIDs.includes(id));
  if (parent) parent.childIDs = parent.childIDs.flatMap(key => key === id ? group.childIDs : [key]);
  return validateLedger({ ...base, groups });
}

export function renameBill(ledger, id, title) {
  const base = validateLedger(ledger);
  if (!base.groups.some(group => group.id === id)) throw new Error("找不到此父账单。");
  return validateLedger({ ...base, groups: base.groups.map(group => group.id === id ? { ...group, title } : group) });
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
