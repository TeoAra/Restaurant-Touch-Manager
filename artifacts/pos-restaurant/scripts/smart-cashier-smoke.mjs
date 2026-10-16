// Browser smoke test against the real cashier component. Every API request,
// including login, is intercepted with fixtures: no live orders or prints.
// Run with: node artifacts/pos-restaurant/scripts/smart-cashier-smoke.mjs
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import assert from "node:assert/strict";

const origin = process.env.POS_TEST_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const profile = `/tmp/pos-smart-browser-${process.pid}`;
const chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error("Chromium did not start")), 20000);
    chrome.stderr.on("data", chunk => {
      log += chunk;
      const found = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (found) { clearTimeout(timer); resolve(found[1]); }
    });
    chrome.on("error", reject);
  });
  const port = new URL(endpoint).port;
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = pages.find(p => p.type === "page" && p.url === "about:blank") ?? pages.find(p => p.type === "page");
  assert(target, "Chromium page target missing");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  const writes = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const createdAt = "2026-10-16T18:14:00.000Z";
  const tables = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, number: i + 1, name: `Tavolo ${i + 1}`, seats: 4, status: i === 0 ? "occupied" : "free", activeOrderId: i === 0 ? 101 : null, activeOrderTotal: i === 0 ? "26.00" : null, roomName: i > 8 ? "Dehor" : "Sala", elementType: "table", posX: i % 5, posY: Math.floor(i / 5), shape: "square" }));
  const categories = [{ id: 1, name: "Birre", color: "#a16207" }, { id: 2, name: "Cucina", color: "#166534" }];
  const products = [{ id: 1, name: "Birra artigianale", price: "6.00", categoryId: 1, available: true }, { id: 2, name: "Burger della casa", price: "14.00", categoryId: 2, available: true }];
  const order = { id: 101, tableId: 1, tableName: "Tavolo 1", status: "open", total: "26.00", covers: 2, createdAt, updatedAt: createdAt, items: [
    { id: 11, productId: 1, productName: "Birra artigianale", productPrice: "6.00", quantity: 2, unitPrice: "6.00", subtotal: "12.00", status: "draft", phase: 0, modifiers: "[]", createdAt },
    { id: 12, productId: 2, productName: "Burger della casa", productPrice: "14.00", quantity: 1, unitPrice: "14.00", subtotal: "14.00", status: "sent", phase: 0, modifiers: "[]", createdAt },
  ] };
  ws.onmessage = async event => {
    const msg = JSON.parse(event.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(msg.error.message)); else p?.resolve(msg.result);
    }
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.text + " " + (msg.params.exceptionDetails.exception?.description ?? ""));
    if (msg.method === "Fetch.requestPaused") {
      const { requestId, request } = msg.params;
      const path = new URL(request.url).pathname;
      let body;
      if (request.method !== "GET") writes.push(`${request.method} ${path}`);
      if (path === "/api/auth/login") body = { id: 9999, name: "Operatore test", role: "admin" };
      else if (path === "/api/setup-status") body = { completed: true, reason: "flag" };
      else if (path === "/api/settings") body = { cover_price: "1.50", feat_table_ops: "true", pos_type: "none" };
      else if (path === "/api/dashboard/tables-status") body = tables;
      else if (path === "/api/categories") body = categories;
      else if (path === "/api/products") body = products;
      else if (path === "/api/orders/101") {
        order.total = order.items.reduce((total, item) => total + Number(item.subtotal), 0).toFixed(2);
        body = order;
      }
      else if (path === "/api/orders/101/items/11" && request.method === "PATCH") {
        Object.assign(order.items[0], JSON.parse(request.postData));
        order.items[0].subtotal = (order.items[0].quantity * Number(order.items[0].unitPrice)).toFixed(2);
        body = order.items[0];
      } else if (path === "/api/orders/101/items" && request.method === "POST") {
        const input = JSON.parse(request.postData);
        const p = products.find(p => p.id === input.productId);
        body = { ...input, id: 13, productName: p.name, productPrice: p.price, subtotal: (input.quantity * Number(input.unitPrice)).toFixed(2), status: "draft", createdAt };
        order.items.push(body);
      } else body = [];
      await send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  const evaluate = async expression => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "Browser expression failed");
    return r.result.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Timed out: ${expression}\n${await evaluate('JSON.stringify({url:location.href,body:document.body?.innerText?.slice(0,900)})')}\n${errors.join("\n")}`);
  };
  const click = async selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const button = async (text, within = ".pos-smart-live") => {
    const found = await evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(within + " button")})].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
    assert(found, `Missing button: ${text}`);
    await new Promise(r => setTimeout(r, 150));
  };
  await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: origin });
  await wait(`document.body.textContent.includes("Inserisci il tuo PIN")`);
  // Exercise the actual login screen; the test API accepts this fixture PIN.
  for (let i = 0; i < 4; i++) await button("1", "body");
  await wait(`document.querySelectorAll(".pos-table-card").length === 14`);
  await click(".pos-table-card");
  await wait(`document.querySelectorAll(".pos-item-time").length === 2`);
  await wait(`document.querySelectorAll(".pos-product-grid > button").length === 2`);
  assert.equal(await evaluate(`document.querySelectorAll(".pos-phase-selector > button").length`), 4);
  await button("F3", ".pos-phase-selector");
  assert(await evaluate(`document.querySelector(".pos-phase-selector > button:nth-of-type(3)").getAttribute("aria-pressed") === "true"`), "Phase selection must update");
  await button("F1", ".pos-phase-selector");
  await button("Altro · tastierino e operazioni +");
  await wait(`!!document.querySelector("#pos-more-operations")`);
  const operations = await evaluate(`document.querySelector("#pos-more-operations").textContent`);
  for (const name of ["Sconto", "Lotteria", "Preconto", "Separato", "Romana", "Espandi", "Cancella", "Annulla ordine", "Sospeso", "Cassetto", "Tavolo", "Imposta Qtà", "Imposta Prezzo"]) assert(operations.includes(name), `Operation lost: ${name}`);
  await click('[aria-label="Chiudi operazioni"]');
  await click(".pos-product-grid > button");
  await wait(`document.querySelector(".pos-order-item").textContent.includes("3")`);
  assert(writes.includes("PATCH /api/orders/101/items/11"), "Repeated product must update the real mutation route");
  await click(".pos-product-grid > button:nth-child(2)");
  await wait(`document.querySelectorAll(".pos-order-item").length === 3`);
  assert(writes.includes("POST /api/orders/101/items"), "Product must call the real mutation route");
  await click(".pos-order-actions > button:last-child");
  await wait(`document.querySelector(".pos-menu-panel").textContent.includes("Romana")`);
  const payment = await evaluate(`document.querySelector(".pos-menu-panel").textContent`);
  for (const name of ["Separato", "Romana", "CONTANTI"]) assert(payment.includes(name), `Payment mode lost: ${name}`);
  await button("Menu", ".pos-work-tabs");
  await mkdir("generated-artifacts/pos-smart", { recursive: true });
  for (const [width, height] of [[1440, 900], [1024, 768], [1024, 640], [800, 600], [390, 844]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 250));
    const layout = await evaluate(`(() => { const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom}; }; return {body:document.documentElement.scrollWidth, tables:rect(".pos-tables"), menu:rect(".pos-menu-panel"), order:rect(".pos-order-panel"), actions:rect(".pos-order-actions")}; })()`);
    assert(layout.body <= width, `Horizontal page overflow at ${width}`);
    if (width > 760) {
      assert(layout.tables.x < layout.menu.x && layout.menu.x < layout.order.x, `Column order at ${width}`);
      assert(layout.actions.bottom <= height, `Actions clipped at ${width}`);
      assert(layout.menu.width > 200 && layout.order.right <= width, `Panels clipped at ${width}`);
    } else {
      await button("Tavoli", ".pos-mobile-nav");
      assert(await evaluate(`getComputedStyle(document.querySelector(".pos-tables")).display !== "none"`), "Mobile tables drawer missing");
      await click(".pos-tables-close");
      await click(".pos-mobile-nav > button:nth-child(2)");
      await new Promise(r => setTimeout(r, 150));
      assert(await evaluate(`document.querySelector(".pos-order-panel").getBoundingClientRect().width > 0`), "Mobile order missing");
      assert(await evaluate(`document.querySelector(".pos-order-actions").getBoundingClientRect().bottom <= document.querySelector(".pos-mobile-nav").getBoundingClientRect().top + 1`), "Mobile actions clipped");
    }
    const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile(`generated-artifacts/pos-smart/${width}x${height}.jpg`, Buffer.from(data, "base64"));
    // The payment panel must remain scrollable on short and narrow screens.
    await click(".pos-order-actions > button:last-child");
    await wait(`!!document.querySelector(".pos-payment-panel")`);
    await evaluate(`document.querySelector(".pos-payment-panel > button:last-of-type").scrollIntoView({block:"end"})`);
    const reachable = await evaluate(`(() => { const b = document.querySelector(".pos-payment-panel > button:last-of-type").getBoundingClientRect(); const p = document.querySelector(".pos-payment-panel").getBoundingClientRect(); return b.top >= p.top - 1 && b.bottom <= p.bottom + 1; })()`);
    assert(reachable, `Payment confirmation unreachable at ${width}×${height}`);
    await button("Menu", ".pos-work-tabs");
    if (width <= 760) await button("Tavoli", ".pos-mobile-nav");
    await click(".pos-map-link");
    await wait(`document.querySelector(".pos-menu-panel").textContent.includes("Mappa Tavoli")`);
    await wait(`document.querySelectorAll(".pos-menu-panel .origin-top-left button").length > 0`);
    assert(await evaluate(`(() => { const r = document.querySelector(".pos-menu-panel .origin-top-left button").getBoundingClientRect(); return r.width >= 30 && r.height >= 30 && r.right <= innerWidth && r.bottom <= innerHeight; })()`), `Map tables not visible at ${width}×${height}`);
    const mapShot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile(`generated-artifacts/pos-smart/map-${width}x${height}.jpg`, Buffer.from(mapShot.data, "base64"));
    await button("Menu", ".pos-work-tabs");
    console.log(`PASS layout ${width}×${height}`);
  }
  assert.deepEqual(errors, [], "Browser errors");
  assert(!writes.some(w => /payments|fiscal|invoices|comanda/.test(w)), "No fiscal writes expected");
  console.log("PASS login, table selection, item timestamps, all advanced controls, product mutation, payment modes, mobile drawer. All APIs mocked; no live fiscal operations.");
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
  await new Promise(resolve => chrome.once("exit", resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }).catch(() => {});
}
