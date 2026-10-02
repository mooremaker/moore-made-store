export function followUpDraft() {
  return "Just checking in to see whether you had a chance to review your mockups. Let us know what you think or if you would like any changes. Once the design looks good, send over any remaining sizes or order details so we can prepare your quote.\n\nThank you!";
}

export function followUpRecipients(value: unknown): string[] {
  if (typeof value !== "string") throw new Error("Enter the recipient email address.");
  const emails = [...new Set(value.split(/[;,\n]+/).map(item => item.trim().toLowerCase()).filter(Boolean))];
  if (!emails.length || emails.length > 10 || emails.some(email => email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("Enter up to 10 valid email addresses, separated by commas.");
  }
  return emails;
}

export function followUpProofFiles(value: unknown, requestId: string) {
  if (!Array.isArray(value) || value.length > 20) throw new Error("The saved proof files are unavailable.");
  return value.map(file => {
    if (!file || typeof file.path !== "string" || !file.path.startsWith(`${requestId}/`) || file.path.includes("..")) {
      throw new Error("A saved mockup does not belong to this order.");
    }
    return { path: file.path as string, originalName: String(file.originalName || "mockup-proof").replace(/[^a-z0-9._ -]/gi, "-").slice(0, 120) };
  });
}
