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
        notes: formData.get("notes"),
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
    <form className="form card requestForm" onSubmit={onSubmit} noValidate>
      <div className="honeypotField" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <aside className="turnaroundNotice" aria-label="Order timing information">
        <div className="turnaroundNoticeHead">
          <div className="turnaroundNoticeIcon" aria-hidden="true">i</div>
          <div>
            <span className="turnaroundNoticeKicker">Before you submit</span>
            <strong>Plan a little extra time for custom work.</strong>
          </div>
        </div>
        <div className="turnaroundNoticeGrid">
          <div>
            <span>Response time</span>
            <strong>1–2 business days</strong>
            <p>We&apos;ll review your request. If anything essential is unclear, we&apos;ll contact you before preparing the mockup + quote.</p>
          </div>
          <div>
            <span>Typical production</span>
            <strong>About 1 week or longer</strong>
            <p>Timing begins after details and artwork are finalized. Shipping adds carrier transit time.</p>
          </div>
          <div>
            <span>Needed-by dates</span>
            <strong>Helpful, not guaranteed</strong>
            <p>For urgent or time-sensitive orders, please call us before submitting so we can check availability.</p>
          </div>
        </div>
      </aside>

      <div className="formAccordion" aria-label="Custom request sections">
        <section className={`formAccordionSection ${openSection === 1 ? "isOpen" : ""}`}>
          <button
            className="formAccordionTrigger"
            type="button"
            aria-expanded={openSection === 1}
            onClick={() => setOpenSection(openSection === 1 ? null : 1)}
          >
            <span className="formStep">01</span>
            <span className="formAccordionLabel">
              <strong>Contact</strong>
              <small>Who should we reach out to about this project?</small>
            </span>
            <span className="formAccordionChevron" aria-hidden="true">⌄</span>
          </button>
          <div className="formAccordionBody" hidden={openSection !== 1}>
            <div className="twoCol">
              <div className="field">
                <label htmlFor="name">Name *</label>
                <input id="name" name="name" placeholder="Your name" maxLength={160} aria-required="true" defaultValue={initialName} />
              </div>
              <div className="field">
                <label htmlFor="email">Email *</label>
                <input id="email" name="email" type="email" placeholder="you@example.com" maxLength={320} aria-required="true" defaultValue={initialEmail} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="phone">Phone number</label>
              <input id="phone" name="phone" type="tel" placeholder="Optional" maxLength={80} defaultValue={initialPhone} />
              <label className="consentBox compactConsent">
                <input type="checkbox" name="smsConsent" />
                <span>Yes, Moore Made may text me about this custom request and order. Message and data rates may apply. Reply STOP to opt out.</span>
              </label>
              <span className="fieldHelp">Optional. This permission is for project/order communication only, not marketing messages.</span>
            </div>
            <div className="formAccordionNextRow">
              <button className="sectionNext" type="button" onClick={() => setOpenSection(2)}>Next: What are we making? →</button>
            </div>
          </div>
        </section>

        <section className={`formAccordionSection ${openSection === 2 ? "isOpen" : ""}`}>
          <button
            className="formAccordionTrigger"
            type="button"
            aria-expanded={openSection === 2}
            onClick={() => setOpenSection(openSection === 2 ? null : 2)}
          >
            <span className="formStep">02</span>
            <span className="formAccordionLabel">
              <strong>What are we making?</strong>
              <small>Give us the basics. It&apos;s okay if some details are not decided yet.</small>
            </span>
            <span className="formAccordionChevron" aria-hidden="true">⌄</span>
          </button>
          <div className="formAccordionBody" hidden={openSection !== 2}>
            <div className="twoCol">
              <div className="field">
                <label htmlFor="product">Product / item *</label>
                <input id="product" name="product" placeholder="T-shirt, hoodie, mug, business cards..." maxLength={300} aria-required="true" />
              </div>
              <div className="field">
                <label htmlFor="quantity">Approximate total quantity *</label>
                <input id="quantity" name="quantity" type="number" min="1" max="1000000" step="1" placeholder="24" aria-required="true" />
              </div>
            </div>
            <div className="twoCol">
              <div className="field">
                <label htmlFor="itemType">Shirt / item type or style</label>
                <input id="itemType" name="itemType" placeholder="Gildan tee, soft-style tee, crewneck..." maxLength={300} />
              </div>
              <div className="field">
                <label htmlFor="colors">Item color(s)</label>
                <input id="colors" name="colors" placeholder="Black, white, navy..." maxLength={500} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="sizes">Sizes and amount of each</label>
              <textarea id="sizes" name="sizes" maxLength={3000} placeholder={"Example:\nS — 2\nM — 6\nL — 8\nXL — 6\n2XL — 2"} />
            </div>
            <div className="formAccordionNextRow">
              <button className="sectionNext" type="button" onClick={() => setOpenSection(3)}>Next: Logo & artwork →</button>
            </div>
          </div>
        </section>

        <section className={`formAccordionSection ${openSection === 3 ? "isOpen" : ""}`}>
          <button
            className="formAccordionTrigger"
            type="button"
            aria-expanded={openSection === 3}
            onClick={() => setOpenSection(openSection === 3 ? null : 3)}
          >
            <span className="formStep">03</span>
            <span className="formAccordionLabel">
              <strong>Logo & artwork</strong>
              <small>Upload what you have and describe where you want it.</small>
            </span>
            <span className="formAccordionChevron" aria-hidden="true">⌄</span>
          </button>
          <div className="formAccordionBody" hidden={openSection !== 3}>
            <div className="field">
              <label htmlFor="artwork">Upload logo, artwork, or reference files</label>
              <input id="artwork" name="artwork" type="file" multiple accept="image/*,.pdf,.svg,.ai,.eps" />
              <span className="fieldHelp">Up to 8 files, 20 MB each.</span>
              <div className="artworkIdeaNote">
                <strong>Don&apos;t have a logo yet?</strong> Have an idea in mind? Tell us what you&apos;re imagining and we can help bring it to life. Logo or design assistance may add time to your turnaround and may affect your quote.
              </div>
              <div className="artworkQualityNote">
                <strong>For the best print quality:</strong> Vector artwork such as <strong>SVG, AI, EPS, or vector PDF</strong> is preferred for logos and designs. High-resolution <strong>PNG</strong> files (especially with a transparent background) also work well, and <strong>JPG</strong> is fine for photographs. A small file is not automatically low quality, but screenshots, blurry images, or low-resolution artwork may need to be cleaned up or recreated before production, which can increase turnaround time. When possible, upload the original design file rather than an image saved from social media. If your original artwork is larger than 20 MB, mention that in your notes rather than compressing it and we can arrange another way to receive the file.
              </div>
            </div>
            <div className="twoCol">
              <div className="field">
                <label htmlFor="logoSize">Approximate logo / design size</label>
                <input id="logoSize" name="logoSize" maxLength={500} placeholder='Example: 4" wide or large full-back design' />
              </div>
              <div className="field">
                <label htmlFor="printSides">Front / back</label>
                <select id="printSides" name="printSides" defaultValue="">
                  <option value="">Select one</option>
                  <option>Front only</option><option>Back only</option><option>Front and back</option>
                  <option>Multiple locations</option><option>Not sure</option>
                </select>
              </div>
            </div>
            <fieldset className="field fieldsetReset">
              <legend>Preferred design positioning</legend>
              <div className="checkboxGrid">
                <label><input type="checkbox" name="placement" value="left-chest" /> Left chest</label>
                <label><input type="checkbox" name="placement" value="front-center" /> Front center</label>
                <label><input type="checkbox" name="placement" value="full-front" /> Full front</label>
                <label><input type="checkbox" name="placement" value="back-center" /> Back center</label>
                <label><input type="checkbox" name="placement" value="full-back" /> Full back</label>
                <label><input type="checkbox" name="placement" value="sleeve" /> Sleeve</label>
                <label><input type="checkbox" name="placement" value="other" /> Other / not sure</label>
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="artworkInstructions">Artwork / placement instructions</label>
              <textarea id="artworkInstructions" name="artworkInstructions" maxLength={5000} placeholder="Example: Small logo on left chest. Large logo centered on back. White print on black shirts." />
            </div>
            <div className="formAccordionNextRow">
              <button className="sectionNext" type="button" onClick={() => setOpenSection(4)}>Next: Order details →</button>
            </div>
          </div>
        </section>

        <section className={`formAccordionSection ${openSection === 4 ? "isOpen" : ""}`}>
          <button
            className="formAccordionTrigger"
            type="button"
            aria-expanded={openSection === 4}
            onClick={() => setOpenSection(openSection === 4 ? null : 4)}
          >
            <span className="formStep">04</span>
            <span className="formAccordionLabel">
              <strong>Order details</strong>
              <small>Timing, delivery, budget, and anything else we should know.</small>
            </span>
            <span className="formAccordionChevron" aria-hidden="true">⌄</span>
          </button>
          <div className="formAccordionBody" hidden={openSection !== 4}>
            <div className="twoCol orderTimingGrid">
              <div className="field orderTimingField">
                <label htmlFor="deadline">When do you need it?</label>
                <input id="deadline" name="deadline" type="date" />
              </div>
              <div className="field orderTimingField">
                <label htmlFor="delivery">Pickup or shipping?</label>
                <select id="delivery" name="delivery" defaultValue="">
                  <option value="">Select one</option><option>Local pickup</option><option>Shipping</option><option>Not sure yet</option>
                </select>
              </div>
            </div>
            <span className="fieldHelp orderTimingHelp">Requested dates are not guaranteed. Please allow about a week or more, plus shipping time when applicable.</span>
            <div className="field">
              <label htmlFor="notes">Anything else?</label>
              <textarea id="notes" name="notes" maxLength={5000} placeholder="Budget, inspiration, special packaging, names/numbers, event details, or anything else we should know." />
            </div>
          </div>
        </section>
      </div>

      {error ? <div className="formError" role="alert">{error}</div> : null}
      <div className="submitRow">
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Sending request…" : "Submit custom request"}
        </button>
        <span className="submitHint">No payment is taken when you submit a request.</span>
      </div>
    </form>
  );
}
