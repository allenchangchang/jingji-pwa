import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("all DOM ids referenced by app.js exist", async () => {
  const [app, html] = await Promise.all([readFile(resolve(root, "app.js"), "utf8"), readFile(resolve(root, "index.html"), "utf8")]);
  const ids = new Set([...app.matchAll(/elements\["([^"]+)"\]/g)].map(match => match[1]));
  for (const match of app.matchAll(/\$\("#([^"]+)"\)/g)) ids.add(match[1]);
  for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
});

test("service worker precache files all exist", async () => {
  const worker = await readFile(resolve(root, "sw.js"), "utf8");
  const match = worker.match(/const ASSETS = \[(.*?)\];/s);
  assert.ok(match);
  const assets = JSON.parse(`[${match[1].replaceAll("'", '"')}]`);
  for (const asset of assets.filter(item => item !== "./")) await access(resolve(root, asset.replace(/^\.\//, "")));
});

test("manifest has standalone install metadata and icons", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ["192x192", "512x512"]);
  for (const icon of manifest.icons) await access(resolve(root, icon.src.replace(/^\.\//, "")));
});
