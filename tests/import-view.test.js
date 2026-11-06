import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as core from "../ledger-core.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/shared-v2.json", import.meta.url), "utf8"));
// Run the actual app functions with local storage and DOM substitutes; never use a personal ledger.
const source = (await readFile(new URL("../app.js", import.meta.url), "utf8"))
  .replace(/^import [\s\S]*?;\n/gm, "").replace(/\nstart\(\);\s*$/, "");

function setup() {
  const nodes = new Map();
  const makeNode = () => ({
    value: "", hidden: false, style: {}, dataset: {}, children: [],
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener() {}, close() { this.closed = true; }
  });
  const element = id => { if (!nodes.has(id)) nodes.set(id, makeNode()); return nodes.get(id); };
  const writes = [];
  const context = vm.createContext({
    ...core, document: { getElementById: element, createElement: makeNode }, confirm: () => true,
    saveBeforeRestore: async value => writes.push(["before", value]),
    saveLedger: async value => writes.push(["ledger", value])
  });
  vm.runInContext(source + '\nshowToast=()=>{};ledger=validateLedger({schemaVersion:2,entries:[]});activeMonth="2026-11";period=monthPeriod(activeMonth);', context);
  element("record-filter").value = "income";
  element("search-input").value = "no match";
  const state = () => JSON.parse(vm.runInContext("JSON.stringify({ledger,period,activeMonth,customPeriod})", context));
  const visibleIDs = () => {
    const walk = item => [...(item.dataset.id ? [item.dataset.id] : []), ...item.children.flatMap(walk)];
    return walk(element("record-list"));
  };
  const restore = backup => {
    const text = JSON.stringify(backup);
    context.file = { size: Buffer.byteLength(text), text: async () => text };
    return vm.runInContext("importBackup(file)", context);
  };
  return { context, element, writes, state, visibleIDs, restore };
}

test("native v1 and v2 imports immediately show all historical types and dates", async () => {
  const v1 = { schemaVersion: 1, entries: fixture.entries.filter(entry => entry.kind !== "income").map(({ subentries, ...entry }) => entry) };
  for (const backup of [v1, fixture]) {
    const app = setup();
    await app.restore(backup);
    assert.deepEqual(app.state().period, { start: "2026-09-20", end: "2026-10-02" });
    assert.equal(app.state().activeMonth, "2026-10");
    assert.equal(app.state().customPeriod, true);
    assert.equal(app.element("record-filter").value, "all");
    assert.equal(app.element("search-input").value, "");
    assert.deepEqual(app.visibleIDs().sort(), backup.entries.map(entry => entry.id).sort());
    assert.equal(app.element("settings-dialog").closed, true);
    assert.deepEqual(app.writes.map(([key]) => key), ["before", "ledger"]);
  }
});

test("a reopened historical ledger reports its count and can reveal all records", () => {
  const app = setup();
  app.context.backup = fixture;
  vm.runInContext("ledger=validateLedger(backup);render();", app.context);
  assert.equal(app.visibleIDs().length, 0);
  assert.match(app.element("empty-action").textContent, /查看全部 3 笔记录/);
  vm.runInContext("showAllRecords()", app.context);
  assert.equal(app.visibleIDs().length, 3);
  assert.equal(app.writes.length, 0);
});

test("empty imports use the current month and expose the migration action", async () => {
  const app = setup();
  await app.restore({ schemaVersion: 2, entries: [] });
  assert.deepEqual(app.state().period, core.monthPeriod());
  assert.equal(app.state().customPeriod, false);
  assert.equal(app.element("empty-action").textContent, "导入原生 App 账本");
});

test("canceled or failed imports preserve the active ledger and filters", async () => {
  for (const cancel of [true, false]) {
    const app = setup();
    const before = app.state();
    if (cancel) app.context.confirm = () => false;
    else app.context.saveLedger = async () => { throw new Error("storage failure"); };
    if (cancel) await app.restore(fixture);
    else await assert.rejects(app.restore(fixture), /storage failure/);
    assert.deepEqual(app.state(), before);
    assert.equal(app.element("record-filter").value, "income");
    assert.equal(app.element("search-input").value, "no match");
    if (cancel) assert.equal(app.writes.length, 0);
  }
});
