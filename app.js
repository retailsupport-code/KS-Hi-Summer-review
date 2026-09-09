/* =========================================================================
   Hi Summer — Store Sale Performance
   -------------------------------------------------------------------------
   Three live Google Sheet CSVs feed this page. Edit the sheets any time —
   this page re-fetches on load and every 5 minutes, no redeploy needed.
   ========================================================================= */

const SALES_CSV_URL   = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS9ux4Z_Kg8W1eGFF1Eylx-RerUb-LQBYyNX5SnCKnVNIsG-TLOiYdCzy1Ft1i1qnTToznNP8n5Igwe/pub?gid=1664411700&single=true&output=csv";
const IMG_CSV_URL     = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS9ux4Z_Kg8W1eGFF1Eylx-RerUb-LQBYyNX5SnCKnVNIsG-TLOiYdCzy1Ft1i1qnTToznNP8n5Igwe/pub?gid=0&single=true&output=csv";
const REMARKS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS9ux4Z_Kg8W1eGFF1Eylx-RerUb-LQBYyNX5SnCKnVNIsG-TLOiYdCzy1Ft1i1qnTToznNP8n5Igwe/pub?gid=2094415143&single=true&output=csv";

const REFRESH_MS = 5 * 60 * 1000;

let DATA = {};          // { SKU: { product, fileId, imageUrl, remarks, orderTotal, saleTotal, stores:[{store,order,sale,ach}] } }
let skuKeys = [];
let allStores = new Set();
let currentIndex = 0;
let loadSeq = 0;

function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

async function fetchCsv(url) {
  const res = await fetch(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching sheet`);
  const text = await res.text();
  const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  return parsed.data;
}

function setPulse(kind, text) {
  const el = document.getElementById("pulse");
  el.className = "pulse" + (kind ? " " + kind : "");
  document.getElementById("pulseText").textContent = text;
}
function showError(msg) {
  console.error(msg);
}
function hideError() {}

async function loadAll() {
  const seq = ++loadSeq;
  const btn = document.getElementById("refreshBtn");
  btn.disabled = true;
  setPulse("loading", "Connecting…");

  try {
    const [salesRows, imgRows, remarksRows] = await Promise.all([
      fetchCsv(SALES_CSV_URL),
      fetchCsv(IMG_CSV_URL),
      fetchCsv(REMARKS_CSV_URL),
    ]);

    if (seq !== loadSeq) return; // a newer request already landed

    // Image map: Item -> first fileId / direct URL seen
    const imgMap = {};
    for (const row of imgRows) {
      const item = (row["Item"] || "").trim();
      if (!item || imgMap[item]) continue;
      imgMap[item] = {
        fileId: (row["File ID"] || "").trim() || null,
        url: (row["Direct Image URL"] || "").trim() || null,
      };
    }

    // Remarks map: Item -> remarks
    const remarksMap = {};
    for (const row of remarksRows) {
      const item = (row["Item"] || "").trim();
      if (!item) continue;
      const r = (row["Remarks"] || "").trim();
      if (r) remarksMap[item] = r; // keep latest non-empty
    }

    // Aggregate sales by Item -> store -> {order, sale}
    const agg = {};
    const storesSeen = new Set();
    for (const row of salesRows) {
      const item = (row["Item"] || "").trim();
      const store = (row["Customer"] || "").trim();
      if (!item || !store) continue;
      const orderQty = num(row["Order Qty"]);
      const saleQty = num(row["Sale Qty"]);
      const product = (row["Product"] || "").trim();

      if (!agg[item]) agg[item] = { product, storeMap: {}, orderTotal: 0, saleTotal: 0 };
      if (!agg[item].storeMap[store]) agg[item].storeMap[store] = { order: 0, sale: 0 };
      agg[item].storeMap[store].order += orderQty;
      agg[item].storeMap[store].sale += saleQty;
      agg[item].orderTotal += orderQty;
      agg[item].saleTotal += saleQty;
      storesSeen.add(store);
    }

    const newData = {};
    for (const item of Object.keys(agg)) {
      const a = agg[item];
      const stores = Object.entries(a.storeMap).map(([store, v]) => ({
        store,
        order: v.order,
        sale: v.sale,
        ach: v.order > 0 ? (v.sale / v.order) * 100 : null,
      }));
      const img = imgMap[item] || {};
      newData[item] = {
        product: a.product,
        fileId: img.fileId || null,
        imageUrl: img.url || null,
        remarks: remarksMap[item] || "",
        orderTotal: a.orderTotal,
        saleTotal: a.saleTotal,
        storeCount: stores.length,
        stores,
      };
    }

    DATA = newData;
    skuKeys = Object.keys(DATA).sort();
    allStores = storesSeen;

    document.getElementById("statSkus").textContent = skuKeys.length;
    document.getElementById("statStores").textContent = allStores.size;
    document.getElementById("statSaleQty").textContent = skuKeys.reduce((s, k) => s + DATA[k].saleTotal, 0).toLocaleString();

    hideError();
    setPulse("", "Live · updated " + new Date().toLocaleTimeString());

    if (!skuKeys.includes(skuInput.value)) {
      currentIndex = 0;
      if (skuKeys.length) selectSku(skuKeys[0]);
    } else {
      selectSku(skuInput.value);
    }

  } catch (err) {
    if (seq !== loadSeq) return;
    setPulse("error", "Live sheet unavailable");
    showError(err.message || "Unable to load the sheets.");
  }

  if (seq === loadSeq) btn.disabled = false;
}

/* ---------------------------- UI wiring ---------------------------- */

const skuInput = document.getElementById("skuInput");
const comboList = document.getElementById("comboList");
const combo = document.getElementById("combo");

function renderList(filter) {
  const f = (filter || "").trim().toUpperCase();
  const matches = skuKeys.filter(k => k.toUpperCase().includes(f) || (DATA[k].product || "").toUpperCase().includes(f));
  comboList.innerHTML = matches.slice(0, 200).map(k => `
    <div class="combo-item" data-sku="${k}">
      <span class="ci-sku">${k}</span>
      <span class="ci-meta">${DATA[k].product || ""} · ${DATA[k].saleTotal} sold</span>
    </div>`).join("") || '<div class="combo-item" style="cursor:default;color:var(--muted);">No matching SKU</div>';
  comboList.classList.add("open");
}

skuInput.addEventListener("focus", () => renderList(skuInput.value));
skuInput.addEventListener("input", () => renderList(skuInput.value));
document.addEventListener("click", (e) => {
  if (!combo.contains(e.target)) comboList.classList.remove("open");
});
comboList.addEventListener("click", (e) => {
  const item = e.target.closest(".combo-item");
  if (item && item.dataset.sku) {
    selectSku(item.dataset.sku);
    comboList.classList.remove("open");
  }
});

document.getElementById("prevBtn").addEventListener("click", () => {
  if (!skuKeys.length) return;
  currentIndex = (currentIndex - 1 + skuKeys.length) % skuKeys.length;
  selectSku(skuKeys[currentIndex], false);
});
document.getElementById("nextBtn").addEventListener("click", () => {
  if (!skuKeys.length) return;
  currentIndex = (currentIndex + 1) % skuKeys.length;
  selectSku(skuKeys[currentIndex], false);
});
document.getElementById("refreshBtn").addEventListener("click", loadAll);

function achClass(ach) {
  if (ach === null || ach === undefined) return "na";
  if (ach >= 90) return "good";
  if (ach >= 60) return "warn";
  return "bad";
}
function fmtAch(ach) {
  return ach === null || ach === undefined ? "—" : ach.toFixed(1) + "%";
}

function selectSku(sku, syncIndex = true) {
  const d = DATA[sku];
  if (!d) return;
  if (syncIndex) currentIndex = skuKeys.indexOf(sku);
  skuInput.value = sku;

  document.getElementById("skuCode").textContent = sku;
  document.getElementById("productName").textContent = d.product || "—";
  document.getElementById("totalSale").textContent = d.saleTotal.toLocaleString();
  document.getElementById("totalOrder").textContent = d.orderTotal.toLocaleString();
  document.getElementById("storesOrdering").textContent = d.storeCount + " / " + allStores.size;

  const overallAch = d.orderTotal > 0 ? (d.saleTotal / d.orderTotal) * 100 : null;
  const overallAchEl = document.getElementById("overallAch");
  overallAchEl.textContent = fmtAch(overallAch);
  overallAchEl.className = "v " + achClass(overallAch);

  document.getElementById("grandOrder").textContent = d.orderTotal.toLocaleString();
  document.getElementById("grandSale").textContent = d.saleTotal.toLocaleString();
  document.getElementById("grandAch").textContent = fmtAch(overallAch);

  const remarksEl = document.getElementById("remarksText");
  if (d.remarks && d.remarks.trim()) {
    remarksEl.textContent = d.remarks;
    remarksEl.classList.remove("empty");
  } else {
    remarksEl.textContent = "No remarks added for this SKU.";
    remarksEl.classList.add("empty");
  }

  const frame = document.getElementById("frame");
  if (d.fileId || d.imageUrl) {
    const urls = [];
    if (d.imageUrl) urls.push(d.imageUrl);
    if (d.fileId) {
      urls.push(`https://drive.google.com/thumbnail?id=${d.fileId}&sz=w1000`);
      urls.push(`https://lh3.googleusercontent.com/d/${d.fileId}=w1000`);
      urls.push(`https://drive.google.com/uc?export=view&id=${d.fileId}`);
    }
    const first = urls.shift();
    frame.innerHTML = `<img src="${first}" alt="${sku}" referrerpolicy="no-referrer" data-fallbacks='${JSON.stringify(urls)}' onerror="handleImgError(this)">`;
  } else {
    frame.innerHTML = `<div class="placeholder">Product<br>Image</div>`;
  }

  const tbody = document.getElementById("tbody");
  if (d.stores.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="em">✿</div>No store sales recorded for this SKU.</div></td></tr>`;
  } else {
    const sorted = [...d.stores].sort((a, b) => b.sale - a.sale);
    tbody.innerHTML = sorted.map(s => `
      <tr>
        <td class="store-name">${s.store}</td>
        <td class="num">${s.order.toLocaleString()}</td>
        <td class="num qty-text">${s.sale.toLocaleString()}</td>
        <td class="num"><span class="ach-pill ${achClass(s.ach)}">${fmtAch(s.ach)}</span></td>
      </tr>`).join("");
  }
  document.getElementById("tableSub").textContent = d.storeCount + " stores sold this SKU";
}

function handleImgError(img) {
  const fallbacks = JSON.parse(img.dataset.fallbacks || "[]");
  if (fallbacks.length) {
    const next = fallbacks.shift();
    img.dataset.fallbacks = JSON.stringify(fallbacks);
    img.src = next;
  } else {
    img.parentElement.innerHTML = '<div class="placeholder">Image<br>unavailable</div>';
  }
}

/* ---------------------------- boot ---------------------------- */

loadAll();
setInterval(loadAll, REFRESH_MS);
