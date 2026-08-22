"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { formatRequestNumber } from "@/lib/custom-request-types";

const BUCKET = "custom-request-files";
const MAX_ARTWORK_FILES = 8;
const MAX_ARTWORK_FILE_BYTES = 20 * 1024 * 1024;

export function CustomRequestForm({ initialName = "", initialEmail = "", initialPhone = "" }: { initialName?: string; initialEmail?: string; initialPhone?: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [openSection, setOpenSection] = useState<number | null>(1);
  const [delivery, setDelivery] = useState("");
  const [success, setSuccess] = useState<{ number: number | string; uploadWarning?: boolean; emailWarning?: boolean } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess(null);
    setSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const fileInput = form.elements.namedItem("artwork") as HTMLInputElement | null;
    const files = Array.from(fileInput?.files ?? []);

    try {
      const name = String(formData.get("name") ?? "").trim();
      const email = String(formData.get("email") ?? "").trim();
      const product = String(formData.get("product") ?? "").trim();
      const quantity = Number(formData.get("quantity") ?? 0);

      if (!name) {
        setOpenSection(1);
        throw new Error("Please enter your name.");
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setOpenSection(1);
        throw new Error("Please enter a valid email address.");
      }
      if (!product) {
        setOpenSection(2);
        throw new Error("Please tell us what you would like made.");
      }
      if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
        setOpenSection(2);
        throw new Error("Quantity must be a whole number between 1 and 1,000,000.");
      }
      const fulfillmentMethod = String(formData.get("delivery") || "");
      if (fulfillmentMethod === "Shipping" || fulfillmentMethod === "Local delivery") {
        const requiredAddress = ["shippingLine1", "shippingCity", "shippingState", "shippingPostalCode"];
        if (requiredAddress.some((key) => !String(formData.get(key) || "").trim())) {
          setOpenSection(3);
          throw new Error(fulfillmentMethod === "Local delivery"
            ? "Please complete the delivery address so we can plan local delivery and calculate sales tax accurately."
            : "Please complete the shipping address so we can calculate shipping and sales tax accurately.");
        }
      }

      if (files.length > MAX_ARTWORK_FILES) {
        setOpenSection(3);
        throw new Error(`Please upload no more than ${MAX_ARTWORK_FILES} artwork files.`);
      }

      const oversizedFile = files.find((file) => file.size > MAX_ARTWORK_FILE_BYTES);
      if (oversizedFile) {
        setOpenSection(3);
        throw new Error(`${oversizedFile.name} is larger than 20 MB. Please use the original file if it is under 20 MB; if the original is larger, mention it in your notes and we can arrange another way to receive it.`);
      }

      const payload = {
        name: formData.get("name"),
        email: formData.get("email"),
        phone: formData.get("phone"),
        smsConsent: formData.get("smsConsent") === "on",
        product: formData.get("product"),
        quantity: formData.get("quantity"),
        itemType: formData.get("itemType"),
        colors: formData.get("colors"),
        sizes: formData.get("sizes"),
        logoSize: formData.get("logoSize"),
        printSides: formData.get("printSides"),
        placements: formData.getAll("placement"),
        artworkInstructions: formData.get("artworkInstructions"),
        deadline: formData.get("deadline"),
        delivery: formData.get("delivery"),
        shippingAddress: ["Shipping", "Local delivery"].includes(String(formData.get("delivery") || "")) ? {
          name: name,
          line1: String(formData.get("shippingLine1") || "").trim(),
          line2: String(formData.get("shippingLine2") || "").trim(),
          city: String(formData.get("shippingCity") || "").trim(),
          state: String(formData.get("shippingState") || "").trim().toUpperCase(),
          postalCode: String(formData.get("shippingPostalCode") || "").trim(),
          country: "US",
        } : null,
        notes: formData.get("notes"),
        discountCode: formData.get("discountCode"),
        website: formData.get("website"),
        files: files.map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
        })),
      };

      const response = await fetch("/api/custom-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not submit your request.");
      }

      if (!result.requestId) {
        form.reset();
        setSuccess({ number: "submitted" });
        return;
      }

      let uploadWarning = false;
      const uploadedPaths: string[] = [];

      if (files.length > 0 && Array.isArray(result.uploads)) {
        const supabase = getSupabaseBrowser();

        for (const target of result.uploads) {
          const file = files[target.index];
          if (!file) continue;

          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .uploadToSignedUrl(target.path, target.token, file, {
              contentType: file.type || undefined,
            });

          if (uploadError) {
            console.error("Artwork upload failed", uploadError);
            uploadWarning = true;
          } else {
            uploadedPaths.push(target.path);
          }
        }

        if (uploadedPaths.length !== files.length) uploadWarning = true;
      }

      if (result.submissionToken) {
        const filesResponse = await fetch(`/api/custom-requests/${result.requestId}/files`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            submissionToken: result.submissionToken,
            paths: uploadedPaths,
          }),
        });
        if (!filesResponse.ok) uploadWarning = true;
      }

      form.reset();
      setDelivery("");
      setSuccess({ number: result.requestNumber, uploadWarning, emailWarning: Boolean(result.emailWarning) });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Could not submit your request.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    const reference = success.number === "submitted" ? "Submitted" : formatRequestNumber(success.number);
    return (
      <div className="requestSuccess card" role="status">
        <div className="successMark">✓</div>
        <div className="eyebrow">Request received</div>
        <h2>We&apos;ve got your idea.</h2>
        <p>
          Your Moore Made request has been saved. Your reference is <strong>{reference}</strong>. We&apos;ll review it within <strong>1–2 business days</strong>. The next normal step is an email with your mockup + quote for one-step approval. If we need clarification before then, we&apos;ll contact you.
        </p>
        {success.uploadWarning ? (
          <p className="requestWarning">
            Your request was saved, but one or more artwork files may not have uploaded. We can still review the request and ask you for the file again.
          </p>
        ) : null}
        {success.emailWarning ? (
          <p className="requestWarning">
            Your request is saved, but the confirmation email could not be sent. Your reference number above is still valid.
          </p>
        ) : null}
        <button className="btn" type="button" onClick={() => { setSuccess(null); setOpenSection(1); }}>
          Start another request
        </button>
      </div>
    );
  }

  return (
    <form className="form card requestForm requestFormRedesign" onSubmit={onSubmit} noValidate>
      <div className="honeypotField" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="requestEssentialsBar">
        <div><strong>Start with the basics.</strong><span>Only name, email, item, and quantity are required.</span></div>
        <div className="requestTimingChips"><span>Reply: 1–2 business days</span><span>Production: usually 1+ week</span></div>
      </div>

      <div className="formAccordion requestAccordion" aria-label="Custom request sections">
        <section className={`formAccordionSection ${openSection === 1 ? "isOpen" : ""}`}>
          <button className="formAccordionTrigger" type="button" aria-expanded={openSection === 1} onClick={() => setOpenSection(openSection === 1 ? null : 1)}>
            <span className="formStep">01</span>
            <span className="formAccordionLabel"><strong>Your contact info</strong><small>So we know who to send the mockup + quote to.</small></span>
            <span className="formAccordionChevron" aria-hidden="true">⌄</span>
          </button>
          <div className="formAccordionBody" hidden={openSection !== 1}>
            <div className="twoCol">
              <div className="field"><label htmlFor="name">Name *</label><input id="name" name="name" placeholder="Your name" maxLength={160} aria-required="true" defaultValue={initialName} /></div>
              <div className="field"><label htmlFor="email">Email *</label><input id="email" name="email" type="email" placeholder="you@example.com" maxLength={320} aria-required="true" defaultValue={initialEmail} /></div>
            </div>
            <details className="requestOptionalDetails">
              <summary>Add phone / texting <span>Optional</span></summary>
              <div className="requestOptionalBody">
                <div className="field"><label htmlFor="phone">Phone number</label><input id="phone" name="phone" type="tel" placeholder="Optional" maxLength={80} defaultValue={initialPhone} /></div>
                <label className="consentBox compactConsent"><input type="checkbox" name="smsConsent" /><span>Yes, Moore Made may text me about this custom request and order. Message and data rates may apply. Reply STOP to opt out.</span></label>
                <span className="fieldHelp">Project/order communication only — not marketing.</span>
              </div>
            </details>
            <div className="formAccordionNextRow"><button className="sectionNext" type="button" onClick={() => setOpenSection(2)}>Next: Project basics →</button></div>
          </div>
        </section>

        <section className={`formAccordionSection ${openSection === 2 ? "isOpen" : ""}`}>
          <button className="formAccordionTrigger" type="button" aria-expanded={openSection === 2} onClick={() => setOpenSection(openSection === 2 ? null : 2)}>
            <span className="formStep">02</span>
            <span className="formAccordionLabel"><strong>What are we making?</strong><small>Give us what you know. “Not sure” is completely fine.</small></span>
            <span className="formAccordionChevron" aria-hidden="true">⌄</span>
          </button>
          <div className="formAccordionBody" hidden={openSection !== 2}>
            <div className="twoCol">
              <div className="field"><label htmlFor="product">Product / item *</label><input id="product" name="product" placeholder="T-shirt, hoodie, mug, business cards..." maxLength={300} aria-required="true" /></div>
              <div className="field"><label htmlFor="quantity">Approx. total quantity *</label><input id="quantity" name="quantity" type="number" min="1" max="1000000" step="1" placeholder="24" aria-required="true" /></div>
            </div>
            <details className="requestOptionalDetails">
              <summary>Add colors, styles & sizes <span>Optional</span></summary>
              <div className="requestOptionalBody">
                <div className="twoCol">
                  <div className="field"><label htmlFor="itemType">Item type / style</label><input id="itemType" name="itemType" placeholder="Soft-style tee, crewneck, tumbler..." maxLength={300} /></div>
                  <div className="field"><label htmlFor="colors">Color(s)</label><input id="colors" name="colors" placeholder="Black, white, navy..." maxLength={500} /></div>
                </div>
                <div className="field"><label htmlFor="sizes">Sizes and amount of each</label><textarea id="sizes" name="sizes" maxLength={3000} placeholder={"Example: S — 2, M — 6, L — 8, XL — 6"} /></div>
              </div>
            </details>
            <div className="formAccordionNextRow"><button className="sectionNext" type="button" onClick={() => setOpenSection(3)}>Next: Artwork & finish →</button></div>
          </div>
        </section>

        <section className={`formAccordionSection ${openSection === 3 ? "isOpen" : ""}`}>
          <button className="formAccordionTrigger" type="button" aria-expanded={openSection === 3} onClick={() => setOpenSection(openSection === 3 ? null : 3)}>
            <span className="formStep">03</span>
            <span className="formAccordionLabel"><strong>Artwork & finishing details</strong><small>Files, placement, timing, delivery, and anything else.</small></span>
            <span className="formAccordionChevron" aria-hidden="true">⌄</span>
          </button>
          <div className="formAccordionBody" hidden={openSection !== 3}>
            <div className="field requestArtworkField">
              <label htmlFor="artwork">Logo, artwork, or reference files <span className="optionalLabel">Optional</span></label>
              <input id="artwork" name="artwork" type="file" multiple accept="image/*,.pdf,.svg,.ai,.eps" />
              <span className="fieldHelp">Up to 8 files, 20 MB each. Send the best original or vector file you have. Low-resolution files cannot always be safely enhanced. Logos may require vector redraw/vectorization; detailed artwork may require a recreated proof and your approval. Any artwork-preparation cost will be included in your quote.</span>
              <div className="artworkIdeaCompact"><strong>No logo yet?</strong> That&apos;s okay — describe your idea below and we can help with the design.</div>
            </div>

            <details className="requestOptionalDetails">
              <summary>Add design & placement details <span>Optional</span></summary>
              <div className="requestOptionalBody">
                <div className="twoCol">
                  <div className="field"><label htmlFor="logoSize">Approx. design size</label><input id="logoSize" name="logoSize" maxLength={500} placeholder='Example: 4" wide or large full-back' /></div>
                  <div className="field"><label htmlFor="printSides">Front / back</label><select id="printSides" name="printSides" defaultValue=""><option value="">Select one</option><option>Front only</option><option>Back only</option><option>Front and back</option><option>Multiple locations</option><option>Not sure</option></select></div>
                </div>
                <fieldset className="field fieldsetReset"><legend>Preferred positioning</legend><div className="checkboxGrid"><label><input type="checkbox" name="placement" value="left-chest" /> Left chest</label><label><input type="checkbox" name="placement" value="front-center" /> Front center</label><label><input type="checkbox" name="placement" value="full-front" /> Full front</label><label><input type="checkbox" name="placement" value="back-center" /> Back center</label><label><input type="checkbox" name="placement" value="full-back" /> Full back</label><label><input type="checkbox" name="placement" value="sleeve" /> Sleeve</label><label><input type="checkbox" name="placement" value="other" /> Other / not sure</label></div></fieldset>
                <div className="field"><label htmlFor="artworkInstructions">Artwork / placement instructions</label><textarea id="artworkInstructions" name="artworkInstructions" maxLength={5000} placeholder="Example: Small logo on left chest and large logo centered on back." /></div>
                <details className="artworkQualityDetails"><summary>Artwork quality tips</summary><p>Vector SVG, AI, EPS, or vector PDF is preferred for logos. High-resolution transparent PNG is also great. Small or blurry logos may need professional vector redraw/vectorization—not simple enhancement. Detailed artwork may require a recreated proof and your approval because automated cleanup can subtly change lettering, shapes, faces, or colors. Any artwork-preparation work will be included in your quote before production.</p></details>
              </div>
            </details>

            <div className="twoCol orderTimingGrid">
              <div className="field orderTimingField"><label htmlFor="deadline">Needed by <span className="optionalLabel">Optional</span></label><input id="deadline" name="deadline" type="date" /></div>
              <div className="field orderTimingField"><label htmlFor="delivery">Fulfillment method</label><select id="delivery" name="delivery" value={delivery} onChange={(e) => setDelivery(e.target.value)}><option value="">Select one</option><option>Local pickup</option><option>Local delivery</option><option>Shipping</option><option>Not sure yet</option></select></div>
            </div>
            {delivery === "Shipping" || delivery === "Local delivery" ? <div className="shippingAddressPanel">
              <strong>{delivery === "Local delivery" ? "Delivery address" : "Shipping address"}</strong>
              <div className="twoCol"><div className="field"><label htmlFor="shippingLine1">Street *</label><input id="shippingLine1" name="shippingLine1" autoComplete="shipping address-line1" /></div><div className="field"><label htmlFor="shippingLine2">Apt / Suite</label><input id="shippingLine2" name="shippingLine2" autoComplete="shipping address-line2" /></div></div>
              <div className="three"><div className="field"><label htmlFor="shippingCity">City *</label><input id="shippingCity" name="shippingCity" autoComplete="shipping address-level2" /></div><div className="field"><label htmlFor="shippingState">State *</label><input id="shippingState" name="shippingState" maxLength={2} autoComplete="shipping address-level1" /></div><div className="field"><label htmlFor="shippingPostalCode">ZIP *</label><input id="shippingPostalCode" name="shippingPostalCode" autoComplete="shipping postal-code" /></div></div>
              <span className="fieldHelp">{delivery === "Local delivery" ? "Used for local delivery planning and accurate sales-tax calculations." : "Used only for fulfillment and accurate sales-tax/shipping calculations."}</span>
            </div> : null}
            <span className="fieldHelp orderTimingHelp">Needed-by dates help us plan but are not guaranteed. Production is typically about a week or longer; shipping adds transit time.</span>
            <div className="twoCol requestFinalDetails"><div className="field"><label htmlFor="notes">Anything else? <span className="optionalLabel">Optional</span></label><textarea id="notes" name="notes" maxLength={5000} placeholder="Budget, inspiration, special packaging, names/numbers, event details, or anything else we should know." /></div><div className="field"><label htmlFor="discountCode">Discount code <span className="optionalLabel">Optional</span></label><input id="discountCode" name="discountCode" maxLength={80} placeholder="Example: FAMILY10" autoCapitalize="characters" /><span className="fieldHelp">We&apos;ll verify the code when preparing your quote and show any approved discount in the final total.</span></div></div>
          </div>
        </section>
      </div>

      {error ? <div className="formError" role="alert">{error}</div> : null}
      <div className="submitRow requestSubmitRow">
        <button type="submit" className="btn" disabled={submitting}>{submitting ? "Sending request…" : "Submit custom request"}</button>
        <span className="submitHint">No payment is taken now. We&apos;ll review your request and send a mockup + quote.</span>
      </div>
    </form>
  );
}
