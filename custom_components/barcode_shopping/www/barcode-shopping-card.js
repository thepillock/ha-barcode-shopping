const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
const MULTI_KEY = "barcode_shopping_multi_scan";
const REPEAT_MS = 2500; // ignore the same barcode re-read right after resuming

class BarcodeShoppingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._scanning = false; // camera is open
    this._paused = false;   // camera open but not reading (multi scan, waiting on you)
    this._multi = false;
    this._res = null;
    this._code = null;
    this._lastCode = null;
    this._lastTime = 0;
  }

  setConfig(config) {
    this._config = { title: "Scan to shopping list", auto_add: false, ...config };
    this._render();
  }
  set hass(hass) { this._hass = hass; }
  getCardSize() { return 7; }
  static getStubConfig() { return {}; }
  disconnectedCallback() { this._stop(); }

  _$(sel) { return this.shadowRoot.querySelector(sel); }
  _msg(text) { this._$("#msg").textContent = text || ""; }

  _loadMulti() {
    try {
      const v = localStorage.getItem(MULTI_KEY);
      if (v !== null) return v === "1";
    } catch (_) { /* storage unavailable */ }
    return Boolean(this._config.multi_scan ?? this._config.auto_add);
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        [hidden] { display: none !important; }
        .wrap { padding: 16px; display: grid; gap: 12px; }
        .view { position: relative; border-radius: 12px; overflow: hidden; background: #000; aspect-ratio: 4 / 3; }
        video { width: 100%; height: 100%; object-fit: cover; }
        .reticle { position: absolute; inset: 30% 10%; border: 2px solid var(--primary-color); border-radius: 8px; box-shadow: 0 0 0 999px rgba(0,0,0,.35); }
        .view.paused .reticle { border-color: var(--secondary-text-color); }
        .row { display: flex; gap: 8px; }
        button { font: inherit; padding: 10px 16px; border: 1px solid transparent; border-radius: 8px; background: var(--primary-color); color: var(--text-primary-color, #fff); cursor: pointer; }
        button.secondary { background: transparent; color: var(--primary-text-color); border-color: var(--divider-color); }
        #scan { flex: 1; }
        input[type="text"], input[type="search"], input:not([type]), #manual, #name { font: inherit; flex: 1; min-width: 0; padding: 10px; border: 1px solid var(--divider-color); border-radius: 8px; background: var(--card-background-color); color: var(--primary-text-color); }
        .toggle { position: relative; display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
        .toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
        .track { position: relative; flex: none; width: 40px; height: 22px; border-radius: 11px; background: var(--disabled-text-color, #9e9e9e); transition: background .2s; }
        .track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .2s; }
        .toggle input:checked + .track { background: var(--primary-color); }
        .toggle input:checked + .track::after { transform: translateX(18px); }
        .toggle input:focus-visible + .track { outline: 2px solid var(--primary-color); outline-offset: 2px; }
        .toggle small { display: block; color: var(--secondary-text-color); }
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
          <label class="toggle">
            <input type="checkbox" id="multi">
            <span class="track"></span>
            <span><span>Multi scan</span><small>Keep the camera open to scan the next item</small></span>
          </label>
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
    this._multi = this._loadMulti();
    this._$("#multi").checked = this._multi;
    this._$("#multi").onchange = (e) => {
      this._multi = e.target.checked;
      try { localStorage.setItem(MULTI_KEY, this._multi ? "1" : "0"); } catch (_) {}
    };
    this._$("#scan").onclick = () => (this._scanning ? this._stop() : this._start());
    this._$("#go").onclick = () => this._manual();
    this._$("#manual").onkeydown = (e) => { if (e.key === "Enter") this._manual(); };
    this._$("#add").onclick = () => this._add();
    this._$("#skip").onclick = () => {
      this._$("#result").hidden = true;
      this._msg("");
      if (this._scanning) this._resume(); else this._start();
    };
  }

  _manual() {
    const v = this._$("#manual").value.trim();
    if (!v) return;
    this._$("#manual").value = "";
    this._onCode(v);
  }

  _pause() {
    this._paused = true;
    this._$(".view")?.classList.add("paused");
  }

  _resume() {
    this._lastTime = Date.now();
    this._paused = false;
    this._$(".view")?.classList.remove("paused");
  }

  async _loadZxing() {
    if (window.ZXing) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ZXING_URL;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Couldn't load the scanner library (needs internet on this device)"));
      document.head.appendChild(s);
    });
  }

  async _start() {
    if (this._scanning) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this._msg("Camera not available. Home Assistant must be loaded over HTTPS, in the companion app too. Check that your internal URL starts with https://.");
      return;
    }
    this._scanning = true;
    this._paused = false;
    this._$("#result").hidden = true;
    this._$(".view").hidden = false;
    this._$(".view").classList.remove("paused");
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
          if (!this._paused) {
            try {
              const found = await detector.detect(video);
              if (found.length && this._scanning && !this._paused) this._onCode(found[0].rawValue);
            } catch (_) { /* keep trying */ }
          }
          if (this._scanning) this._timer = setTimeout(tick, 200);
        };
        tick();
      } else {
        await this._loadZxing();
        this._reader = new window.ZXing.BrowserMultiFormatReader();
        this._reader.decodeFromConstraints(constraints, video, (result) => {
          if (result && this._scanning && !this._paused) this._onCode(result.getText());
        });
      }
    } catch (e) {
      this._stop();
      this._msg("Camera error: " + (e.message || e));
    }
  }

  _stop() {
    this._scanning = false;
    this._paused = false;
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
    const code = String(raw).replace(/\D/g, "");
    if (this._scanning && this._multi) {
      // Multi scan: keep the camera open, just stop reading until this item is dealt with.
      if (this._paused) return;
      if (code === this._lastCode && Date.now() - this._lastTime < REPEAT_MS) return;
      this._pause();
    } else {
      this._stop();
    }
    this._lastCode = code;
    this._lastTime = Date.now();
    navigator.vibrate?.(60);
    this._code = code;
    this._msg("Looking up " + code + "…");
    try {
      this._res = await this._hass.callWS({ type: "barcode_shopping/lookup", barcode: code });
    } catch (e) {
      this._msg("Lookup failed: " + (e.message || e));
      if (this._scanning) this._resume();
      return;
    }
    if (this._res && this._config.auto_add) {
      await this._add(this._res.name);
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
    if (this._scanning) {
      this._msg("Added “" + name + "”. Scan the next item.");
      this._resume();
    } else {
      this._msg("Added “" + name + "”.");
    }
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
