"use client";

import { useState } from "react";
import { newWorksheetRow, type OrderWorksheetColumn, type OrderWorksheetRow } from "@/lib/order-worksheet-types";

type Props = {
  token: string;
  title: string;
  instructions: string | null;
  columns: OrderWorksheetColumn[];
  initialRows: OrderWorksheetRow[];
  isOpen: boolean;
  order: { customer_name: string; product: string; request_number: number } | null;
};

const ROSTER_FILE_TYPES = ".pdf,.csv,.txt,.xls,.xlsx,.doc,.docx,image/*";

export function OrderWorksheetForm({ token, title, instructions, columns, initialRows, isOpen, order }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [rowBatchSize, setRowBatchSize] = useState("5");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const visible = columns.filter((column) => column.customerVisible !== false);

  const update = (rowId: string, columnId: string, value: string) =>
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, values: { ...row.values, [columnId]: value } } : row));

  async function save(completed = false) {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/order-worksheet/" + token, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, completed }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save.");
      setMessage(completed ? "Thank you—your worksheet is marked complete. Moore Made will review the final details and follow up with your quote." : "Your changes are saved. You can return to this link anytime.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save."); }
    finally { setSaving(false); }
  }

  async function uploadCompletedRoster(file: File | undefined) {
    if (!file) return;
    setUploading(true); setError("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/order-worksheet/" + token, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not upload the completed roster.");
      setMessage(result.filename + " was uploaded and sent to Moore Made.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not upload the completed roster."); }
    finally { setUploading(false); }
  }

  const addPeople = (requested: number) => {
    const count = Math.max(1, Math.min(100, Math.floor(Number.isFinite(requested) ? requested : 1)));
    setRows((current) => [...current, ...Array.from({ length: count }, () => newWorksheetRow(columns))]);
  };

  const tableStyle = { gridTemplateColumns: "repeat(" + visible.length + ", minmax(130px, 1fr)) 38px" };
  const rowsPerPrintedPage = 12;
  const printableRows = Array.from({ length: Math.max(rowsPerPrintedPage, rows.length) }, (_, index) => rows[index] || null);
  const printPages = Array.from({ length: Math.ceil(printableRows.length / rowsPerPrintedPage) }, (_, index) => printableRows.slice(index * rowsPerPrintedPage, (index + 1) * rowsPerPrintedPage));
  const orderNumber = order ? "MM-" + String(order.request_number).padStart(6, "0") : "—";

  return <main className="shell orderWorksheetPage">
    <section className="orderWorksheetHero">
      <span className="eyebrow">Moore Made order worksheet</span>
      <h1>{title}</h1>
      <p>{order ? order.product + " · Order " + orderNumber : "Order details"}</p>
      <p className="lead">{instructions || "Add the details Moore Made needs before preparing your personalized quote."}</p>
      <div className="orderWorksheetNote"><strong>This is not a quote or payment page.</strong> Add or update the details below; Moore Made will send a complete proof and price for approval afterward.</div>
    </section>
    {isOpen ? <section className="orderWorksheetCard">
      <div className="orderWorksheetTools">
        <button className="btn secondary" type="button" onClick={() => window.print()}>Print landscape worksheet</button>
        <button className="btn secondary" type="button" disabled={saving} onClick={() => save(false)}>{saving ? "Saving…" : "Save changes"}</button>
      </div>
      <div className="orderWorksheetTable">
        <div className="orderWorksheetTableHead" style={tableStyle}>{visible.map((column) => <strong key={column.id}>{column.label}{column.required ? " *" : ""}</strong>)}<span /></div>
        {rows.map((row) => <div className="orderWorksheetTableRow" style={tableStyle} key={row.id}>
          {visible.map((column) => <input key={column.id} value={row.values[column.id] || ""} placeholder={column.label} onChange={(event) => update(row.id, column.id, event.target.value)} />)}
          <button type="button" className="quoteRemove" aria-label="Remove row" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>×</button>
        </div>)}
      </div>
      <div className="worksheetBulkAdd">
        <label>How many people?<input type="number" min="1" max="100" inputMode="numeric" value={rowBatchSize} onChange={(event) => setRowBatchSize(event.target.value)} /></label>
        <button className="btn secondary" type="button" onClick={() => addPeople(Number(rowBatchSize))}>+ Add {Math.max(1, Math.min(100, Math.floor(Number(rowBatchSize) || 1)))} people</button>
        <button className="worksheetAddOne" type="button" onClick={() => addPeople(1)}>Add one</button>
      </div>
      <div className="worksheetPhotoUpload">
        <div><strong>Already filled out a roster?</strong><span>Upload the completed PDF, spreadsheet, Word/CSV file, photo, or scan. PDFs and spreadsheets are preferred; we can still work with a clear image.</span></div>
        <label className="btn secondary">{uploading ? "Uploading…" : "Upload completed roster"}<input type="file" accept={ROSTER_FILE_TYPES} hidden disabled={uploading} onChange={(event) => uploadCompletedRoster(event.target.files?.[0])} /></label>
      </div>
      <small className="fieldHelp">Accepted: PDF, Excel, CSV, Word, text, and image files up to 12 MB. For safety, executable files are not accepted.</small>
      <div className="orderWorksheetFinish"><div><strong>Finished adding everyone?</strong><span>Mark this list complete so Moore Made knows it is ready to review.</span></div><button className="btn" type="button" disabled={saving} onClick={() => save(true)}>{saving ? "Saving…" : "Save & mark complete"}</button></div>
      {message ? <div className="formSuccess">{message}</div> : null}
      {error ? <div className="formError">{error}</div> : null}
    </section> : <section className="orderWorksheetCard"><h2>This worksheet is closed</h2><p>Please message Moore Made if you need to change an order detail.</p></section>}
    <section className="orderWorksheetPrintSheet">{printPages.map((page, pageIndex) => <article className="orderWorksheetPrintPage" key={pageIndex}>
      <header><div><span>MOORE MADE</span><strong>{title}</strong></div><div><span>Order</span><strong>{orderNumber}</strong></div></header>
      <p>{order?.product || "Custom order"}</p>
      <table><thead><tr><th>#</th>{visible.map((column) => <th key={column.id}>{column.label}</th>)}</tr></thead><tbody>{page.map((row, index) => <tr key={row?.id || "blank-" + index}><td>{pageIndex * rowsPerPrintedPage + index + 1}</td>{visible.map((column) => <td key={column.id}>{row?.values[column.id] || ""}</td>)}</tr>)}</tbody></table>
      <footer><span>Fill in each row clearly. Return this worksheet to Moore Made or upload a completed roster through your order link.</span><strong>Page {pageIndex + 1} of {printPages.length}</strong></footer>
    </article>)}</section>
  </main>;
}
