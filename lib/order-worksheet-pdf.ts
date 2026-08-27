import type { OrderWorksheetColumn, OrderWorksheetRow } from "@/lib/order-worksheet-types";

function pdfText(value: unknown) {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function streamObject(content: string) {
  return `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`;
}

/** Creates a lightweight, printer-friendly US-letter landscape PDF without a browser dependency. */
export function createOrderWorksheetPdf(input: {
  title: string;
  orderNumber: string;
  product: string;
  columns: OrderWorksheetColumn[];
  rows: OrderWorksheetRow[];
}) {
  const columns = input.columns.filter((column) => column.customerVisible !== false);
  const rowsPerPage = 12;
  const sourceRows = Array.from({ length: Math.max(rowsPerPage, input.rows.length) }, (_, index) => input.rows[index] || null);
  const pages = Array.from({ length: Math.ceil(sourceRows.length / rowsPerPage) }, (_, index) => sourceRows.slice(index * rowsPerPage, (index + 1) * rowsPerPage));
  const objects: string[] = [];
  const add = (value: string) => { objects.push(value); return objects.length; };
  const catalogId = add(""); const pagesId = add(""); const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); const boldFontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds: number[] = [];
  const pageWidth = 792; const pageHeight = 612; const left = 34; const usableWidth = pageWidth - left * 2; const columnWidth = (usableWidth - 28) / Math.max(1, columns.length);

  pages.forEach((page, pageIndex) => {
    const lines: string[] = ["0.13 0.11 0.1 rg", "BT /F2 10 Tf 34 578 Td (MOORE MADE) Tj ET", `BT /F2 18 Tf 34 552 Td (${pdfText(input.title)}) Tj ET`, `BT /F1 9 Tf 34 536 Td (${pdfText(input.product)}  |  Order ${pdfText(input.orderNumber)}) Tj ET`];
    const headerY = 510; const rowHeight = 33; const tableBottom = headerY - rowHeight * (page.length + 1);
    lines.push("0.92 0.90 0.87 rg", `${left} ${headerY - rowHeight} ${usableWidth} ${rowHeight} re f`, "0.55 0.52 0.48 RG 0.7 w");
    lines.push(`${left} ${tableBottom} ${usableWidth} ${rowHeight * (page.length + 1)} re S`);
    lines.push(`${left + 28} ${tableBottom} m ${left + 28} ${headerY} l S`);
    for (let index = 1; index < columns.length; index += 1) { const x = left + 28 + columnWidth * index; lines.push(`${x} ${tableBottom} m ${x} ${headerY} l S`); }
    for (let index = 1; index <= page.length; index += 1) { const y = headerY - rowHeight * index; lines.push(`${left} ${y} m ${left + usableWidth} ${y} l S`); }
    // Filling the header background changes the PDF's text fill colour too.
    // Restore a dark fill before drawing headings, row numbers, and values.
    lines.push("0.08 0.08 0.08 rg");
    lines.push(`BT /F2 8 Tf ${left + 9} ${headerY - 21} Td (#) Tj ET`);
    columns.forEach((column, index) => { lines.push(`BT /F2 8 Tf ${left + 34 + columnWidth * index} ${headerY - 21} Td (${pdfText(column.label).slice(0, 36)}) Tj ET`); });
    page.forEach((row, rowIndex) => {
      const y = headerY - rowHeight * (rowIndex + 1) - 21;
      lines.push(`BT /F1 9 Tf ${left + 10} ${y} Td (${pageIndex * rowsPerPage + rowIndex + 1}) Tj ET`);
      columns.forEach((column, index) => { const value = row?.values[column.id] || ""; lines.push(`BT /F1 9 Tf ${left + 34 + columnWidth * index} ${y} Td (${pdfText(value).slice(0, 42)}) Tj ET`); });
    });
    lines.push(`BT /F1 8 Tf 34 28 Td (Fill in each row clearly. Return this worksheet to Moore Made or upload a clear photo through your order link.) Tj ET`, `BT /F2 8 Tf 698 28 Td (Page ${pageIndex + 1} of ${pages.length}) Tj ET`);
    const contentId = add(streamObject(lines.join("\n")));
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let result = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(result, "ascii")); result += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(result, "ascii"); result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(result, "ascii");
}
