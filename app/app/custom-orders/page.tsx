export default function CustomOrdersPage() {
  return (
    <div className="shell">
      <section className="pageHero">
        <div className="eyebrow">Made your way</div>
        <h1>Place a custom request.</h1>
        <p className="lead">
          Tell us as much as you know. If you are not sure about a detail, leave
          it blank or write “not sure” and we can help figure it out with you.
        </p>
      </section>

      <form className="form card">
        <h2>Contact</h2>
        <div className="twoCol">
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" placeholder="Your name" />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" placeholder="you@example.com" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="phone">Phone number</label>
          <input id="phone" name="phone" type="tel" placeholder="Optional" />
        </div>

        <hr className="formDivider" />
        <h2>What are we making?</h2>
        <div className="twoCol">
          <div className="field">
            <label htmlFor="product">Product / item</label>
            <input id="product" name="product" placeholder="T-shirt, hoodie, mug, business cards..." />
          </div>
          <div className="field">
            <label htmlFor="quantity">Approximate total quantity</label>
            <input id="quantity" name="quantity" type="number" min="1" placeholder="24" />
          </div>
        </div>

        <div className="twoCol">
          <div className="field">
            <label htmlFor="itemType">Shirt / item type or style</label>
            <input id="itemType" name="itemType" placeholder="Gildan tee, soft-style tee, crewneck..." />
          </div>
          <div className="field">
            <label htmlFor="color">Item color(s)</label>
            <input id="color" name="color" placeholder="Black, white, navy..." />
          </div>
        </div>

        <div className="field">
          <label htmlFor="sizes">Sizes and amount of each</label>
          <textarea
            id="sizes"
            name="sizes"
            placeholder={"Example:\nS — 2\nM — 6\nL — 8\nXL — 6\n2XL — 2"}
          />
        </div>

        <hr className="formDivider" />
        <h2>Logo & artwork</h2>
        <div className="field">
          <label htmlFor="artwork">Upload logo, artwork, or reference files</label>
          <input id="artwork" name="artwork" type="file" multiple accept="image/*,.pdf,.svg,.ai,.eps" />
          <span className="fieldHelp">PNG, JPG, SVG, PDF, AI, or EPS are ideal when available.</span>
        </div>

        <div className="twoCol">
          <div className="field">
            <label htmlFor="logoSize">Approximate logo / design size</label>
            <input id="logoSize" name="logoSize" placeholder='Example: 4" wide or large full-back design' />
          </div>
          <div className="field">
            <label htmlFor="printSides">Front / back</label>
            <select id="printSides" name="printSides" defaultValue="">
              <option value="" disabled>Select one</option>
              <option>Front only</option>
              <option>Back only</option>
              <option>Front and back</option>
              <option>Multiple locations</option>
              <option>Not sure</option>
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
          <textarea
            id="artworkInstructions"
            name="artworkInstructions"
            placeholder="Example: Small logo on the left chest. Large logo centered on the back. White print on black shirts."
          />
        </div>

        <hr className="formDivider" />
        <h2>Order details</h2>
        <div className="twoCol">
          <div className="field">
            <label htmlFor="deadline">When do you need it?</label>
            <input id="deadline" name="deadline" type="date" />
          </div>
          <div className="field">
            <label htmlFor="delivery">Pickup or shipping?</label>
            <select id="delivery" name="delivery" defaultValue="">
              <option value="" disabled>Select one</option>
              <option>Local pickup</option>
              <option>Shipping</option>
              <option>Not sure yet</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="notes">Anything else?</label>
          <textarea
            id="notes"
            name="notes"
            placeholder="Budget, inspiration, special packaging, names/numbers, event details, or anything else we should know."
          />
        </div>

        <div className="requestNote">
          This form is ready visually. We&apos;ll connect it to the database/email system next so requests actually reach Moore Made.
        </div>
        <button type="button" className="btn">Submit custom request</button>
      </form>
    </div>
  );
}
