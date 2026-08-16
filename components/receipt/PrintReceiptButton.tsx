"use client";

export function PrintReceiptButton() {
  return <button className="btn" type="button" onClick={() => window.print()}>Print / Save PDF</button>;
}
