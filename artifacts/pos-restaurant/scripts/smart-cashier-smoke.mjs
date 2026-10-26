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
  const tables = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, number: i + 1, name: `Tavolo ${i + 1}`, seats: 4, status: i === 0 ? "occupied" : "free", activeOrderId: i === 0 ? 101 : null, activeOrderTotal: i === 0 ? "26.00" : null, roomId: i > 8 ? 2 : 1, roomName: i > 8 ? "Dehor" : "Sala", elementType: "table", posX: i % 5, posY: Math.floor(i / 5), shape: "square" }));
  const rooms = [{ id: 2, name: "Dehor", sortOrder: 1 }, { id: 3, name: "Privata", sortOrder: 2 }, { id: 1, name: "Sala", sortOrder: 0 }];
  const categories = [{ id: 1, name: "Birre", color: "#a16207" }, { id: 2, name: "Cucina", color: "#166534" }];
  const products = [{ id: 1, name: "Birra artigianale", price: "6.00", categoryId: 1, available: true }, { id: 2, name: "Burger della casa", price: "14.00", categoryId: 2, available: true }];
  const order = { id: 101, tableId: 1, tableName: "Tavolo 1", status: "open", total: "26.00", covers: 2, paidRomana: "0.00", payments: [], createdAt, updatedAt: createdAt, items: [
    { id: 11, productId: 1, productName: "Birra artigianale", productPrice: "6.00", quantity: 2, unitPrice: "6.00", subtotal: "12.00", status: "draft", phase: 0, modifiers: "[]", createdAt },
    { id: 12, productId: 2, productName: "Burger della casa", productPrice: "14.00", quantity: 1, unitPrice: "14.00", subtotal: "14.00", status: "sent", phase: 0, modifiers: "[]", createdAt },
  ] };
  let nextItemId = 13;
  let failSplit = false;
  let failLayout = false;
  let failExpand = false;
  let failQuote = false;
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
      else if (path === "/api/tables") body = [...tables].sort((a, b) => (a.sortOrder ?? a.number) - (b.sortOrder ?? b.number));
      else if (path === "/api/rooms") body = [...rooms].sort((a, b) => a.sortOrder - b.sortOrder);
      else if (path === "/api/dashboard/tables-status") body = tables;
      else if (path === "/api/categories") body = categories;
      else if (path === "/api/products") body = products;
      else if (path === "/api/dashboard/summary") body = { todayRevenue: "126.00", todayOrders: 6, openOrders: 1, occupiedTables: 1, totalTables: 14, avgOrderValue: "21.00", yesterdayRevenue: "120.00", yesterdayOrders: 6, lastWeekRevenue: "118.00", lastWeekOrders: 5 };
      else if (path === "/api/dashboard/sales-by-day") body = [{ date: "2026-10-15", revenue: "120.00", orders: 6 }, { date: "2026-10-16", revenue: "126.00", orders: 6 }];
      else if (path === "/api/orders" && request.method === "POST" && (process.env.POS_CHECKOUT_CHECK === "1" || process.env.POS_KEYPAD_CHECK === "1")) {
        Object.assign(order, JSON.parse(request.postData));
        body = order;
      }
      else if (path === "/api/orders/101/expand-items") {
        if (failExpand) { responseCode = 409; body = { error: "Separazione di prova non riuscita" }; }
        else {
          const before = order.items.length;
          order.items = order.items.flatMap(item => Array.from({ length: item.quantity }, (_, index) => ({
            ...item, id: index === 0 ? item.id : nextItemId++, quantity: 1, subtotal: item.unitPrice,
          })));
          body = { expanded: order.items.length - before };
        }
      }
      else if (path === "/api/payments/selection-preview" || (path === "/api/payments" && JSON.parse(request.postData || "{}").partial)) {
        const input = JSON.parse(request.postData);
        const selected = input.selectedItems ?? [];
        const amount = (selected.reduce((sum, chosen) => sum + Math.round(Number(order.items.find(item => item.id === chosen.itemId)?.unitPrice) * 100) * chosen.quantity, 0)
          + (input.coversCount ?? 0) * Math.round(Number(order.coverPrice ?? settings.cover_price) * 100)) / 100;
        if (failQuote || amount.toFixed(2) !== input.amount || selected.some(chosen => !order.items.some(item => item.id === chosen.itemId && item.quantity >= chosen.quantity))) {
          responseCode = 409; body = { error: "Quantità o importo non validi" };
        } else if (path.endsWith("selection-preview")) body = { amount: amount.toFixed(2) };
        else if (failSplit) { responseCode = 502; body = { error: "RT di prova non confermata: quantità non scalate" }; }
        else {
          order.items = order.items.flatMap(item => {
            const remaining = item.quantity - (selected.find(chosen => chosen.itemId === item.id)?.quantity ?? 0);
            return remaining > 0 ? [{ ...item, quantity: remaining, subtotal: (remaining * Number(item.unitPrice)).toFixed(2) }] : [];
          });
          order.covers -= input.coversCount ?? 0;
          body = { id: 701, ...input, selectionApplied: true, orderClosed: order.items.length === 0 && order.covers === 0, fiscal: { rtOk: true, receiptId: 701 } };
        }
      }
      else if (/^\/api\/tables\/\d+$/.test(path) && request.method === "PATCH") {
        const table = tables.find(table => table.id === Number(path.split("/").pop()));
        if (failLayout) { responseCode = 503; body = { error: "Salvataggio di prova non riuscito" }; }
        else { Object.assign(table, JSON.parse(request.postData)); body = table; }
      }
      else if (path === "/api/pos/sale" && process.env.POS_SPLIT_CHECK === "1") body = { approved: true };
      else if (path === "/api/tables/reorder") {
        for (const input of JSON.parse(request.postData)) Object.assign(tables.find(table => table.id === input.id), { sortOrder: input.sortOrder });
        body = { success: true };
      }
      else if (path === "/api/orders/101") {
        order.total = order.items.reduce((total, item) => total + Number(item.subtotal), 0).toFixed(2);
        body = order;
      }
      else if (/^\/api\/orders\/101\/items\/\d+$/.test(path) && request.method === "PATCH") {
        body = order.items.find(item => item.id === Number(path.split("/").pop()));
        assert(body, `Missing fixture item: ${path}`);
        Object.assign(body, JSON.parse(request.postData));
        body.subtotal = (body.quantity * Number(body.unitPrice)).toFixed(2);
      } else if (path === "/api/orders/101/items" && request.method === "POST") {
        const input = JSON.parse(request.postData);
        const p = products.find(p => p.id === input.productId);
        body = { ...input, id: nextItemId++, productName: p.name, productPrice: p.price, subtotal: (input.quantity * Number(input.unitPrice)).toFixed(2), status: "draft", createdAt };
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
  const input = async (selector, value) => { await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw Error("Missing input: " + ${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", {bubbles:true}));
  })()`); await new Promise(r => setTimeout(r, 60)); };
  const showProducts = async () => {
    if (await evaluate(`matchMedia("(max-width:760px)").matches`)) await click('[data-testid="button-open-categories-mobile"]');
    else await click('[data-testid="tab-grp"]');
    await click('[data-testid="category-1"]');
    await click(".pos-category-strip > button");
  };
  const showMap = async () => {
    if (await evaluate(`matchMedia("(max-width:760px)").matches`)) await button("Tavoli", ".pos-mobile-nav");
    else await click('[data-testid="tab-tavl"]');
    await wait(`!!document.querySelector('[data-testid="map-table-1"]')`);
  };
  const selectFirstTable = async () => {
    await showMap();
    await click('[data-testid="map-table-1"]');
    await showProducts();
  };
  await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: origin });
  await wait(`document.body.textContent.includes("Inserisci il tuo PIN")`);
  // Exercise the actual login screen; the test API accepts this fixture PIN.
  for (let i = 0; i < 4; i++) await button("1", "body");
  await wait(`!!document.querySelector('[data-testid="map-table-1"]')`);
  assert.equal(await evaluate(`!!document.querySelector(".pos-tables, #pos-tables, .pos-table-scrim")`), false, "No separate table column or drawer");
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
    await wait(`!!document.querySelector('[data-testid="map-table-1"]')`);
    await checkModes(asporto, delivery);
  }
  console.log("PASS Asporto/Delivery: missing settings and all four combinations saved through real backoffice controls (mocked API)");
  await selectFirstTable();
  await wait(`document.querySelectorAll(".pos-item-time").length === 2`);
  await wait(`document.querySelectorAll(".pos-product-grid > button").length === 2`);
  assert.equal(await evaluate(`document.querySelectorAll(".pos-phase-selector > button").length`), 4);
  await button("F3", ".pos-phase-selector");
  assert(await evaluate(`document.querySelector(".pos-phase-selector > button:nth-of-type(3)").getAttribute("aria-pressed") === "true"`), "Phase selection must update");
  await button("F1", ".pos-phase-selector");
  await wait(`!!document.querySelector("#pos-more-operations")`);
  const operations = await evaluate(`document.querySelector("#pos-more-operations").textContent`);
  for (const name of ["Sconto", "Lotteria", "Preconto", "Separato", "Romana", "Espandi", "Cancella", "Annulla ordine", "Tavolo"]) assert(operations.includes(name), `Operation lost: ${name}`);
  for (const name of ["Sospeso", "Cassetto"]) assert(!operations.includes(name), `Removed operation still visible: ${name}`);
  assert.equal(await evaluate(`!!document.querySelector(".pos-more-toggle")`), false, "Keypad must not require opening a menu");
  await click(".pos-product-grid > button");
  await wait(`document.querySelectorAll(".pos-order-item").length === 3`);
  assert.equal(await evaluate(`!!document.querySelector('[data-testid="dialog-keypad"]')`), false, "One tap must add one product without asking for quantity");
  assert.equal(order.items[0].quantity, 2, "Repeating a product must not aggregate into its existing row");
  assert.equal(order.items.at(-1).quantity, 1);
  assert.equal(writes.includes("PATCH /api/orders/101/items/11"), false, "Repeated product must create its own row, not patch another one");
  await click(".pos-product-grid > button:nth-child(2)");
  await wait(`document.querySelectorAll(".pos-order-item").length === 4`);
  assert(writes.includes("POST /api/orders/101/items"), "Product must call the real mutation route");
  assert(payloads.some(p => p.path === "/api/orders/101/items" && p.data.productId === 2 && p.data.quantity === 1 && p.data.unitPrice === "14.00"), "New product must be added as one unit at its menu price");
  assert.equal(await evaluate(`!!document.querySelector('[data-testid="dialog-keypad"]')`), false);
  await click(".pos-order-actions > button:last-child");
  await wait(`document.querySelector(".pos-menu-panel").textContent.includes("Romana")`);
  const payment = await evaluate(`document.querySelector(".pos-menu-panel").textContent`);
  for (const name of ["Separato", "Romana", "CONTANTI"]) assert(payment.includes(name), `Payment mode lost: ${name}`);
  assert(!payment.includes("€200"), "Preset cash denomination buttons must be removed");
  await input('[data-testid="input-cash-received"]', "100");
  assert.equal(await evaluate(`document.querySelector('[data-testid="input-cash-received"]').value`), "100");
  await click('[data-testid="button-cash-keypad"]');
  await wait(`!!document.querySelector('[data-testid="dialog-keypad"]')`);
  await click('[data-testid="keypad-key-5"]');
  await click('[data-testid="keypad-key-0"]');
  await click('[data-testid="keypad-key-."]');
  await click('[data-testid="keypad-key-5"]');
  await click('[data-testid="keypad-confirm"]');
  await wait(`document.querySelector('[data-testid="input-cash-received"]').value === "50.50"`);
  assert(!writes.some(w => w.includes("/api/payments")), "Setting received cash must not take payment");
  console.log("PASS cash: manual entry and decimal touch keypad, no preset denominations, no payment on amount entry");
  await showProducts();
  await mkdir("generated-artifacts/pos-smart", { recursive: true });
  for (const [width, height] of [[1440, 900], [1024, 768], [1024, 640], [800, 600], [390, 844]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 250));
    await click('[data-testid="button-user-menu"]');
    await wait(`!!document.querySelector('[data-testid="user-menu-panel"]')`);
    assert(await evaluate(`(() => {
      const luminance = color => {
        const rgb=color.match(/[\\d.]+/g).slice(0,3).map(Number).map(n=>n/255);
        const v=rgb.map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
        return .2126*v[0]+.7152*v[1]+.0722*v[2];
      };
      const panel=document.querySelector('[data-testid="user-menu-panel"]');
      const p=panel.getBoundingClientRect();
      return p.left>=0 && p.right<=innerWidth && p.bottom<=innerHeight &&
        ["button-user-backoffice","button-user-logout"].every(id=>{
          const el=document.querySelector('[data-testid="'+id+'"]'), r=el.getBoundingClientRect();
          const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          const style=getComputedStyle(el), bg=luminance(getComputedStyle(panel).backgroundColor), fg=luminance(style.color);
          return r.height>=48 && r.top>=p.top && r.bottom<=p.bottom && el.contains(hit) &&
            (Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)>=4.5;
        });
    })()`), `User menu must show readable, unobscured touch actions at ${width}×${height}`);
    const userShot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile(`generated-artifacts/pos-smart/user-menu-${width}x${height}.jpg`, Buffer.from(userShot.data, "base64"));
    await click('[data-testid="user-menu-backdrop"]');
    if (width <= 760) {
      await click(".pos-mobile-nav > button:nth-child(2)");
      await wait(`document.querySelector(".pos-order-panel").getBoundingClientRect().width > 0`);
    }
    const layout = await evaluate(`(() => { const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom}; }; return {body:document.documentElement.scrollWidth, menu:rect(".pos-menu-panel"), order:rect(".pos-order-panel"), actions:rect(".pos-order-actions")}; })()`);
    assert(layout.body <= width, `Horizontal page overflow at ${width}`);
    assert(await evaluate(`(() => {
      const dock=document.querySelector('[data-testid="persistent-keypad"]');
      const r=dock.getBoundingClientRect();
      const primary=[...dock.querySelectorAll('[data-testid^="persistent-key-"], [data-testid="persistent-apply-qty"], [data-testid="persistent-apply-price"]')];
      return r.width>0 && r.height>0 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && primary.length===14 &&
        primary.every(button=>{
          const k=button.getBoundingClientRect();
          return k.width>=28 && k.height>=28 && k.top>=r.top && k.bottom<=r.bottom;
        });
    })()`), `Persistent keypad and its primary functions must fit at ${width}×${height}`);
    assert(await evaluate(`(() => {
      const ops=document.querySelector(".pos-dock-ops");
      for(const b of ops.querySelectorAll("button")) {
        b.scrollIntoView({block:"nearest",inline:"nearest"});
        const r=b.getBoundingClientRect(), p=ops.getBoundingClientRect();
        if(r.left<p.left-1 || r.right>p.right+1 || r.top<p.top-1 || r.bottom>p.bottom+1) throw Error(JSON.stringify({text:b.textContent,button:r.toJSON(),ops:p.toJSON()}));
      }
      ops.scrollTop=0;ops.scrollLeft=0;return true;
    })()`), `All right-side operations must remain reachable at ${width}×${height}`);
    if (width > 760) {
      assert(layout.menu.x <= 1 && layout.menu.x < layout.order.x, `Unified workspace must use the removed table column at ${width}`);
      assert(layout.actions.bottom <= height, `Actions clipped at ${width}`);
      assert(layout.menu.width > 200 && layout.order.right <= width, `Panels clipped at ${width}`);
      assert(await evaluate(`(() => {
        const order=document.querySelector(".pos-order-panel"), dock=document.querySelector('[data-testid="persistent-keypad"]');
        const k=dock.getBoundingClientRect(), r=order.getBoundingClientRect(), m=document.querySelector(".pos-menu-panel").getBoundingClientRect();
        return order.contains(dock) && k.left>=r.left && k.right<=r.right+1 && k.left>=m.right-1 && m.bottom>=r.bottom-1 &&
          [...dock.querySelectorAll(".pos-dock-ops button")].every(b=>b.getBoundingClientRect().left>=r.left);
      })()`), `Keypad/actions must stay on the right and the workspace must use the full height at ${width}×${height}`);
    } else {
      await showMap();
      assert(await evaluate(`document.querySelector('[data-testid="map-viewport"]').getBoundingClientRect().width > 0`), "Mobile Tavoli must open the unified map");
      assert(await evaluate(`document.querySelector('[data-testid="persistent-keypad"]').getBoundingClientRect().height === 0`), "Mobile map must not lose space to the comanda keypad");
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
    assert(await evaluate(`document.querySelector(".pos-payment-panel").getBoundingClientRect().height >= innerHeight * .42`), `Payment must have useful height at ${width}×${height}`);
    await evaluate(`document.querySelector(".pos-payment-panel > button:last-of-type").scrollIntoView({block:"end"})`);
    const reachable = await evaluate(`(() => { const b = document.querySelector(".pos-payment-panel > button:last-of-type").getBoundingClientRect(); const p = document.querySelector(".pos-payment-panel").getBoundingClientRect(); return b.top >= p.top - 1 && b.bottom <= p.bottom + 1; })()`);
    assert(reachable, `Payment confirmation unreachable at ${width}×${height}`);
    const paymentShot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile(`generated-artifacts/pos-smart/payment-${width}x${height}.jpg`, Buffer.from(paymentShot.data, "base64"));
    await showMap();
    await wait(`document.querySelector(".pos-menu-panel").textContent.includes("Mappa Tavoli")`);
    assert(await evaluate(`(() => {
      const toolbar=document.querySelector(".pos-map-toolbar").getBoundingClientRect();
      const selectors=['[data-testid="button-map-back"]','[data-testid="room-selector"]','[data-testid="button-map-book"]'];
      return toolbar.height<=58 && selectors.every(s=>{
        const r=document.querySelector(s).getBoundingClientRect();
        const ok=r.width>0 && r.height>=44 && r.top>=toolbar.top-1 && r.bottom<=toolbar.bottom+1 && r.left>=0 && r.right<=innerWidth;
        if(!ok) throw Error(JSON.stringify({selector:s,rect:r.toJSON(),toolbar:toolbar.toJSON()}));
        return true;
      });
    })()`), `Back, rooms and booking must share one touch-friendly row at ${width}×${height}`);
    await wait(`document.querySelectorAll(".pos-menu-panel .origin-top-left button").length > 0`);
    assert(await evaluate(`(() => { const r = document.querySelector(".pos-menu-panel .origin-top-left button").getBoundingClientRect(); return r.width >= 30 && r.height >= 30 && r.right <= innerWidth && r.bottom <= innerHeight; })()`), `Map tables not visible at ${width}×${height}`);
    const mapShot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile(`generated-artifacts/pos-smart/map-${width}x${height}.jpg`, Buffer.from(mapShot.data, "base64"));
    if (width <= 760) await click('[data-testid="button-open-categories-mobile"]');
    else await click('[data-testid="tab-grp"]');
    await wait(`!!document.querySelector('[data-testid="category-1"]')`);
    assert(await evaluate(`(() => {
      const buttons=[...document.querySelectorAll(".pos-work-tabs > button")];
      return buttons.length===4 && buttons.every(button => {
        const r=button.getBoundingClientRect();
        return r.height>=48 && r.width>=44 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;
      });
    })()`), `Main navigation must remain prominent and visible at ${width}`);
    assert(await evaluate(`(() => {
      const button=document.querySelector('[data-testid="category-1"]'), r=button.getBoundingClientRect();
      return r.height>=80 && r.width>=110 && r.left>=0 && r.right<=innerWidth;
    })()`), `Category targets must be large and fit the screen at ${width}`);
    const categoryShot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile(`generated-artifacts/pos-smart/categories-${width}x${height}.jpg`, Buffer.from(categoryShot.data, "base64"));
    await showProducts();
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
    await showProducts();
    await click('[data-testid="edit-order-item-11"]');
    await wait(`document.querySelector('[data-testid="dialog-keypad"]')`);
    await click('[data-testid="keypad-field-quantity"]');
    await click('[data-testid="keypad-key-5"]');
    await click('[data-testid="keypad-field-unitPrice"]');
    await click('[data-testid="keypad-key-8"]');
    await click('[data-testid="keypad-confirm"]');
    await wait(`!document.querySelector('[data-testid="dialog-keypad"]') && document.querySelector(".pos-order-item").textContent.includes("5")`);
    assert(payloads.some(p => p.path.endsWith("/items/11") && p.data.quantity === 5 && p.data.unitPrice === "8.00"), "Edit quantity and price must reach real mutation handler");
    await click(".pos-product-grid > button");
    await wait(`document.querySelectorAll(".pos-order-item").length === 5`);
    assert.equal(await evaluate(`!!document.querySelector('[data-testid="dialog-keypad"]')`), false);
    assert(payloads.some(p => p.path.endsWith("/101/items") && p.data.productId === 1 && p.data.quantity === 1 && p.data.unitPrice === "6.00"), "One-tap addition must keep the menu price after editing a different row");
    await click('.pos-order-item:last-child [data-testid^="edit-order-item-"]');
    await wait(`document.querySelector('[data-testid="dialog-keypad"]')`);
    await click('[data-testid="keypad-field-quantity"]'); await click('[data-testid="keypad-key-3"]');
    await click('[data-testid="keypad-field-unitPrice"]'); await click('[data-testid="keypad-key-7"]');
    await click('[data-testid="keypad-confirm"]');
    await wait(`document.querySelector(".pos-order-item:last-child").textContent.includes("7.00")`);
    assert(payloads.some(p => /\/101\/items\/\d+$/.test(p.path) && p.data.quantity === 3 && p.data.unitPrice === "7.00"), "Quantity and price must remain editable from the order row");
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
    console.log("PASS one-tap product addition, row quantity/price keypad and pinned per-order covers");

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
    await wait(`!!document.querySelector('[data-testid="map-table-1"]')`);
    await selectFirstTable();
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
    await wait(`document.querySelector('[data-testid="text-invoice-xml"]')?.textContent.includes("<Numero>1/23</Numero>")`);
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
    await selectFirstTable();
    await click(".pos-order-actions > button:last-child");
    await wait(`document.querySelector('[data-testid="input-lottery-code"]').value === ""`);
    await showProducts();
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
    await wait(`!!document.querySelector('[data-testid="map-table-1"]')`);
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
    await selectFirstTable();
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
    await wait(`!!document.querySelector('[data-testid="map-table-1"]')`);
    await selectFirstTable();
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
    for (const section of ["Categorie", "Conto", "Tavoli"]) {
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
  if (process.env.POS_SPLIT_CHECK === "1") {
    await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
    const sku = { ...order.items[0], id: 11, productId: 1, productName: "Birra da separare", quantity: 3, unitPrice: "6.50", subtotal: "19.50", phase: 0, status: "sent", modifiers: "[]" };
    const loadThree = async () => {
      order.items = [{ ...sku }]; order.covers = 0; order.paidRomana = "0"; order.status = "open";
      await send("Page.navigate", { url: origin + "/" });
      await wait(`!!document.querySelector('[data-testid="map-viewport"]')`);
      assert(await evaluate(`document.querySelector('[data-testid="tab-tavl"]').getAttribute("aria-pressed") === "true"`), "Map must be the default view");
      assert.equal(await evaluate(`!!document.querySelector('[data-testid="tab-art"], [data-testid="tab-var"]')`), false, "Menu and Variazioni tabs must not be visible");
      assert(await evaluate(`(() => { const m=document.querySelector('[data-testid="map-viewport"]');return m.scrollWidth<=m.clientWidth+1 && m.scrollHeight<=m.clientHeight+1; })()`), "Map must fit without scroll");
      await wait(`!!document.querySelector('[data-testid="room-button-1"]')`);
      assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-testid="room-selector"] button')).map(b=>b.textContent.trim())`), ["Sala", "Dehor", "Privata"], "Rooms must respect backoffice sort order, including empty rooms");
      const canvasSize = await evaluate(`(()=>{const c=document.querySelector('[data-testid="map-canvas"]');return [c.dataset.canvasW,c.dataset.canvasH,c.dataset.scale]})()`);
      await click('[data-testid="room-button-2"]');
      await wait(`!!document.querySelector('[data-testid="map-table-10"]')`);
      assert.deepEqual(await evaluate(`(()=>{const c=document.querySelector('[data-testid="map-canvas"]');return [c.dataset.canvasW,c.dataset.canvasH,c.dataset.scale]})()`), canvasSize, "Map extent and scale must stay the same across rooms");
      await click('[data-testid="room-button-3"]');
      await wait(`!!document.querySelector('[data-testid="text-map-empty"]')`);
      await click('[data-testid="room-button-1"]');
      await wait(`!!document.querySelector('[data-testid="map-table-1"]')`);
      assert(await evaluate(`document.querySelector('[data-testid="button-header-log"]').closest('header') !== null && document.querySelector('[data-testid="button-header-map"]').closest('header') !== null`), "Service controls must be in the headbar");
      assert(await evaluate(`document.querySelector(".pos-order-panel").getBoundingClientRect().width >= 340`), "1024px screens need a wider order panel");
      await selectFirstTable();
      await wait(`document.querySelectorAll(".pos-order-item").length === 1`);
    };
    const openSeparated = async () => {
      await click('[data-testid="button-open-checkout"]');
      await button("Separato", ".pos-menu-panel");
      await wait(`!!document.querySelector('[data-testid="split-selection"]')`);
    };
    await loadThree();
    await openSeparated();
    await click('[aria-label="Aggiungi un pezzo di Birra da separare"]');
    await wait(`document.querySelector('[data-testid="button-pay-split"]').textContent.includes("6.50")`);
    failSplit = true;
    await click('[data-testid="button-pay-split"]');
    await wait(`document.body.textContent.includes("RT di prova non confermata")`);
    assert.equal(order.items[0].quantity, 3, "Failed fiscal issue must not deduct any units");
    const failed = payloads.filter(p => p.path === "/api/payments" && p.data.partial).at(-1).data;
    assert.deepEqual(failed.selectedItems, [{ itemId: 11, quantity: 1 }]);
    assert.equal(failed.amount, "6.50");
    failSplit = false;
    await click('[data-testid="button-pay-split"]');
    await wait(`document.querySelector('[data-testid="split-row-11"]').textContent.includes("max 2")`);
    assert.equal(order.items[0].quantity, 2);
    const retried = payloads.filter(p => p.path === "/api/payments" && p.data.partial).at(-1).data;
    assert.equal(retried.operationId, failed.operationId, "Retry must retain its operation identifier");
    assert.equal(retried.method, "cash");
    assert.equal(retried.amount, "6.50");
    await wait(`document.querySelector('[data-testid="button-pay-split"]').disabled`);
    assert.equal(writes.some(path => path === "DELETE /api/orders/101/items/11"), false, "Client must not delete the whole SKU after paying one unit");
    settings.pos_pax_enabled = "true";
    await loadThree();
    await openSeparated();
    await click('[aria-label="Aggiungi un pezzo di Birra da separare"]');
    await button("Carta", ".pos-menu-panel");
    failQuote = true;
    const posBefore = writes.filter(path => path === "POST /api/pos/sale").length;
    await click('[data-testid="button-pay-split"]');
    await wait(`document.querySelector('[role="alert"]')?.textContent.includes("Quantità o importo non validi")`);
    assert.equal(writes.filter(path => path === "POST /api/pos/sale").length, posBefore, "Stale selection must not start the POS");
    failQuote = false;
    failSplit = true;
    await click('[data-testid="button-pay-split"]');
    await wait(`document.body.textContent.includes("RT di prova non confermata")`);
    assert.equal(writes.filter(path => path === "POST /api/pos/sale").length, posBefore + 1);
    assert.equal(order.items[0].quantity, 3);
    failSplit = false;
    await click('[data-testid="button-pay-split"]');
    await wait(`document.querySelector('[data-testid="split-row-11"]').textContent.includes("max 2")`);
    const card = payloads.filter(p => p.path === "/api/payments" && p.data.partial).at(-1).data;
    assert.equal(card.method, "card");
    assert.equal(card.amount, "6.50");
    assert.deepEqual(card.selectedItems, [{ itemId: 11, quantity: 1 }]);
    assert.equal(payloads.filter(p => p.path === "/api/pos/sale").at(-1).data.amountCents, 650);
    assert.equal(writes.filter(path => path === "POST /api/pos/sale").length, posBefore + 1, "An approved POS transaction must not be started again after a fiscal failure");
    assert.equal(order.items[0].quantity, 2);
    settings.pos_pax_enabled = "false";
    await loadThree();
    failExpand = true;
    await button("Espandi", "#pos-more-operations");
    await wait(`document.body.textContent.includes("Errore esplosione")`);
    assert.equal(order.items[0].quantity, 3);
    failExpand = false;
    await button("Espandi", "#pos-more-operations");
    await wait(`document.querySelectorAll(".pos-order-item").length === 3`);
    assert(order.items.every(row => row.quantity === 1 && row.status === "sent" && row.unitPrice === "6.50"));
    await openSeparated();
    await click('[data-testid="split-row-11"] button');
    await click('[data-testid="button-pay-split"]');
    await wait(`document.querySelectorAll('[data-testid^="split-row-"]').length === 2`);
    assert.equal(order.items.length, 2);
    assert(order.items.every(row => row.quantity === 1));
    const mapTable = { ...tables[7] };
    Object.assign(tables[7], { posX: 40, posY: 40, rotation: 45, sizeScale: 1.8 });
    await send("Page.navigate", { url: origin + "/" });
    await wait(`!!document.querySelector('[data-testid="map-canvas"] button')`);
    await wait(`(() => {
      const v=document.querySelector('[data-testid="map-viewport"]').getBoundingClientRect();
      return [...document.querySelectorAll('[data-testid="map-canvas"] button')].every(button => {
        const r=button.getBoundingClientRect();
        return r.left>=v.left-1 && r.top>=v.top-1 && r.right<=v.right+1 && r.bottom<=v.bottom+1;
      });
    })()`);
    Object.assign(tables[7], mapTable);
    await send("Page.navigate", { url: new URL("/backoffice/tables", origin).href });
    await wait(`!!document.querySelector('[data-testid="map-editor-table-1"]')`);
    const drag = async (dx, dy) => {
      const point = await evaluate(`(() => {const r=document.querySelector('[data-testid="map-editor-table-1"]').firstElementChild.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + dx, y: point.y + dy, button: "left", buttons: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + dx, y: point.y + dy, button: "left", clickCount: 1 });
    };
    // Drop into an empty cell, not beneath a later sibling at the same coordinates.
    await drag(160, 240);
    await wait(`document.body.textContent.includes("Posizione salvata")`);
    assert.equal(tables[0].posX, 2); assert.equal(tables[0].posY, 3);
    await send("Page.navigate", { url: new URL("/backoffice/tables", origin).href });
    await wait(`document.querySelector('[data-testid="map-editor-table-1"]')?.style.left === "163px"`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="map-editor-table-1"]').style.top`), "243px");
    failLayout = true;
    await drag(80, 0);
    await wait(`document.body.textContent.includes("Salvataggio non riuscito")`);
    await wait(`document.querySelector('[data-testid="map-editor-table-1"]').style.left === "163px"`);
    assert.equal(tables[0].posX, 2, "Failed save must restore the saved coordinates");
    failLayout = false;
    const touchPoint = await evaluate(`(() => {const r=document.querySelector('[data-testid="map-editor-table-1"]').firstElementChild.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint] });
    await wait(`document.querySelector('[data-testid="map-editor-table-1"]').firstElementChild.classList.contains("opacity-90")`);
    await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchPoint.x, y: touchPoint.y + 80 }] });
    await wait(`document.querySelector('[data-testid="map-editor-table-1"]').style.top === "323px"`);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await wait(`document.body.textContent.includes("Posizione salvata")`);
    assert.equal(tables[0].posY, 4, "Touch movement must save the last coordinates");
    await send("Page.navigate", { url: new URL("/backoffice/tables", origin).href });
    await wait(`document.querySelector('[data-testid="map-editor-table-1"]')?.style.top === "323px"`);
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile("generated-artifacts/pos-smart/table-layout.jpg", Buffer.from(shot.data, "base64"));
    console.log("PASS selected quantities: cash/card one of three, exact POS amount, RT failure preserves quantities, stable retry, atomic expand, single-unit split; rotated/distant map fits; BO mouse/touch drag persists after reload and rolls back failed saves");
  }
  if (process.env.POS_KEYPAD_CHECK === "1") {
    await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
    const fresh = async (withTable) => {
      order.items = []; order.covers = 0; order.paidRomana = "0"; order.status = "open"; order.tableId = 1; order.total = "0.00";
      await send("Page.navigate", { url: origin + "/" });
      await wait(`!!document.querySelector('[data-testid="map-table-1"]')`);
      if (withTable) await selectFirstTable();
      else await showProducts();
    };
    const key = async value => click(`[data-testid="persistent-key-${value}"]`);
    await fresh(true);
    await evaluate(`(() => {const button=document.querySelector(".pos-product-grid > button");button.click();button.click();button.click();})()`);
    await wait(`document.querySelectorAll(".pos-order-item").length === 3`);
    assert.equal(new Set(order.items.map(item => item.id)).size, 3);
    assert(order.items.every(item => item.quantity === 1 && item.unitPrice === "6.00"), "Fast repeated taps must create distinct unit rows");
    const first = order.items[0].id;
    await click(`[data-testid="order-item-${first}"]`);
    assert.equal(await evaluate(`!!document.querySelector('[data-testid="dialog-keypad"]')`), false, "Row selection must use the persistent keypad without forcing a modal");
    await key("2");
    await click('[data-testid="persistent-apply-qty"]');
    await wait(`document.querySelector('[data-testid="order-item-${first}"]').textContent.includes("× 2")`);
    assert.equal(order.items[0].quantity, 2);
    await key("8"); await key("dot"); await key("5");
    await click('[data-testid="persistent-apply-price"]');
    await wait(`document.querySelector('[data-testid="order-item-${first}"]').textContent.includes("8.50")`);
    assert.equal(order.items[0].unitPrice, "8.50");
    assert(order.items.slice(1).every(item => item.quantity === 1 && item.unitPrice === "6.00"), "Editing one row must not affect other identical products");
    await key("9"); await key("clear");
    assert.equal(await evaluate(`document.querySelector('[data-testid="persistent-buffer"]').textContent.includes("9")`), false);
    await fresh(true);
    await key("3");
    await click(".pos-product-grid > button");
    await wait(`document.querySelectorAll(".pos-order-item").length === 3`);
    assert(order.items.every(item => item.quantity === 1 && item.unitPrice === "6.00"), "Prepared quantity must add separate units, not change their price");
    await click('[data-testid="persistent-apply-price"]');
    await key("7"); await key("dot"); await key("5");
    await click(".pos-product-grid > button");
    await wait(`document.querySelectorAll(".pos-order-item").length === 4`);
    assert.equal(order.items.at(-1).unitPrice, "7.50");
    assert.equal(order.items.at(-1).quantity, 1);
    await fresh(false);
    const ordersBefore = writes.filter(write => write === "POST /api/orders").length;
    await evaluate(`(() => {const button=document.querySelector(".pos-product-grid > button");button.click();button.click();button.click();})()`);
    await wait(`document.querySelectorAll(".pos-order-item").length === 3`);
    assert.equal(writes.filter(write => write === "POST /api/orders").length, ordersBefore + 1, "Fast taps without a table must share a single quick order");
    assert(order.items.every(item => item.quantity === 1));
    console.log("PASS persistent keypad: selection without modal, quantity/decimal price/clear, prepared quantity as separate rows, price override, triple taps create three rows and a single quick order");
  }
  assert.deepEqual(errors, [], "Browser errors");
  if (process.env.POS_BILLING_CHECK !== "1" && process.env.POS_SPLIT_CHECK !== "1") assert(!writes.some(w => /payments|fiscal|invoices|comanda/.test(w)), "No fiscal writes expected");
  console.log("PASS login, unified map table selection, item timestamps, all advanced controls, product mutation, payment modes and responsive category/navigation targets. All APIs mocked; no live fiscal operations.");
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
  await new Promise(resolve => chrome.once("exit", resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }).catch(() => {});
}
