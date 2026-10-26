// Browser smoke test against the real cashier component. Every API request,
// including login, is intercepted with fixtures: no live orders or prints.
// Run with: node artifacts/pos-restaurant/scripts/smart-cashier-smoke.mjs
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const origin = process.env.POS_TEST_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const profile = `/tmp/pos-smart-browser-${process.pid}`;
const chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let ws;
const bookingRecords = [];
let bookingEnabled = false;
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
  const payloads = [];
  let failRomana = true;
  let invoiceConflict = true;
  let savedInvoice = null;
  const xmlFixture = '<?xml version="1.0"?><FatturaElettronica><Numero>1/23</Numero></FatturaElettronica>';
  const settings = { cover_price: "1.50", feat_table_ops: "true", pos_type: "none" };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const createdAt = "2026-10-16T18:14:00.000Z";
  const tables = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, number: i + 1, name: `Tavolo ${i + 1}`, seats: 4, status: i === 0 ? "occupied" : "free", activeOrderId: i === 0 ? 101 : null, activeOrderTotal: i === 0 ? "26.00" : null, roomName: i > 8 ? "Dehor" : "Sala", elementType: "table", posX: i % 5, posY: Math.floor(i / 5), shape: "square" }));
  const categories = [{ id: 1, name: "Birre", color: "#a16207" }, { id: 2, name: "Cucina", color: "#166534" }];
  const products = [{ id: 1, name: "Birra artigianale", price: "6.00", categoryId: 1, available: true }, { id: 2, name: "Burger della casa", price: "14.00", categoryId: 2, available: true }];
  const order = { id: 101, tableId: 1, tableName: "Tavolo 1", status: "open", total: "26.00", covers: 2, paidRomana: "0.00", payments: [], createdAt, updatedAt: createdAt, items: [
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
      if (request.method !== "GET") payloads.push({ path, data: JSON.parse(request.postData || "{}") });
      let responseCode = 200;
      if (path === "/api/auth/login") body = { id: 9999, name: "Operatore test", role: "admin" };
      else if (path === "/api/auth/session") body = { id: 9999, name: "Operatore test", role: "admin" };
      else if (path === "/api/reservations/public/config") body = { enabled: bookingEnabled, restaurantName: "Locale test", maxCovers: 30, whatsappConfigured: false };
      else if (path === "/api/reservations/public/request" && request.method === "POST") {
        const input = JSON.parse(request.postData);
        bookingRecords.push({ ...input, id: 501, status: "pending", source: "online", durationMinutes: 120, tableId: null, tableIds: null, tableName: null });
        body = { id: 501, status: "pending", message: "Richiesta ricevuta. Attendi la conferma del locale." };
      }
      else if (path === "/api/reservations") {
        const status = new URL(request.url).searchParams.get("status");
        body = bookingRecords.filter(r => !status || r.status === status);
      }
      else if (path === "/api/reservations/501" && request.method === "PATCH") {
        Object.assign(bookingRecords[0], JSON.parse(request.postData));
        body = bookingRecords[0];
      }
      else if (path === "/api/fiscal/receipts" && process.env.POS_BOOKING_CHECK === "1") {
        body = [{ id: 88, numero: 73, anno: 2026, data: "2026-10-26", importo: "24.00", iva: "2.18", metodoPagamento: "card", annullato: false, numeroChiusura: 42, numeroDocumentoRt: 1, printerSerial: "DC2B000001", emissionStatus: "confirmed", voidStatus: "unknown", voidError: "Esito da verificare sulla RT" }];
      }
      else if (path === "/api/setup-status") body = { completed: true, reason: "flag" };
      else if (path === "/api/settings") {
        if (request.method === "PATCH") {
          const { key, value } = JSON.parse(request.postData);
          settings[key] = value;
        }
        body = settings;
      }
      else if (path === "/api/dashboard/tables-status") body = tables;
      else if (path === "/api/categories") body = categories;
      else if (path === "/api/products") body = products;
      else if (path === "/api/dashboard/summary") body = { todayRevenue: "126.00", todayOrders: 6, openOrders: 1, occupiedTables: 1, totalTables: 14, avgOrderValue: "21.00", yesterdayRevenue: "120.00", yesterdayOrders: 6, lastWeekRevenue: "118.00", lastWeekOrders: 5 };
      else if (path === "/api/dashboard/sales-by-day") body = [{ date: "2026-10-15", revenue: "120.00", orders: 6 }, { date: "2026-10-16", revenue: "126.00", orders: 6 }];
      else if (path === "/api/orders" && request.method === "POST" && process.env.POS_CHECKOUT_CHECK === "1") {
        Object.assign(order, JSON.parse(request.postData));
        body = order;
      }
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
        body = { ...input, id: 11 + order.items.length, productName: p.name, productPrice: p.price, subtotal: (input.quantity * Number(input.unitPrice)).toFixed(2), status: "draft", createdAt };
        order.items.push(body);
      } else if (path === "/api/orders/101/covers" && request.method === "PATCH") {
        Object.assign(order, JSON.parse(request.postData)); body = order;
      } else if (path === "/api/customers") {
        body = [{ id: 1, tipo: "azienda", ragioneSociale: "Cliente Test", partitaIva: "12345678901", indirizzo: "Via Test", cap: "00100", comune: "Roma" }];
      } else if (path === "/api/fiscal/romana") {
        const input = JSON.parse(request.postData);
        if (failRomana) { responseCode = 502; body = { ok: false, rtOk: false, error: "RT di test non confermata" }; }
        else {
          order.paidRomana = (Number(order.paidRomana) + Number(input.importo)).toFixed(2);
          order.payments.push({ id: order.payments.length + 1, orderId: 101, method: input.metodoPagamento, amount: input.importo, operationId: input.operationId, fiscalReceiptId: 201, createdAt });
          body = { ok: true, rtOk: true, paidRomana: order.paidRomana, remaining: (Number(order.total) + order.covers * Number(order.coverPrice ?? settings.cover_price) - Number(order.paidRomana)).toFixed(2), orderClosed: false };
        }
      } else if (path === "/api/invoices" && request.method === "POST") {
        if (invoiceConflict) { responseCode = 409; body = { error: "Numero già usato" }; }
        else { savedInvoice = { ...JSON.parse(request.postData), id: 51, numeroDocumento: "1/23" }; body = savedInvoice; }
      } else if (path === "/api/invoices/51/emit") {
        body = { ...savedInvoice, xmlContent: xmlFixture, fileName: "IT12345678901_00023.xml", rtOk: false, rtError: "Copia di cortesia di test non stampata" };
      } else if (path === "/api/payments" && request.method === "POST") {
        body = { id: 71, ...JSON.parse(request.postData), fiscal: { rtOk: true, nonFiscale: true, deferredInvoice: true } };
      } else body = [];
      order.total = order.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0).toFixed(2);
      await send("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
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
  const click = async selector => {
    // Radix retains closed portals during its exit animation. Never operate on
    // that hidden, stale keypad instead of the newly opened one.
    const scoped = selector.startsWith('[data-testid="keypad-')
      ? `[data-testid="dialog-keypad"][data-state="open"] ${selector}` : selector;
    await evaluate(`document.querySelector(${JSON.stringify(scoped)}).click()`);
    await new Promise(r => setTimeout(r, 60));
  };
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
  const checkModes = async (asporto, delivery) => {
    await wait(`(() => { const labels = [...document.querySelectorAll(".pos-sale-modes button")].map(b => b.textContent.trim()); return labels.includes("Asporto") === ${asporto} && labels.includes("Delivery") === ${delivery}; })()`);
    const modes = await evaluate(`[...document.querySelectorAll(".pos-sale-modes button")].map(b => b.textContent.trim())`);
    assert.equal(modes.includes("Asporto"), asporto, "Asporto must follow its backoffice switch");
    assert.equal(modes.includes("Delivery"), delivery, "Delivery must follow its backoffice switch");
    assert(modes.includes("Sala") && modes.includes("Banco"), "Core sales modes must stay visible");
  };
  await checkModes(false, false); // Missing settings must never enable a mode.
  for (const [asporto, delivery] of [[true, false], [true, true], [false, true], [false, false]]) {
    await send("Page.navigate", { url: new URL("/backoffice/settings", origin).href });
    await wait(`!!document.querySelector('[role="switch"][aria-label="Asporto"]')`);
    await wait(`!!document.querySelector('input[type="number"][value="1.50"]')`);
    for (const [label, enabled] of [["Asporto", asporto], ["Delivery / Consegna a domicilio", delivery]]) {
      const selector = `[role="switch"][aria-label="${label}"]`;
      const current = await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute("aria-checked") === "true"`);
      if (current !== enabled) {
        await click(selector);
        await wait(`document.querySelector(${JSON.stringify(selector)}).getAttribute("aria-checked") === ${JSON.stringify(String(enabled))}`);
      }
    }
    await send("Page.navigate", { url: origin });
    await wait(`document.querySelectorAll(".pos-table-card").length === 14`);
    await checkModes(asporto, delivery);
  }
  console.log("PASS Asporto/Delivery: missing settings and all four combinations saved through real backoffice controls (mocked API)");
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
  await wait(`document.querySelector('[data-testid="dialog-keypad"]')`);
  await click('[data-testid="keypad-confirm"]');
  await wait(`document.querySelector(".pos-order-item").textContent.includes("3")`);
  assert(writes.includes("PATCH /api/orders/101/items/11"), "Repeated product must update the real mutation route");
  await click(".pos-product-grid > button:nth-child(2)");
  await wait(`document.querySelector('[data-testid="dialog-keypad"]')`);
  await click('[data-testid="keypad-confirm"]');
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
  if (process.env.POS_BILLING_CHECK === "1") {
    const input = async (selector, value) => { await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw Error("Missing input: " + ${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", {bubbles:true}));
    })()`); await new Promise(r => setTimeout(r, 60)); };
    const contains = async (text, root = ".pos-menu-panel") => evaluate(`(() => {
      const b = [...document.querySelectorAll(${JSON.stringify(root)} + " button")].find(b => !b.disabled && b.textContent.toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
      if (!b) throw Error("Missing button: " + ${JSON.stringify(text)} + "\\n" + document.body.innerText.slice(-2500));
      b.click();
    })()`);
    await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
    await button("Menu", ".pos-work-tabs");
    await click(".pos-order-item");
    await wait(`document.querySelector('[data-testid="dialog-keypad"]')`);
    await click('[data-testid="keypad-field-quantity"]');
    await click('[data-testid="keypad-key-5"]');
    await click('[data-testid="keypad-field-unitPrice"]');
    await click('[data-testid="keypad-key-8"]');
    await click('[data-testid="keypad-confirm"]');
    await wait(`!document.querySelector('[data-testid="dialog-keypad"]') && document.querySelector(".pos-order-item").textContent.includes("5")`);
    assert(payloads.some(p => p.path.endsWith("/items/11") && p.data.quantity === 5 && p.data.unitPrice === "8.00"), "Edit quantity and price must reach real mutation handler");
    await click(".pos-product-grid > button");
    await wait(`document.querySelector('[data-testid="dialog-keypad"]')`);
    await click('[data-testid="keypad-field-quantity"]'); await click('[data-testid="keypad-key-3"]');
    await click('[data-testid="keypad-field-unitPrice"]'); await click('[data-testid="keypad-key-7"]');
    await click('[data-testid="keypad-confirm"]');
    await wait(`document.querySelectorAll(".pos-order-item").length === 4`);
    assert(payloads.some(p => p.path.endsWith("/101/items") && p.data.quantity === 3 && p.data.unitPrice === "7.00"), "New product keypad values must persist");
    await click('[data-testid="row-covers"]');
    await wait(`document.querySelector('[data-testid="dialog-keypad"]')`);
    await click('[data-testid="keypad-field-covers"]'); await click('[data-testid="keypad-key-3"]');
    await click('[data-testid="keypad-field-coverPrice"]');
    for (const key of ["1", ".", "2", "5"]) await click(`[data-testid="keypad-key-${key}"]`);
    await click('[data-testid="keypad-confirm"]');
    await wait(`document.querySelector('[data-testid="text-covers-total"]').textContent.includes("3.75")`);
    assert(payloads.some(p => p.path.endsWith("/covers") && p.data.covers === 3 && p.data.coverPrice === "1.25"));
    assert.equal(settings.cover_price, "1.50", "Order cover edits must not change the global price");
    assert(await evaluate(`document.querySelector('[data-testid="row-covers"]').getBoundingClientRect().top < document.querySelector(".pos-order-item").getBoundingClientRect().top`));
    console.log("PASS touch keypad: add/edit quantity and price; pinned per-order covers");

    await click(".pos-order-actions > button:last-child");
    await contains("Romana");
    await contains("Avanti");
    await contains("Avvia divisione");
    await contains("Contanti");
    await wait(`document.body.innerText.includes("RT di test non confermata")`);
    assert.equal(order.paidRomana, "0.00", "RT error must not reduce the balance");
    const firstAttempt = payloads.filter(p => p.path === "/api/fiscal/romana").at(-1).data;
    failRomana = false;
    await contains("Contanti");
    await wait(`document.querySelector('[data-testid="romana-summary-paid"]')?.textContent !== "€0.00" && document.querySelector('[data-testid="romana-summary-history"]')`);
    const retry = payloads.filter(p => p.path === "/api/fiscal/romana").at(-1).data;
    assert.equal(retry.operationId, firstAttempt.operationId, "Retry must reuse the operation ID");
    assert.equal(retry.expectedPaidRomana, "0.00");
    assert.equal(order.payments.length, 1);
    const due = Number(order.total) + 3.75, paid = Number(order.paidRomana), remaining = (due - paid).toFixed(2);
    await wait(`document.querySelector('[data-testid="romana-summary-remaining"]')?.textContent.includes(${JSON.stringify(remaining)})`);
    await contains("Torna al tavolo");
    await wait(`document.querySelector('[data-testid="order-payment-summary-remaining"]')?.textContent.includes(${JSON.stringify(remaining)})`);
    await click(".pos-order-actions > button:last-child"); await contains("Romana");
    await wait(`document.querySelector('[data-testid="romana-summary-remaining"]')?.textContent.includes(${JSON.stringify(remaining)})`);
    assert.equal(order.status, "open");
    console.log("PASS Romana: RT failure, stable retry, partial ledger, exact residual, return to table");

    // A fresh independent fixture scenario; only our in-memory intercepted API changes.
    order.paidRomana = "0.00"; order.payments = [];
    await send("Page.navigate", { url: origin + "/" });
    await wait(`document.querySelector(".pos-table-card")`);
    await click(".pos-table-card");
    await button("Cliente", ".pos-work-tabs");
    await contains("Cliente Test");
    await wait(`document.querySelector('[data-testid="input-invoice-numero"]')`);
    await input('[data-testid="input-invoice-numero"]', "23");
    await wait(`document.querySelector('[data-testid="text-invoice-preview"]').textContent.includes("1/23")`);
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile("generated-artifacts/pos-smart/invoice-customer-1024x768.jpg", Buffer.from(shot.data, "base64"));
    await click(".pos-order-actions > button:last-child");
    await wait(`document.querySelector('[data-testid="input-lottery-code"]')`);
    await input('.pos-payment-panel input[type="number"]', "100");
    await input('[data-testid="input-lottery-code"]', "ABC");
    await click(".pos-payment-panel > button:last-of-type");
    await wait(`document.body.innerText.includes("Codice lotteria incompleto")`);
    assert(!writes.some(w => w.includes("/api/payments")));
    await input('[data-testid="input-lottery-code"]', "abcd1234");
    await wait(`document.querySelector('[data-testid="input-lottery-code"]').value === "ABCD1234"`);
    await click(".pos-payment-panel > button:last-of-type");
    await wait(`document.body.innerText.includes("già usato")`);
    assert(!writes.some(w => w.includes("/api/payments")), "A duplicate invoice number must stop payment");
    invoiceConflict = false;
    await click(".pos-payment-panel > button:last-of-type");
    await wait(`document.querySelector('[data-testid="dialog-invoice-result"]')`);
    assert.equal(savedInvoice.sezionale, "1"); assert.equal(savedInvoice.numero, 23);
    const payment = payloads.find(p => p.path === "/api/payments").data;
    assert.equal(payment.invoiceId, 51);
    assert.equal(payment.operationId, "invoice-51");
    assert.equal(payment.amount, due.toFixed(2));
    assert.equal(payment.lotteria, "ABCD1234");
    assert(payloads.findIndex(p => p.path === "/api/invoices") < payloads.findIndex(p => p.path === "/api/payments"));
    assert(await evaluate(`document.querySelector('[data-testid="text-invoice-xml"]').textContent.includes("<Numero>1/23</Numero>")`));
    assert(await evaluate(`!!document.querySelector('[data-testid="button-invoice-download"]') && document.querySelector('[data-testid="dialog-invoice-result"]').textContent.includes("non stampata")`));
    await mkdir(profile + "/downloads", { recursive: true });
    await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: profile + "/downloads" });
    await click('[data-testid="button-invoice-download"]');
    let downloaded = "";
    for (let i = 0; i < 30 && !downloaded; i++) {
      downloaded = await readFile(profile + "/downloads/IT12345678901_00023.xml", "utf8").catch(() => "");
      if (!downloaded) await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(downloaded, xmlFixture, "XML download must contain the saved document");
    await click('[data-testid="button-invoice-close"]');
    await click(".pos-table-card");
    await click(".pos-order-actions > button:last-child");
    await wait(`document.querySelector('[data-testid="input-lottery-code"]').value === ""`);
    await button("Menu", ".pos-work-tabs");
    console.log("PASS invoice: manual 1/23, duplicate blocks payment, saved before payment, XML downloaded despite courtesy failure; lottery format and one-shot");
  }
  if (process.env.POS_THEME_CHECK === "1") {
    const primaryColor = await evaluate(`(() => { const b = document.querySelector(".pos-phase-selector .is-active"); return getComputedStyle(b).backgroundColor; })()`);
    const checkContrast = ({ color, background }, label) => {
      const luminance = value => {
        const rgb = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
        assert(rgb?.length === 3, `${label}: unsupported color ${value}`);
        const [r, g, b] = rgb.map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
        return .2126 * r + .7152 * g + .0722 * b;
      };
      const a = luminance(color), b = luminance(background);
      const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      assert(ratio >= 4.5, `${label}: insufficient contrast (${ratio.toFixed(2)})`);
    };
    const colorsOf = selector => evaluate(`(() => { const s = getComputedStyle(document.querySelector(${JSON.stringify(selector)})); return {color:s.color, background:s.backgroundColor}; })()`);
    checkContrast(await colorsOf(".pos-phase-selector .is-active"), "Cashier selected phase");
    const app = await readFile("artifacts/pos-restaurant/src/App.tsx", "utf8");
    const routes = [...app.matchAll(/<Route path="(\/backoffice[^"]*)"/g)].map(m => m[1]);
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      for (const route of routes) {
        // Use the app router, avoiding dozens of full module reloads through
        // the development proxy while checking every management page.
        await evaluate(`history.pushState(null, "", ${JSON.stringify(route)}); window.dispatchEvent(new PopStateEvent("popstate"));`);
        await new Promise(r => setTimeout(r, 100));
        await wait(`!!document.querySelector("header h1")`);
        await new Promise(r => setTimeout(r, 200));
        const theme = await evaluate(`(() => { const p = document.createElement("i"); p.style.color = "hsl(var(--primary))"; document.body.append(p); const primary = getComputedStyle(p).color; p.remove(); return {primary, width:document.documentElement.scrollWidth}; })()`);
        assert.equal(theme.primary, primaryColor, `${route}: different primary than cashier`);
        assert(theme.width <= width, `${route}: page overflow at ${width}`);
        const bodyWidth = await evaluate(`(() => { const body = document.querySelector(".backoffice-body"); const content = body?.querySelector(":scope > div"); return body && content ? {available:body.clientWidth, content:content.getBoundingClientRect().width} : null; })()`);
        assert(bodyWidth && bodyWidth.content >= bodyWidth.available - 2, `${route}: body constrained to a narrow column at ${width}`);
        if (route === "/backoffice/settings" && width === 390) {
          const saveVisible = await evaluate(`(() => { const label = [...document.querySelectorAll("div")].find(e => e.textContent.trim() === "Prezzo Coperto"); const card = label?.closest(".bg-white"); const save = [...(card?.querySelectorAll("button") ?? [])].find(b => b.textContent.trim() === "Salva"); if (!save) return false; save.scrollIntoView({block:"end"}); const r = save.getBoundingClientRect(); return r.width > 40 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`);
          assert(saveVisible, "Cover price Save button clipped on phone");
        }
        if (["/backoffice", "/backoffice/menu", "/backoffice/settings", "/backoffice/clienti", "/backoffice/fatture"].includes(route)) {
          const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
          await writeFile(`generated-artifacts/pos-smart/theme-${route.split("/").pop()}-${width}.jpg`, Buffer.from(data, "base64"));
        }
      }
      console.log(`PASS shared theme and layout: ${routes.length} backoffice routes at ${width}×${height}`);
    }
    // Portaled dialogs must inherit the same theme as the cashier, not orange.
    await send("Page.navigate", { url: new URL("/backoffice/clienti", origin).href });
    await wait(`!!document.querySelector("header h1")`);
    await button("Nuovo", "header");
    await wait(`!!document.querySelector('[role="dialog"]')`);
    const dialogPrimary = await evaluate(`(() => { const d = document.querySelector('[role="dialog"]'); const b = d.querySelector('button.bg-primary'); return b ? {background:getComputedStyle(b).backgroundColor, color:getComputedStyle(b).color} : null; })()`);
    assert(dialogPrimary, "Dialog primary action missing");
    assert.equal(dialogPrimary.background, primaryColor, "Portaled dialog primary differs from cashier");
    checkContrast(dialogPrimary, "Dialog primary action");
    const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile("generated-artifacts/pos-smart/theme-customer-dialog.jpg", Buffer.from(data, "base64"));
    console.log("PASS primary action contrast and shared color in portaled customer dialog");
  }
  if (process.env.POS_CHECKOUT_CHECK === "1") {
    const savedItems = structuredClone(order.items);
    order.items = [];
    order.covers = 2;
    order.coverPrice = "1.50";
    order.paidRomana = "0";
    await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: origin + "/" });
    await wait(`document.querySelectorAll(".pos-table-card").length === 14`);
    const openCheckout = async (selector = '[data-testid="button-open-checkout"]') => {
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled`), false);
      const before = writes.length;
      await click(selector);
      await wait(`!!document.querySelector("#pos-payment-hub .pos-payment-panel")`);
      assert.equal(writes.length, before, "Opening checkout must not create orders, pay, send kitchen orders or print");
    };
    await openCheckout();
    assert(await evaluate(`document.querySelector(".pos-payment-total").textContent.includes("0.00")`));
    assert(await evaluate(`document.querySelector(".pos-payment-panel > button:last-of-type").disabled`), "Zero total cannot actually be charged");
    await click(".pos-table-card");
    await wait(`document.querySelector('[data-testid="button-open-checkout"]').textContent.includes("3.00")`);
    await openCheckout();
    assert(await evaluate(`document.querySelector(".pos-payment-total").textContent.includes("3.00")`), "Covers-only tables must open checkout");
    for (const mode of ["Separato", "Romana"]) {
      await button(mode, ".pos-menu-panel");
      await openCheckout();
    }
    order.items = savedItems;
    order.paidRomana = "5.00";
    const tableTotal = savedItems.reduce((sum, item) => sum + Number(item.subtotal), 0) + 3;
    await send("Page.navigate", { url: origin + "/" });
    await wait(`document.querySelectorAll(".pos-table-card").length === 14`);
    await click(".pos-table-card");
    await wait(`document.querySelector('[data-testid="button-open-checkout"]').textContent.includes(${JSON.stringify(tableTotal.toFixed(2))})`);
    await openCheckout();
    assert(await evaluate(`document.querySelector(".pos-payment-total").textContent.includes(${JSON.stringify((tableTotal - 5).toFixed(2))})`), "Checkout charges only the remaining balance");
    order.covers = 0;
    order.paidRomana = "0";
    await button("Banco", ".pos-sale-modes");
    await wait(`document.querySelector(".pos-order-panel").textContent.includes("Scontrino Rapido")`);
    const quickTotal = tableTotal - 3;
    await wait(`document.querySelector('[data-testid="button-open-checkout"]').textContent.includes(${JSON.stringify(quickTotal.toFixed(2))})`);
    await openCheckout();
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const mobileCheckout = '[data-testid="button-open-checkout-mobile"]';
    await wait(`document.querySelector(${JSON.stringify(mobileCheckout)}).getBoundingClientRect().width > 0`);
    for (const section of ["Menu", "Conto", "Tavoli"]) {
      if (section === "Conto") await evaluate(`document.querySelector(".pos-mobile-nav > button:nth-child(2)").click()`);
      else await button(section, ".pos-mobile-nav");
      assert(await evaluate(`(() => {
        const b = document.querySelector(${JSON.stringify(mobileCheckout)});
        const r = b.getBoundingClientRect();
        return b.contains(document.elementFromPoint(r.left + r.width/2, r.top + r.height/2));
      })()`), `Mobile checkout must remain reachable from ${section}: ${await evaluate(`(() => {
        const b = document.querySelector(${JSON.stringify(mobileCheckout)});
        const r = b.getBoundingClientRect();
        return JSON.stringify({rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.outerHTML.slice(0,500)});
      })()`)}`);
      await openCheckout(mobileCheckout);
      assert(await evaluate(`document.querySelector(".pos-payment-total").textContent.includes(${JSON.stringify(quickTotal.toFixed(2))})`));
    }
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile("generated-artifacts/pos-smart/checkout-mobile.jpg", Buffer.from(shot.data, "base64"));
    console.log("PASS checkout: no selection, zero total, covers-only table, full amount with partial balance, reset from split/Romana, quick receipt, mobile menu/order/tables; opening performs no writes");
  }
  if (process.env.POS_BOOKING_CHECK === "1") {
    bookingEnabled = true;
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: origin + "/prenota" });
    await wait(`!!document.querySelector('[data-testid="input-name"]')`);
    const fill = async (selector, value) => evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await fill('[data-testid="input-name"]', "Prenotazione test");
    await fill('[data-testid="input-phone"]', "+39 123456789");
    await wait(`!document.querySelector('[data-testid="button-submit"]').disabled`);
    await click('[data-testid="button-submit"]');
    await wait(`!!document.querySelector('[data-testid="text-booking-sent"]')`);
    assert.equal(bookingRecords[0].status, "pending");
    assert.equal(bookingRecords[0].guestName, "Prenotazione test");
    assert(await evaluate(`document.body.textContent.includes("non è valida finché")`));
    await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: origin + "/backoffice/prenotazioni" });
    await wait(`document.body.textContent.includes("Prenotazione test")`);
    await button("Tavolo / modifica", "body");
    await wait(`!!document.querySelector('[role="dialog"]')`);
    await evaluate(`(() => {
      const inputs = [...document.querySelectorAll('[role="dialog"] input[type="number"]')];
      const input = inputs.find(i => i.value === "120");
      if (!input) throw new Error("Booking duration field missing");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "90");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await button("Salva e conferma", "body");
    await wait(`!document.querySelector('[role="dialog"]')`);
    assert.equal(bookingRecords[0].status, "confirmed");
    assert.equal(bookingRecords[0].durationMinutes, 90);
    await send("Page.navigate", { url: origin + "/backoffice/fiscale" });
    await wait(`document.body.textContent.includes("Documento RT 42/1")`);
    assert(await evaluate(`document.body.textContent.includes("ID interno 73/2026")`));
    assert(await evaluate(`document.body.textContent.includes("Annullo da verificare")`));
    assert.equal(await evaluate(`[...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Annulla")`), false, "Unknown cancellation must not expose another print attempt");
    console.log("PASS public booking mobile submission stays pending, staff edits duration and confirms, RT identity distinct from internal ID and unknown void cannot be repeated. All APIs mocked.");
  }
  assert.deepEqual(errors, [], "Browser errors");
  if (process.env.POS_BILLING_CHECK !== "1") assert(!writes.some(w => /payments|fiscal|invoices|comanda/.test(w)), "No fiscal writes expected");
  console.log("PASS login, table selection, item timestamps, all advanced controls, product mutation, payment modes, mobile drawer. All APIs mocked; no live fiscal operations.");
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
  await new Promise(resolve => chrome.once("exit", resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }).catch(() => {});
}
