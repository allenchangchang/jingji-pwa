import test from "node:test";
import assert from "node:assert/strict";
import { backupObject, billEntries, billInfo, createBill, deleteEntry, dissolveBill, emptyLedger, MAX_GROUP_DEPTH, MAX_MONEY, mergeBills, parentGroup, renameBill, rootBills, saveEntry, sumAmounts, summary, validateLedger } from "../ledger-core.js";

const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const entry = (number, kind = "expense", cents = 10000, day = "2026-09-01", extra = {}) => ({ id: id(number), kind, cents, day, title: `Record ${number}`, category: "其他", channel: "其他", note: "", countsAsExpense: false, ...extra });
const ledger = (...entries) => validateLedger({ schemaVersion: 2, entries });
const net = (book, month) => summary(book, `${month}-01`, `${month}-30`).net;

test("merging dates and linked refunds preserves every original record and period totals", () => {
  const before = ledger(entry(1), entry(2, "expense", 5000, "2026-10-01"), entry(3, "refund", 3000, "2026-10-02", { originalID: id(1) }));
  const after = mergeBills(before, [id(1), id(2), id(3)], "旅行", id(100));
  assert.deepEqual(after.entries, before.entries);
  assert.deepEqual([net(after, "2026-09"), net(after, "2026-10")], [7000, 5000]);
  assert.equal(rootBills(after).length, 1);
  assert.equal(billInfo(after, id(100)).cents, 12000);
  assert.equal(billEntries(after, id(100)).length, 3);
  assert.deepEqual(dissolveBill(after, id(100)), before);
});

test("merging existing parents creates several levels without duplicate statistics", () => {
  let book = ledger(entry(1), entry(2), entry(3), entry(4));
  book = mergeBills(book, [id(1), id(2)], "酒店", id(101));
  book = mergeBills(book, [id(3), id(4)], "交通", id(102));
  book = mergeBills(book, [id(101), id(102)], "旅行", id(103));
  assert.equal(net(book, "2026-09"), 40000);
  assert.equal(billInfo(book, id(103)).cents, 40000);
  assert.equal(billEntries(book, id(103)).length, 4);
  assert.equal(parentGroup(book, id(101)).id, id(103));
  book = dissolveBill(book, id(101));
  assert.deepEqual(book.groups.find(group => group.id === id(103)).childIDs, [id(1), id(2), id(102)]);
  assert.equal(billEntries(book, id(103)).length, 4);
});

test("new partial and full refunds join their original expense directory", () => {
  let book = mergeBills(ledger(entry(1), entry(2)), [id(1), id(2)], "旅行", id(100));
  book = saveEntry(book, entry(3, "refund", 3000, "2026-10-02", { originalID: id(1) }));
  assert.equal(parentGroup(book, id(3)).id, id(100));
  assert.equal(billInfo(book, id(100)).cents, 17000);
  assert.throws(() => saveEntry(book, entry(4, "refund", 7001, "2026-10-03", { originalID: id(1) })));
  book = saveEntry(book, entry(4, "refund", 7000, "2026-10-03", { originalID: id(1) }));
  assert.equal(billInfo(book, id(100)).cents, 10000);
  assert.throws(() => deleteEntry(book, id(1)));
  assert.equal(billInfo(deleteEntry(book, id(3)), id(100)).cents, 13000);
});

test("multi-amount creation sums integer cents and commits one parent with every input", () => {
  assert.equal(sumAmounts(["0.1", "0.2", "100.50"]), 10080);
  for (const values of [[""], ["-1"], ["1e3"], ["1.001"], ["999999999.99", "0.01"]]) assert.throws(() => sumAmounts(values));
  const entries = [entry(1, "expense", 10), entry(2, "expense", 20), entry(3, "expense", 10050)];
  const book = createBill(emptyLedger(), { id: id(100), title: "多金额", entries });
  assert.equal(rootBills(book).length, 1);
  assert.equal(billInfo(book, id(100)).cents, 10080);
  assert.equal(net(book, "2026-09"), 10080);
  assert.throws(() => createBill(book, { id: id(101), title: "重复", entries }));
});

test("nested child creation, editing, naming and removal retain tree membership", () => {
  let book = createBill(emptyLedger(), { id: id(100), title: "旅行", entries: [entry(1)] });
  book = createBill(book, { id: id(101), title: "酒店", entries: [entry(2), entry(3)], parentID: id(100) });
  book = saveEntry(book, { ...book.entries[1], cents: 15000 });
  assert.equal(parentGroup(book, id(2)).id, id(101));
  book = renameBill(book, id(100), "新旅行");
  assert.equal(book.groups.find(group => group.id === id(100)).title, "新旅行");
  book = deleteEntry(deleteEntry(book, id(2)), id(3));
  assert.equal(book.groups.length, 1);
  assert.deepEqual(book.groups[0].childIDs, [id(1)]);
});

test("incompatible kinds, unrelated refunds and cross-directory merges are rejected", () => {
  const book = ledger(entry(1), entry(2, "income"), entry(3), entry(4, "refund", 1000, "2026-10-02", { originalID: id(3) }));
  assert.throws(() => mergeBills(book, [id(1), id(2)], "混合", id(100)));
  assert.throws(() => mergeBills(book, [id(1), id(4)], "错误退款", id(100)));
  const grouped = mergeBills(book, [id(1), id(3)], "消费", id(100));
  assert.throws(() => mergeBills(grouped, [id(1), id(100)], "父与子", id(101)));
  assert.equal(billInfo(grouped, id(100)).cents, 19000);
});

test("v1/v2 details and relations survive v3 backup round trips", () => {
  const old = ledger(entry(1, "expense", 10000, "2026-09-01", { subentries: [{ id: id(5), title: "部分明细", cents: 3000, note: "保留" }] }), entry(2, "refund", 2000, "2026-10-01", { originalID: id(1) }));
  const book = mergeBills(old, [id(1), id(2)], "消费及退款", id(100));
  const restored = validateLedger(JSON.parse(JSON.stringify(backupObject(book))));
  assert.deepEqual(restored, book);
  assert.deepEqual(restored.entries, old.entries);
  assert.equal(restored.schemaVersion, 3);
});

test("invalid directory files fail before accepting duplicates, cycles, orphan nodes or excessive depth", () => {
  const base = ledger(entry(1));
  const group = (number, children) => ({ id: id(number), title: "父账单", childIDs: children });
  for (const groups of [[group(1, [id(1)])], [group(100, [id(9)])], [group(100, [id(1), id(1)])], [group(100, [id(1)]), group(101, [id(1)])], [group(100, [id(101)]), group(101, [id(100)])], [group(100, [])]]) assert.throws(() => validateLedger({ ...base, groups }));
  let book = { ...base, groups: [] };
  let child = id(1);
  for (let level = 1; level <= MAX_GROUP_DEPTH + 1; level++) { book.groups.push(group(100 + level, [child])); child = id(100 + level); }
  assert.throws(() => validateLedger(book), /层/);
  assert.throws(() => validateLedger({ schemaVersion: 3, entries: [] }));
  assert.throws(() => validateLedger({ schemaVersion: 4, entries: [] }));
  const huge = Array.from({ length: 100000 }, (_, index) => entry(1000 + index, "income", MAX_MONEY));
  assert.throws(() => validateLedger({ schemaVersion: 2, entries: huge }), /精确/);
});
