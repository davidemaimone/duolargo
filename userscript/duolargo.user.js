// ==UserScript==
// @name         DuoLargo
// @namespace    io.github.davidemaimone.duolargo
// @version      0.4.5
// @description  Pagine a tutta larghezza sullo schermo esterno di iPhone Duo (versione di prova).
// @match        *://*/*
// @run-at       document-end
// @inject-into  content
// @noframes
// @updateURL    https://raw.githubusercontent.com/davidemaimone/duolargo/main/userscript/duolargo.user.js
// @downloadURL  https://raw.githubusercontent.com/davidemaimone/duolargo/main/userscript/duolargo.user.js
// ==/UserScript==

// File generato da tools/build_userscript.py: non modificarlo a mano.
const DUOLARGO_USERSCRIPT = true;

// DuoLargo — allargamento delle pagine sullo schermo esterno di iPhone Duo.
//
// Cosa abbiamo misurato (Safari 27.2, iPhone19,4, schermo esterno):
//  - la finestra è larga outerWidth (466 pt), la pagina riceve innerWidth (382 pt):
//    la differenza è la colonna dei comandi di Safari, sul lato destro;
//  - il contenuto normale della pagina viene disegnato anche sotto la colonna;
//  - con <meta viewport> "width=<outerWidth>, initial-scale=1" la pagina si impagina
//    su tutta la larghezza a grandezza normale, ma può scorrere di lato;
//  - senza initial-scale Safari rimpicciolisce la pagina: da evitare.
//
// Layout:
//  - "protetto": la pagina si allarga, ma testo e controlli finiscono prima della colonna;
//  - "tutto":    la pagina si allarga e basta.
//
// Lo Split View sullo schermo interno non è ancora gestito: qui agiamo solo quando la
// finestra occupa tutto lo schermo esterno in verticale.

(() => {
  if (window.top !== window) return;
  if (window.__duoLargo) return;
  window.__duoLargo = true;
  // Estensione e userscript vivono in mondi JS separati: il segno sul DOM evita che girino entrambi.
  const IS_USERSCRIPT = typeof DUOLARGO_USERSCRIPT !== "undefined";
  if (document.documentElement.hasAttribute("data-duolargo")) return;
  document.documentElement.setAttribute("data-duolargo", IS_USERSCRIPT ? "userscript" : "extension");

  // Nello userscript non ci sono le API delle estensioni: impostazioni in localStorage.
  function userscriptApi() {
    const KEY = "duolargo:settings";
    const read = () => {
      try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
    };
    return {
      storage: {
        local: {
          get: (defaults) => Promise.resolve({ ...defaults, ...read() }),
          set: (values) => {
            try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...values })); } catch {}
            return Promise.resolve();
          },
        },
        onChanged: { addListener() {} },
      },
      runtime: { onMessage: { addListener() {} } },
    };
  }

  const api = IS_USERSCRIPT ? userscriptApi() : globalThis.browser ?? globalThis.chrome;
  const site = location.hostname.replace(/^www\./, "");

  const S = {
    mode: "largo", // "largo" | "diag"
    layout: "protetto", // "protetto" | "tutto"
    disabledSites: [],
    tempOff: false, // spento con il pulsante, solo per questa pagina
    active: false,
    W: 0,
    strip: 0,
    screenKey: "",
    originalViewport: undefined,
    padded: new Map(), // elemento -> padding-right inline originale
    moved: new Map(), // elemento fisso -> {prop, value, priority}
    reason: "",
    ignoreResizeUntil: 0,
  };

  // ---------- condizioni ----------

  const screenKey = () => `${screen.width}x${screen.height}|${outerWidth}`;

  function siteEnabled() {
    return !S.disabledSites.some((d) => site === d || site.endsWith("." + d));
  }

  // Misura la colonna PRIMA di modificare la pagina (dopo la misura si falsa).
  const CACHE_KEY = "duolargo:strip";
  function cachedStrip() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}")[`${screen.width}x${screen.height}`] || 0; } catch { return 0; }
  }
  function saveStrip(v) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
      all[`${screen.width}x${screen.height}`] = v;
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch {}
  }

  function measure() {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return { ok: false, reason: "il sito non è ottimizzato per smartphone" };
    if (/width\s*=\s*\d/i.test(meta.content) && !/width\s*=\s*device-width/i.test(meta.content) && S.originalViewport === undefined) {
      return { ok: false, reason: "il sito usa una larghezza fissa" };
    }
    if (!matchMedia("(orientation: portrait)").matches) return { ok: false, reason: "in orizzontale non è ancora gestito" };
    if (screen.width > 520) return { ok: false, reason: "sullo schermo interno non è ancora gestito" };
    const W = screen.width; // a schermo esterno la finestra di Safari occupa tutto lo schermo
    let strip = W - document.documentElement.clientWidth;
    if (strip < 40 || strip > 140) strip = outerWidth - innerWidth;
    if (strip >= 40 && strip <= 140) saveStrip(strip);
    else strip = cachedStrip();
    if (!strip) return { ok: false, reason: `colonna di Safari non trovata (${W - document.documentElement.clientWidth} pt)` };
    return { ok: true, W, strip };
  }

  // ---------- viewport ----------

  let applyingMeta = false;

  function setViewport() {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    if (S.originalViewport === undefined) S.originalViewport = meta.content;
    const parts = S.originalViewport
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x && !/^(width|initial-scale)\s*=/i.test(x));
    parts.unshift(`width=${S.W}`, "initial-scale=1");
    const wanted = parts.join(", ");
    if (meta.content !== wanted) {
      applyingMeta = true;
      meta.content = wanted;
      applyingMeta = false;
    }
  }

  function restoreViewport() {
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta && S.originalViewport !== undefined) {
      applyingMeta = true;
      meta.content = S.originalViewport;
      applyingMeta = false;
    }
    S.originalViewport = undefined;
  }

  // Se il sito riscrive il proprio meta viewport, lo rimettiamo a posto.
  const metaObserver = new MutationObserver(() => {
    if (!S.active || applyingMeta) return;
    setViewport();
  });

  // ---------- niente scorrimento laterale ----------

  const style = document.createElement("style");
  style.id = "duolargo-style";
  style.textContent = `html.duolargo-lock { touch-action: pan-y pinch-zoom !important; }`;

  function updateLock() {
    const vv = window.visualViewport;
    const zoomed = vv && vv.scale > 1.02;
    document.documentElement.classList.toggle("duolargo-lock", S.active && !zoomed);
    if (S.active && !zoomed && (scrollX > 0 || (vv && vv.offsetLeft > 0.5))) {
      window.scrollTo(0, scrollY);
    }
  }

  function scrollsSideways(el) {
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      if (e.scrollWidth > e.clientWidth + 2) {
        const ox = getComputedStyle(e).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
    }
    return false;
  }

  let gesture = null; // {x, y, horizontal}
  document.addEventListener("touchstart", (e) => {
    if (!S.active || e.touches.length !== 1) { gesture = null; return; }
    const t = e.touches[0];
    gesture = { x: t.clientX, y: t.clientY, horizontal: null, free: scrollsSideways(e.target) };
  }, { passive: true, capture: true });
  document.addEventListener("touchmove", (e) => {
    if (!S.active || !gesture || e.touches.length !== 1) return;
    const vv = window.visualViewport;
    if (vv && vv.scale > 1.02) return; // con lo zoom il movimento laterale serve
    const t = e.touches[0];
    if (gesture.horizontal === null) {
      const dx = Math.abs(t.clientX - gesture.x);
      const dy = Math.abs(t.clientY - gesture.y);
      if (dx + dy < 6) return;
      gesture.horizontal = dx > dy;
    }
    if (gesture.horizontal && !gesture.free && e.cancelable) e.preventDefault();
  }, { passive: false, capture: true });
  document.addEventListener("touchend", () => { gesture = null; }, { passive: true, capture: true });

  // ---------- testo protetto ----------

  const MEDIA = new Set(["IMG", "VIDEO", "PICTURE", "CANVAS", "IFRAME", "svg", "SVG", "EMBED", "OBJECT"]);
  const INTERACTIVE =
    'a[href],button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="switch"],[role="checkbox"]';
  const BLOCKISH = /^(block|flex|grid|list-item|table-cell|flow-root|table-caption)$/;

  function hasDirectText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim().length > 1) return true;
    return false;
  }

  function blockContainer(el, includeSelf) {
    let e = includeSelf ? el : el.parentElement;
    while (e && e !== document.documentElement) {
      if (BLOCKISH.test(getComputedStyle(e).display)) return e;
      e = e.parentElement;
    }
    return null;
  }

  function fixedAncestor(el) {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === "fixed" || p === "sticky") return e;
    }
    return null;
  }

  function protectPass() {
    const limit = S.W - S.strip;
    const all = document.body ? document.body.getElementsByTagName("*") : [];
    const wants = new Map(); // container -> extra padding
    const shifts = new Map(); // piccolo elemento fisso -> spostamento

    for (const el of all) {
      if (MEDIA.has(el.tagName) || el.closest("#duolargo-host, #duolargo-diag-host")) continue;
      const interactive = el.matches(INTERACTIVE);
      if (!interactive && !hasDirectText(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const right = r.right + scrollX;
      const left = r.left + scrollX;
      if (right <= limit + 0.5 || left >= S.W) continue; // non tocca la colonna o è fuori schermo
      const overlap = Math.ceil(right - limit);

      const fixed = fixedAncestor(el);
      if (fixed && fixed.getBoundingClientRect().width < S.W * 0.5) {
        shifts.set(fixed, Math.max(shifts.get(fixed) ?? 0, overlap));
        continue;
      }
      const c = blockContainer(el, !interactive);
      if (!c) continue;
      wants.set(c, Math.max(wants.get(c) ?? 0, overlap));
    }

    // Ogni contenitore riceve il padding una volta sola, calcolato sul SUO bordo destro:
    // prima veniva sommato a ogni passata e il testo diventava strettissimo.
    const plan = [];
    for (const c of wants.keys()) {
      if (S.padded.has(c)) continue;
      let skip = false;
      for (let a = c.parentElement; a; a = a.parentElement) if (S.padded.has(a) || wants.has(a)) { skip = true; break; }
      if (skip) continue;
      const r = c.getBoundingClientRect();
      const need = Math.ceil(r.right + scrollX - limit);
      if (need <= 0 || r.width - need < 120) continue;
      plan.push([c, need, parseFloat(getComputedStyle(c).paddingRight) || 0]);
    }
    for (const [c, need, pr] of plan) {
      S.padded.set(c, [c.style.getPropertyValue("padding-right"), c.style.getPropertyPriority("padding-right")]);
      c.style.setProperty("box-sizing", "border-box", "important");
      c.style.setProperty("padding-right", `${pr + need}px`, "important");
    }
    for (const [f, extra] of shifts) {
      if (S.moved.has(f)) continue;
      const cs = getComputedStyle(f);
      if (!S.moved.has(f)) {
        const prop = cs.right !== "auto" ? "right" : "left";
        S.moved.set(f, { prop, value: f.style.getPropertyValue(prop), priority: f.style.getPropertyPriority(prop) });
      }
      const { prop } = S.moved.get(f);
      const now = parseFloat(cs[prop]) || 0;
      f.style.setProperty(prop, `${prop === "right" ? now + extra : now - extra}px`, "important");
    }
    return plan.length + shifts.size;
  }

  function protect() {
    if (!S.active || S.layout !== "protetto") return;
    for (let i = 0; i < 4; i++) if (protectPass() === 0) break;
  }

  function unprotect() {
    for (const [c, [v, p]] of S.padded) {
      if (v) c.style.setProperty("padding-right", v, p);
      else c.style.removeProperty("padding-right");
      c.style.removeProperty("box-sizing");
    }
    for (const [f, { prop, value, priority }] of S.moved) {
      if (value) f.style.setProperty(prop, value, priority);
      else f.style.removeProperty(prop);
    }
    S.padded.clear();
    S.moved.clear();
  }

  let protectTimer = 0;
  function scheduleProtect(delay = 400) {
    clearTimeout(protectTimer);
    protectTimer = setTimeout(() => {
      if (S.active && S.layout === "protetto") protect();
    }, delay);
  }

  const domObserver = new MutationObserver((records) => {
    if (!S.active || S.layout !== "protetto") return;
    for (const r of records) {
      if (r.addedNodes.length && !(r.target.id === "duolargo-host")) {
        scheduleProtect(500);
        return;
      }
    }
  });

  // ---------- pulsante nella colonna ----------

  const host = document.createElement("div");
  host.id = "duolargo-host";
  host.style.cssText =
    "all:initial!important;position:fixed!important;top:0!important;left:0!important;" +
    "width:0!important;height:0!important;z-index:2147483647!important;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      button {
        position: fixed; width: 44px; height: 44px; border-radius: 22px; padding: 0;
        border: 1px solid rgba(255,255,255,.55);
        background: rgba(150,150,158,.55); color: #fff;
        -webkit-backdrop-filter: blur(14px) saturate(1.6); backdrop-filter: blur(14px) saturate(1.6);
        box-shadow: 0 2px 8px rgba(0,0,0,.18);
        display: flex; align-items: center; justify-content: center;
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
      }
      button.off { width: 34px; height: 34px; border-radius: 17px; opacity: .75; }
      button[hidden] { display: none; }
      svg { width: 22px; height: 22px; }
      .toast {
        position: fixed; left: 50%; transform: translateX(-50%); bottom: 90px;
        max-width: 300px; padding: 8px 14px; border-radius: 12px;
        background: rgba(30,30,34,.92); color: #fff; font: 14px/1.3 -apple-system, system-ui, sans-serif;
        text-align: center;
      }
      .toast[hidden] { display: none; }
    </style>
    <button type="button" hidden aria-label="Largo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>
      </svg>
    </button>
    <div class="toast" hidden></div>
  `;
  const btn = root.querySelector("button");
  const toast = root.querySelector(".toast");

  let toastTimer = 0;
  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 2200);
  }

  function placeButton() {
    const show = S.mode === "largo" && siteEnabled() && (S.active || S.tempOff);
    btn.hidden = !show;
    if (!show) return;
    btn.classList.toggle("off", !S.active);
    const top = Math.round(innerHeight * 0.6);
    btn.style.top = `${top}px`;
    if (S.active) {
      // i tasti di Safari sono centrati a circa il 42% della colonna (misurato sullo screenshot)
      btn.style.right = `${Math.round(S.strip * 0.58 - 22)}px`;
    } else {
      btn.style.right = "6px"; // pagina normale: il pulsante resta dentro la pagina
    }
  }

  btn.addEventListener("click", () => {
    if (S.active) {
      S.tempOff = true;
      deactivate();
      showToast("Pagina normale. Tocca di nuovo per allargarla.");
    } else {
      S.tempOff = false;
      evaluate();
      if (!S.active) showToast(`Non posso allargare: ${S.reason}.`);
      else showToast(S.layout === "protetto" ? "Allargata, testo protetto" : "Allargata a tutto schermo");
    }
    placeButton();
  });

  // ---------- attivazione ----------

  function activate(m) {
    S.W = m.W;
    S.strip = m.strip;
    S.screenKey = screenKey();
    S.active = true;
    S.reason = "attivo";
    S.ignoreResizeUntil = Date.now() + 800;
    setViewport();
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) metaObserver.observe(meta, { attributes: true, attributeFilter: ["content"] });
    updateLock();
    if (document.body) domObserver.observe(document.body, { childList: true, subtree: true });
    requestAnimationFrame(() => requestAnimationFrame(protect));
    scheduleProtect(1200); // seconda passata per immagini e font caricati dopo
    placeButton();
  }

  function deactivate() {
    if (!S.active) return;
    S.active = false;
    metaObserver.disconnect();
    domObserver.disconnect();
    clearTimeout(protectTimer);
    unprotect();
    S.ignoreResizeUntil = Date.now() + 800;
    restoreViewport();
    updateLock();
    placeButton();
  }

  function evaluate() {
    if (S.mode !== "largo") { S.reason = "modalità diagnostica"; deactivate(); placeButton(); return; }
    if (!siteEnabled()) { S.reason = "spento su questo sito"; deactivate(); placeButton(); return; }
    if (S.tempOff) { S.reason = "spento per questa pagina"; placeButton(); return; }
    if (S.active) return;
    const m = measure();
    if (!m.ok) { S.reason = m.reason; placeButton(); return; }
    activate(m);
  }

  // Telefono aperto/chiuso o rotazione: si torna alla pagina originale e si rimisura.
  function onResize() {
    if (Date.now() < S.ignoreResizeUntil) return;
    if (S.active && screenKey() !== S.screenKey) {
      deactivate();
      setTimeout(evaluate, 300);
      return;
    }
    if (!S.active) setTimeout(evaluate, 300);
    placeButton();
  }

  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(onResize, 300));
  window.visualViewport?.addEventListener("scroll", updateLock, { passive: true });
  window.visualViewport?.addEventListener("resize", updateLock, { passive: true });
  window.addEventListener("load", () => scheduleProtect(300));

  function setLayout(layout) {
    if (S.layout === layout) return;
    S.layout = layout;
    if (S.active) {
      unprotect();
      protect();
    }
  }

  // ---------- popup ----------

  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "status") {
      return Promise.resolve({ site, enabled: siteEnabled(), active: S.active, reason: S.reason, strip: S.strip, W: S.W });
    }
    return undefined;
  });

  // ---------- avvio ----------

  (document.head ?? document.documentElement).appendChild(style);
  (document.body ?? document.documentElement).appendChild(host);

  api.storage.local.get({ mode: "largo", layout: "protetto", disabledSites: [] }).then((v) => {
    S.mode = v.mode;
    S.layout = v.layout;
    S.disabledSites = v.disabledSites;
    evaluate();
  });

  api.storage.onChanged.addListener((changes) => {
    let reEval = false;
    if (changes.mode) { S.mode = changes.mode.newValue; reEval = true; }
    if (changes.disabledSites) { S.disabledSites = changes.disabledSites.newValue ?? []; reEval = true; }
    if (changes.layout) setLayout(changes.layout.newValue);
    if (reEval) {
      if (S.mode !== "largo" || !siteEnabled()) deactivate();
      S.tempOff = false;
      evaluate();
    }
    placeButton();
  });
})();
