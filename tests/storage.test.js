import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { emptyLedger, validateLedger } from "../ledger-core.js";

const source = (await readFile(new URL("../storage.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/m, "").replace(/^export /gm, "");
const fixture = JSON.parse(await readFile(new URL("./fixtures/shared-v2.json", import.meta.url), "utf8"));

function storage(previous, failKey) {
  const state = new Map(previous ? [["ledger", structuredClone(previous)]] : []), writes = [];
  const database = {
    close() {},
    transaction() {
      const pending = [], transaction = {
        objectStore() {
          return {
            get(key) { const request = {}; setImmediate(() => { request.result = state.get(key); request.onsuccess(); }); return request; },
            put(value, key) { pending.push([key, structuredClone(value)]); }
          };
        }
      };
      setImmediate(() => {
        if (pending.some(([key]) => key === failKey)) { transaction.error = new Error(`failed ${failKey}`); transaction.onerror(); }
        else { for (const [key, value] of pending) { state.set(key, value); writes.push(key); } transaction.oncomplete?.(); }
      });
      return transaction;
    }
  };
  const indexedDB = { open() { const request = {}; setImmediate(() => { request.result = database; request.onsuccess(); }); return request; } };
  const context = vm.createContext({ indexedDB, validateLedger, emptyLedger });
  vm.runInContext(source, context);
  return { state, writes, save: value => { context.candidate = value; return vm.runInContext("saveLedger(candidate)", context); }, previous: () => vm.runInContext("loadBeforeUpgrade()", context) };
}

test("first v3 write preserves the exact old v1/v2 ledger before replacing it", async () => {
  for (const schemaVersion of [1, 2]) {
    const old = { ...fixture, schemaVersion };
    const store = storage(old);
    await store.save(validateLedger(old));
    assert.deepEqual(await store.previous(), old);
    assert.deepEqual(store.writes, ["beforeUpgradeV3", "ledger"]);
    assert.equal(store.state.get("ledger").schemaVersion, 3);
    await store.save(emptyLedger());
    assert.deepEqual(await store.previous(), old);
    assert.deepEqual(store.writes, ["beforeUpgradeV3", "ledger", "ledger"]);
  }
});

test("failure to preserve an old ledger prevents its replacement", async () => {
  const store = storage(fixture, "beforeUpgradeV3");
  await assert.rejects(store.save(validateLedger(fixture)), /failed beforeUpgradeV3/);
  assert.deepEqual(store.state.get("ledger"), fixture);
  assert.deepEqual(store.writes, []);
});

test("failed main write retains both the old ledger and its upgrade copy", async () => {
  const store = storage(fixture, "ledger");
  await assert.rejects(store.save(validateLedger(fixture)), /failed ledger/);
  assert.deepEqual(store.state.get("ledger"), fixture);
  assert.deepEqual(await store.previous(), fixture);
});

test("new installations have no artificial upgrade copy and invalid data causes no writes", async () => {
  const store = storage();
  await store.save(emptyLedger());
  assert.equal(await store.previous(), undefined);
  const before = structuredClone(store.state.get("ledger"));
  await assert.rejects(store.save({ schemaVersion: 3, entries: [] }));
  assert.deepEqual(store.state.get("ledger"), before);
  assert.deepEqual(store.writes, ["ledger"]);
});
