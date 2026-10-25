const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";

class BarcodeShoppingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._scanning = false;
    this._viaCamera = false;
    this._res = null;
    this._code = null;
  }

  setConfig(config) {
    this._config = { title: "Scan to shopping list", auto_add: false, ...config };
    this._render();
  }
  set hass(hass) { this._hass = hass; }
  getCardSize() { return 6; }
  static getStubConfig() { return {}; }
  disconnectedCallback() { this._stop(); }

  _$(sel) { return this.shadowRoot.querySelector(sel); }
  _msg(text) { this._$("#msg").textContent = text || ""; }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        [hidden] { display: none !important; }
        .wrap { padding: 16px; display: grid; gap: 12px; }
        .view { position: relative; border-radius: 12px; overflow: hidden; background: #000; aspect-ratio: 4 / 3; }
        video { width: 100%; height: 100%; object-fit: cover; }
        .reticle { position: absolute; inset: 30% 10%; border: 2px solid var(--primary-color); border-radius: 8px; box-shadow: 0 0 0 999px rgba(0,0,0,.35); }
        .row { display: flex; gap: 8px; }
        button { font: inherit; padding: 10px 16px; border: 1px solid transparent; border-radius: 8px; background: var(--primary-color); color: var(--text-primary-color, #fff); cursor: pointer; }
        button.secondary { background: transparent; color: var(--primary-text-color); border-color: var(--divider-color); }
        #scan { flex: 1; }
        input { font: inherit; flex: 1; min-width: 0; padding: 10px; border: 1px solid var(--divider-color); border-radius: 8px; background: var(--card-background-color); color: var(--primary-text-color); }
        #result { display: grid; gap: 12px; }
        .item { display: grid; grid-template-columns: 72px 1fr; gap: 12px; align-items: center; }
        .item.noimg { grid-template-columns: 1fr; }
        .item img { width: 72px; height: 72px; object-fit: contain; border-radius: 8px; background: var(--secondary-background-color); }
        .meta { margin-top: 6px; color: var(--secondary-text-color); font-size: .9em; }
        #msg { min-height: 1.2em; color: var(--secondary-text-color); }
      </style>
      <ha-card>
        <div class="wrap">
          <div class="view" hidden><video playsinline muted></video><div class="reticle"></div></div>
          <div class="row"><button id="scan">Start camera</button></div>
          <div class="row">
            <input id="manual" inputmode="numeric" placeholder="Or type a barcode" enterkeyhint="search">
            <button id="go" class="secondary">Look up</button>
          </div>
          <div id="result" hidden>
            <div class="item">
              <img id="img" alt="" hidden>
              <div><input id="name" placeholder="Item name"><div class="meta" id="meta"></div></div>
            </div>
            <div class="row">
              <button id="add" style="flex:1">Add to shopping list</button>
              <button id="skip" class="secondary">Scan next</button>
            </div>
          </div>
          <div id="msg" role="status"></div>
        </div>
      </ha-card>`;
    this._$("ha-card").header = this._config.title;
    this._$("#scan").onclick = () => (this._scanning ? this._stop() : this._start());
    this._$("#go").onclick = () => this._manual();
    this._$("#manual").onkeydown = (e) => { if (e.key === "Enter") this._manual(); };
    this._$("#add").onclick = () => this._add();
    this._$("#skip").onclick = () => { this._$("#result").hidden = true; this._msg(""); this._start(); };
  }

  _manual() {
    const v = this._$("#manual").value.trim();
    if (!v) return;
    this._viaCamera = false;
    this._$("#manual").value = "";
    this._onCode(v);
  }

  async _loadZxing() {
    if (window.ZXing) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ZXING_URL; s.onload = resolve; s.onerror = () => reject(new Error("Couldn't load the scanner library (needs internet on this device)"));
      document.head.appendChild(s);
    });
  }

  async _start() {
    if (this._scanning) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this._msg("Camera not available. Open Home Assistant over HTTPS or use the companion app.");
      return;
    }
    this._scanning = true;
    this._viaCamera = true;
    this._$("#result").hidden = true;
    this._$(".view").hidden = false;
    this._$("#scan").textContent = "Stop camera";
    this._msg("Point the camera at a barcode.");
    const video = this._$("video");
    const constraints = { video: { facingMode: { ideal: "environment" } }, audio: false };
    try {
      if ("BarcodeDetector" in window) {
        const supported = await BarcodeDetector.getSupportedFormats();
        const detector = new BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) });
        this._stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = this._stream;
        await video.play();
        const tick = async () => {
          if (!this._scanning) return;
          try {
            const found = await detector.detect(video);
            if (found.length) { this._onCode(found[0].rawValue); return; }
          } catch (_) { /* keep trying */ }
          this._timer = setTimeout(tick, 200);
        };
        tick();
      } else {
        await this._loadZxing();
        this._reader = new window.ZXing.BrowserMultiFormatReader();
        this._reader.decodeFromConstraints(constraints, video, (result) => {
          if (result && this._scanning) this._onCode(result.getText());
        });
      }
    } catch (e) {
      this._stop();
      this._msg("Camera error: " + (e.message || e));
    }
  }

  _stop() {
    this._scanning = false;
    clearTimeout(this._timer);
    try { this._reader?.reset(); } catch (_) {}
    this._reader = null;
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
    if (this.shadowRoot.firstChild) {
      const v = this._$("video");
      if (v) v.srcObject = null;
      this._$(".view").hidden = true;
      this._$("#scan").textContent = "Start camera";
    }
  }

  async _onCode(raw) {
    this._stop();
    navigator.vibrate?.(60);
    this._code = String(raw).replace(/\D/g, "");
    this._msg("Looking up " + this._code + "…");
    try {
      this._res = await this._hass.callWS({ type: "barcode_shopping/lookup", barcode: this._code });
    } catch (e) {
      this._msg("Lookup failed: " + (e.message || e));
      return;
    }
    if (this._res && this._config.auto_add && this._viaCamera) {
      if (await this._add(this._res.name)) setTimeout(() => this._start(), 1200);
      return;
    }
    this._showResult();
  }

  _showResult() {
    const r = this._res;
    this._$("#result").hidden = false;
    this._$("#name").value = r ? r.name : "";
    const img = this._$("#img");
    img.hidden = !(r && r.image && r.image.startsWith("https://"));
    if (!img.hidden) img.src = r.image;
    this._$(".item").classList.toggle("noimg", img.hidden);
    this._$("#meta").textContent = r
      ? [r.quantity, r.source].filter(Boolean).join(", ")
      : "Not found in the free databases. Type a name and it will be remembered for this barcode.";
    this._msg("");
    if (!r) this._$("#name").focus();
  }

  async _add(nameOverride) {
    const name = (nameOverride ?? this._$("#name").value).trim();
    if (!name) { this._msg("Enter an item name first."); return false; }
    const remember = !this._res || name !== this._res.name;
    try {
      await this._hass.callService("barcode_shopping", "add", { barcode: this._code, name, remember });
    } catch (e) {
      this._msg("Couldn't add: " + (e.message || e));
      return false;
    }
    this._$("#result").hidden = true;
    this._msg("Added “" + name + "”.");
    if (this._viaCamera && !this._config.auto_add) setTimeout(() => this._start(), 800);
    return true;
  }
}

if (!customElements.get("barcode-shopping-card")) {
  customElements.define("barcode-shopping-card", BarcodeShoppingCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "barcode-shopping-card")) {
  window.customCards.push({
    type: "barcode-shopping-card",
    name: "Barcode Shopping",
    description: "Scan a barcode with your camera and add the product to your shopping list.",
  });
}
