"use client";

import { compactSizeSummary, orderItemQuantity, type StructuredOrderItem } from "@/lib/order-types";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char] || char));
}

function sizeLines(item: StructuredOrderItem) {
  return Object.entries(item.quantities || {})
    .filter(([, quantity]) => Number(quantity) > 0)
    .map(([size, quantity]) => `${Number(quantity)} × ${size}`);
}

export function ProductionChecklist({
  requestNumber,
  customerName,
  items,
  printSides,
}: {
  requestNumber: string;
  customerName: string;
  items: StructuredOrderItem[];
  printSides?: string | null;
}) {
  if (!items?.length) return null;

  const total = items.reduce((sum, item) => sum + orderItemQuantity(item), 0);

  function printSheet() {
    const win = window.open("", "_blank", "width=900,height=800");
    if (!win) return;
    const itemHtml = items.map((item, index) => {
      const sizes = sizeLines(item);
      return `<section class="item"><h2>${index + 1}. ${escapeHtml(item.productName)} — ${escapeHtml(item.colorName || "Color not specified")}</h2><p class="total">Expected: <strong>${orderItemQuantity(item)} pieces</strong></p><ul>${sizes.length ? sizes.map((line) => `<li><span class="box"></span>${escapeHtml(line)}</li>`).join("") : `<li><span class="box"></span>${orderItemQuantity(item)} × Each</li>`}</ul>${item.designRelationship === "separate" ? `<p><strong>Separate design:</strong> ${escapeHtml(item.notes || "See approved proof")}</p>` : ""}</section>`;
    }).join("");
    win.document.write(`<!doctype html><html><head><title>${escapeHtml(requestNumber)} Production Sheet</title><style>body{font-family:Arial,sans-serif;color:#111;margin:32px}header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #111;padding-bottom:14px;margin-bottom:20px}h1{margin:0;font-size:26px}.meta{font-size:14px;line-height:1.5}.item{border:1px solid #aaa;border-radius:10px;padding:16px;margin:0 0 14px;break-inside:avoid}.item h2{font-size:18px;margin:0 0 7px}.total{margin:0 0 10px}ul{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}li{font-size:16px;padding:8px;border:1px solid #ddd;border-radius:7px}.box{display:inline-block;width:16px;height:16px;border:1.5px solid #111;margin-right:9px;vertical-align:-2px}.checks{margin-top:20px;border-top:2px solid #111;padding-top:16px}.checks div{margin:9px 0;font-size:15px}.footer{margin-top:20px;font-size:12px;color:#555}@media print{button{display:none}body{margin:18px}}</style></head><body><header><div><h1>Moore Made Production Sheet</h1><div class="meta"><strong>${escapeHtml(requestNumber)}</strong><br>${escapeHtml(customerName)}</div></div><div class="meta"><strong>Total pieces:</strong> ${total}<br><strong>Design sides:</strong> ${escapeHtml(printSides || "See approved proof")}</div></header>${itemHtml}<section class="checks"><h2>Checks & balances</h2><div><span class="box"></span> Blank/product count matches order (${total})</div><div><span class="box"></span> Sizes and colors verified before pressing</div><div><span class="box"></span> Front design matches approved proof</div><div><span class="box"></span> Back/additional design matches approved proof</div><div><span class="box"></span> Finished-piece count rechecked</div><div><span class="box"></span> Quality check completed</div><div><span class="box"></span> Packed / ready for fulfillment</div></section><div class="footer">Use the approved Moore Made proof + quote as the final design source of truth.</div><script>window.onload=()=>window.print()</script></body></html>`);
    win.document.close();
  }

  return (
    <section className="productionChecklistCard">
      <div className="productionChecklistHead">
        <div><span className="eyebrow">Production count sheet</span><strong>{total} total pieces</strong><small>Simple size-by-size list for production and a second count check.</small></div>
        <button className="btn secondary" type="button" onClick={printSheet}>Print production sheet</button>
      </div>
      <div className="productionChecklistItems">
        {items.map((item) => {
          const sizes = sizeLines(item);
          return <div className="productionChecklistItem" key={item.id}><div><strong>{item.productName}</strong><span>{item.colorName || "Color not specified"} · {orderItemQuantity(item)} pcs</span></div><ul>{sizes.length ? sizes.map((line) => <li key={line}>{line}</li>) : <li>{orderItemQuantity(item)} × Each</li>}</ul></div>;
        })}
      </div>
      <div className="productionCountCheck"><span>Count check</span><strong>Expected finished total: {total}</strong></div>
    </section>
  );
}
