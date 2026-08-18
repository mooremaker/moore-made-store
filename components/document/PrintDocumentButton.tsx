"use client";

type Props = { label?: string };

export function PrintDocumentButton({ label = "Print / Save PDF" }: Props) {
  return <button className="btn" type="button" onClick={() => window.print()}>{label}</button>;
}
