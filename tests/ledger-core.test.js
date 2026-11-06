import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  backupObject, deleteEntry, emptyLedger, monthPeriod, parseMoney, records,
  remainingCents, saveEntry, summary, validateLedger
} from "../ledger-core.js";

const ids = [
  "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005", "00000000-0000-4000-8000-000000000006"
];
const entry = (id, kind, cents, day, extra = {}) => ({ id, kind, cents, day, title: extra.title ?? kind, category: extra.category ?? "其他", channel: "其他", note: "", countsAsExpense: false, ...extra });

test("money and dates are exact", () => {
  assert.equal(parseMoney("0.29"), 29);
  assert.equal(parseMoney("100.5"), 10050);
  for (const value of ["0", "-1", "1.001", "1e3", "1,000", ""]) assert.throws(() => parseMoney(value));
  assert.deepEqual(monthPeriod("2024-02"), { start: "2024-02-01", end: "2024-02-29" });
});

test("cross-month refunds reduce the original month", () => {
  const purchase = entry(ids[0], "expense", 10000, "2026-09-12", { category: "购物" });
  const refund = entry(ids[1], "refund", 10000, "2026-10-02", { originalID: purchase.id });
  const ledger = validateLedger({ schemaVersion: 2, entries: [purchase, refund] });
  assert.equal(summary(ledger, "2026-09-01", "2026-09-30").net, 0);
  assert.equal(summary(ledger, "2026-10-01", "2026-10-31").net, 0);
  assert.equal(records(ledger, "2026-10-01", "2026-10-31", ["refund"])[0].id, ids[1]);
});

test("transfers and income stay separate from consumption", () => {
  const transfer = entry(ids[0], "transferOut", 10000, "2026-09-12");
  const returned = entry(ids[1], "transferIn", 10000, "2026-10-02", { originalID: transfer.id });
  const salary = entry(ids[2], "income", 1500000, "2026-09-28", { category: "工资" });
  const ledger = validateLedger({ schemaVersion: 2, entries: [transfer, returned, salary] });
  const result = summary(ledger, "2026-09-01", "2026-09-30");
  assert.equal(result.net, 0);
  assert.equal(result.income, 1500000);
  assert.equal(remainingCents(ledger, transfer), 0);
});

test("nested details split but never double count", () => {
  const trip = entry(ids[0], "expense", 200000, "2026-09-20", {
    category: "旅行",
    subentries: [
      { id: ids[3], title: "酒店", cents: 100000, note: "" },
      { id: ids[4], title: "租车", cents: 100000, note: "" }
    ]
  });
  const ledger = validateLedger({ schemaVersion: 2, entries: [trip] });
  assert.equal(summary(ledger, "2026-09-01", "2026-09-30").net, 200000);
  assert.throws(() => validateLedger({ schemaVersion: 2, entries: [{ ...trip, cents: 199999 }] }));
});

test("relations reject over-refunds and protect deletion", () => {
  const purchase = entry(ids[0], "expense", 10000, "2026-09-12");
  let ledger = saveEntry(emptyLedger(), purchase);
  ledger = saveEntry(ledger, entry(ids[1], "refund", 3000, "2026-09-13", { originalID: purchase.id }));
  assert.equal(remainingCents(ledger, purchase), 7000);
  assert.throws(() => saveEntry(ledger, entry(ids[2], "refund", 7001, "2026-09-14", { originalID: purchase.id })));
  assert.throws(() => deleteEntry(ledger, purchase.id));
});

test("blank-default UI flow can save partial then remaining full refund", () => {
  const purchase = entry(ids[0], "expense", 10050, "2026-09-12");
  let ledger = saveEntry(emptyLedger(), purchase);
  ledger = saveEntry(ledger, entry(ids[1], "refund", 3050, "2026-09-13", { originalID: purchase.id }));
  assert.equal(remainingCents(ledger, purchase), 7000);
  ledger = saveEntry(ledger, entry(ids[2], "refund", remainingCents(ledger, purchase), "2026-09-14", { originalID: purchase.id }));
  assert.equal(summary(ledger, "2026-09-01", "2026-09-30").net, 0);
});

test("native v1 backups migrate and v2 backups round-trip", () => {
  const old = { schemaVersion: 1, entries: [entry(ids[0], "expense", 100, "2026-09-12")] };
  const migrated = validateLedger(old);
  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(backupObject(migrated), migrated);
});

test("shared PWA/native v2 fixture preserves relations, details and income", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/shared-v2.json", import.meta.url), "utf8"));
  const ledger = validateLedger(fixture);
  assert.equal(summary(ledger, "2026-09-01", "2026-09-30").net, 150000);
  assert.equal(summary(ledger, "2026-09-01", "2026-09-30").income, 1500000);
  assert.equal(ledger.entries[0].subentries.length, 2);
});
