function legacyPlacementLabel(line: string) {
  const x = Number(line.match(/(?:preview )?position\s+(\d+(?:\.\d+)?)%\s+across/i)?.[1]);
  const y = Number(line.match(/(?:preview )?position\s+\d+(?:\.\d+)?%\s+across\s*\/\s*(\d+(?:\.\d+)?)%\s+down/i)?.[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "Custom placement";
  if (/—\s*back\s*:/i.test(line)) return y < 38 ? "Upper back" : y > 62 ? "Lower back" : "Back center";
  if (y < 36 && x < 46) return "Left chest / pocket";
  if (y < 36 && x > 54) return "Right chest / pocket";
  if (y < 36) return "Top center";
  if (y > 64) return "Lower center";
  return "Full center";
}

/** Turns older coordinate-heavy customer instructions into an admin-friendly placement summary. */
export function customerIdeaLabel(line: string) {
  const placement = legacyPlacementLabel(line);
  return line
    .replace(/customer-positioned design;\s*/i, "")
    .replace(/;\s*(?:preview )?position\s+\d+(?:\.\d+)?%\s+across\s*\/\s*\d+(?:\.\d+)?%\s+down;\s*(?:preview )?width\s+\d+(?:\.\d+)?%;\s*height\s+\d+(?:\.\d+)?%;\s*rotation\s*-?\d+(?:\.\d+)?°\.?/i, `; placement: ${placement}.`)
    .replace(/;\s*position\s+\d+(?:\.\d+)?%\s+across\s*\/\s*\d+(?:\.\d+)?%\s+down;\s*width\s+\d+(?:\.\d+)?%;\s*height\s+\d+(?:\.\d+)?%;\s*rotation\s*-?\d+(?:\.\d+)?°\.?/i, `; placement: ${placement}.`);
}

export function customerIdeaLines(artworkInstructions: string | null | undefined) {
  if (!artworkInstructions) return [];
  return artworkInstructions
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /design needed:|uploaded artwork:|optional details:|different design|recreate|background removal requested/i.test(line))
    .map((line) => customerIdeaLabel(line.replace(/^\d+\.\s*/, "")));
}

export function hasCustomerIdeas(artworkInstructions: string | null | undefined) {
  return customerIdeaLines(artworkInstructions).length > 0;
}
