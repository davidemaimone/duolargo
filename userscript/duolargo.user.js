// ==UserScript==
// @name         DuoLargo
// @namespace    io.github.davidemaimone.duolargo
// @version      0.6.9
// @description  Pagine a tutta larghezza sullo schermo esterno di iPhone Duo (versione di prova).
// @match        *://*/*
// @run-at       document-end
// @inject-into  content
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
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
  // Nello userscript non ci sono le API delle estensioni. Userscripts offre GM.getValue/GM.setValue,
  // validi per tutti i siti; se mancano si usa localStorage (vale solo per il sito corrente).
  function userscriptApi() {
    const gm = typeof GM !== "undefined" && GM.getValue && GM.setValue ? GM : null;
    const KEY = "duolargo:settings";
    const readLocal = () => {
      try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
    };
    return {
      storage: {
        local: {
          async get(defaults) {
            if (!gm) return { ...defaults, ...readLocal() };
            const out = { ...defaults };
            for (const k of Object.keys(defaults)) {
              try {
                const v = await gm.getValue(k);
                if (v !== undefined && v !== null) out[k] = JSON.parse(v);
              } catch {}
            }
            return out;
          },
          async set(values) {
            if (!gm) {
              try { localStorage.setItem(KEY, JSON.stringify({ ...readLocal(), ...values })); } catch {}
              return;
            }
            for (const [k, v] of Object.entries(values)) {
              try { await gm.setValue(k, JSON.stringify(v)); } catch {}
            }
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
    narrowSites: [], // siti che si aprono in "pagina normale"
    tempOff: false, // non usato più per il pulsante (vedi narrow)
    narrow: false, // "pagina normale": il contenuto torna a 382 pt ma il pulsante resta nella colonna
    active: false,
    W: 0,
    strip: 0,
    screenKey: "",
    originalViewport: undefined,
    padded: new Map(), // elemento -> padding-right inline originale
    moved: new Map(), // elemento posizionato -> {prop, value, priority}
    clipped: new Map(), // contenitore -> clip-path inline originale
    bled: new Map(), // carosello/immagine riallargato sotto la colonna -> stile inline originale
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

  // Siamo sullo schermo esterno di iPhone Duo? 466 × 678 pt (457 con "Sposta bordo sinistro").
  // Su iOS screen.width/height restano quelli in verticale anche ruotando il telefono.
  // In più la finestra di Safari non deve essere più larga dello schermo esterno: aprendo il
  // telefono screen.* può aggiornarsi in ritardo, outerWidth cambia subito.
  function onOuterScreen() {
    const sw = screen.width, sh = screen.height;
    return sw >= 448 && sw <= 470 && sh >= 640 && sh <= 720 && outerWidth <= 480;
  }

  function measure() {
    if (!onOuterScreen()) return { ok: false, reason: "funziona solo sullo schermo esterno di iPhone Duo" };
    // Gancio per il simulatore (tools/sim): la pagina di test fornisce larghezza e colonna.
    if (window.__DUOLARGO_TEST__) return { ok: true, ...window.__DUOLARGO_TEST__ };
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return { ok: false, reason: "il sito non è ottimizzato per smartphone" };
    if (/width\s*=\s*\d/i.test(meta.content) && !/width\s*=\s*device-width/i.test(meta.content) && S.originalViewport === undefined) {
      return { ok: false, reason: "il sito usa una larghezza fissa" };
    }
    if (!matchMedia("(orientation: portrait)").matches) return { ok: false, reason: "in orizzontale non è ancora gestito" };
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
      .filter((x) => x && !/^(width|initial-scale|minimum-scale|shrink-to-fit)\s*=/i.test(x));
    // minimum-scale=1 impedisce a Safari di rimpicciolire la pagina per farla stare prima della colonna
    parts.unshift(`width=${S.W}`, "initial-scale=1", "minimum-scale=1");
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
  style.textContent = `
    html.duolargo-lock { touch-action: pan-y pinch-zoom !important; }
    html.duolargo-narrow { padding-right: var(--duolargo-strip) !important; box-sizing: border-box !important; }
  `;

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

  // Elemento piccolo posizionato (fisso, assoluto, sticky): si sposta lui invece di stringere il contenitore.
  function positionedSmall(el) {
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === "fixed" || p === "absolute" || p === "sticky") {
        return e.getBoundingClientRect().width < S.W * 0.5 ? e : null;
      }
    }
    return null;
  }

  function inFixed(el) {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (getComputedStyle(e).position === "fixed") return true;
    }
    return false;
  }

  function clipAncestor(el) {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX;
      if (o === "hidden" || o === "clip") return e;
    }
    return null;
  }

  function sideScroller(el) {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX;
      if ((o === "auto" || o === "scroll") && e.scrollWidth > e.clientWidth + 2) return e;
    }
    return null;
  }

  // Dove finisce davvero il contenuto: per il testo le lettere, per il resto il riquadro.
  function contentRight(el, interactive) {
    if (interactive) return el.getBoundingClientRect().right;
    let right = -Infinity;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const rr of range.getClientRects()) if (rr.width) right = Math.max(right, rr.right);
    }
    return right;
  }

  // Contenitore da accorciare e di quanto. Si sale verso l'alto finché si trova un contenitore
  // che si può accorciare senza schiacciare il testo (contenuto ≥ 160 pt e ≥ 55% di prima).
  // Mai due margini uno dentro l'altro: se il contenitore o un suo antenato è già stato accorciato
  // e l'elemento sborda ancora (testo che non va a capo, larghezze fisse, 100vw…) ci si arrende.
  // Slider/ticker: contenitore con overflow nascosto il cui contenuto è più largo di lui.
  function sliderAncestor(el) {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === "hidden" || ox === "clip") && e.scrollWidth > e.clientWidth + 2) return e;
    }
    return null;
  }

  function planFor(el, interactive, limit) {
    // dentro uno slider non si accorciano le singole slide: si parte dallo slider intero
    let c = sliderAncestor(el) || blockContainer(el, !interactive);
    let clipFallback = null; // slider/ticker con overflow nascosto, se non si trova di meglio
    const measure = (c) => {
      const cs = getComputedStyle(c);
      const cr = c.getBoundingClientRect();
      const pr = parseFloat(cs.paddingRight) || 0;
      const pl = parseFloat(cs.paddingLeft) || 0;
      const br = parseFloat(cs.borderRightWidth) || 0;
      const bl = parseFloat(cs.borderLeftWidth) || 0;
      const need = Math.ceil(cr.right - br - pr - limit);
      const contentNow = cr.width - pl - pr - bl - br;
      return { cs, cr, pr, need, ok: need > 0 && contentNow - need >= Math.max(160, contentNow * 0.55) };
    };
    while (c && c !== document.body && c !== document.documentElement) {
      if (S.padded.has(c)) return null;
      const m = measure(c);
      if (m.need <= 0) return null; // il contenitore finisce già prima: il problema è altrove
      // uno slider o un ticker con overflow nascosto mostrerebbe il contenuto nascosto nel margine
      // aggiunto: meglio accorciare il contenitore che lo racchiude (si restringe tutto intero)
      const ox = m.cs.overflowX;
      if ((ox === "hidden" || ox === "clip") && c.scrollWidth > c.clientWidth + 2) {
        if (!clipFallback && m.ok) clipFallback = { c, value: m.pr + m.need, need: m.need, clip: Math.ceil(m.cr.right - limit) };
        c = blockContainer(c, false);
        continue;
      }
      if (m.ok) {
        for (let a = c.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          if (S.padded.has(a)) return null;
        }
        return { c, value: m.pr + m.need, need: m.need };
      }
      c = blockContainer(c, false);
    }
    return clipFallback; // nessun contenitore esterno adatto: si accorcia lo slider e si ritaglia
  }

  // Caroselli e immagini larghe dentro un contenitore accorciato: li si riporta fino al bordo
  // dello schermo (sotto i tasti di Safari ci possono stare), mentre testo e pulsanti restano protetti.
  // Solo righe che l'utente fa scorrere col dito (overflow auto/scroll). Gli slider "a scatti"
  // con overflow nascosto contengono spesso titoli e testo: allargarli mostra la slide successiva
  // sotto la colonna. Si riallargano solo se quasi privi di testo.
  function isCarousel(el, cs) {
    const ox = cs.overflowX;
    return (ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 2;
  }

  function insideBled(el) {
    for (let e = el; e && e !== document.body; e = e.parentElement) if (S.bled.has(e)) return true;
    return false;
  }

  function bleed(pads, limit) {
    const targets = [];
    for (const [c, { need }] of pads) {
      const cr = c.getBoundingClientRect();
      const contentW = cr.width - (parseFloat(getComputedStyle(c).paddingLeft) || 0) - need;
      const walker = document.createTreeWalker(c, NodeFilter.SHOW_ELEMENT);
      for (let el = walker.nextNode(); el; el = walker.nextNode()) {
        if (S.bled.has(el) || el.id === "duolargo-host") continue;
        const cs = getComputedStyle(el);
        if (cs.position === "absolute" || cs.position === "fixed") continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const media = MEDIA.has(el.tagName) && r.width >= contentW * 0.9;
        if (!media && !isCarousel(el, cs)) continue;
        // deve arrivare quasi al bordo del contenuto accorciato
        if (r.right < limit - 4) continue;
        // e non deve uscire da un riquadro intermedio (scheda con sfondo o bordi arrotondati)
        let boxed = false;
        for (let a = el.parentElement; a && a !== c; a = a.parentElement) {
          if (a.getBoundingClientRect().right < limit + need - 1) { boxed = true; break; }
        }
        if (boxed) continue;
        targets.push([el, Math.round(limit + need - r.right), r.width]);
        // i discendenti di un elemento riallargato vengono con lui: si salta il sottoalbero
        let next = el;
        while (next && !next.nextElementSibling && next !== c) next = next.parentElement;
        if (!next || next === c) break;
        walker.currentNode = next;
      }
    }
    for (const [el, extraWanted, width] of targets) {
      // mai oltre il bordo dello schermo
      const extra = Math.min(extraWanted, Math.floor(S.W - el.getBoundingClientRect().right));
      if (extra <= 0) continue;
      S.bled.set(el, ["width", "max-width", "margin-right", "box-sizing"].map((p) => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]));
      el.style.setProperty("box-sizing", "border-box", "important"); // la larghezza include il padding
      el.style.setProperty("max-width", "none", "important");
      el.style.setProperty("width", `${Math.round(width + extra)}px`, "important");
      el.style.setProperty("margin-right", `-${extra}px`, "important");
    }
  }

  function protectPass() {
    const limit = S.W - S.strip;
    const all = document.body ? document.body.getElementsByTagName("*") : [];
    const pads = new Map(); // contenitore -> padding-right nuovo
    const shifts = new Map(); // elemento posizionato -> spostamento
    const clips = new Map(); // contenitore con overflow nascosto -> ritaglio

    for (const el of all) {
      if (MEDIA.has(el.tagName) || el.id === "duolargo-host" || el.id === "duolargo-diag-host") continue;
      const interactive = el.matches(INTERACTIVE);
      if (!interactive && !hasDirectText(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.left >= S.W) continue;
      if (sideScroller(el)) continue; // caroselli: scorrono, passano sotto la colonna per forza
      if (insideBled(el)) continue;
      if (S.narrow && !inFixed(el)) continue;
      let right = contentRight(el, interactive);
      const ca = clipAncestor(el);
      if (ca) right = Math.min(right, ca.getBoundingClientRect().right);
      if (right <= limit + 0.5) continue;
      const overlap = Math.ceil(right - limit);

      const ps = positionedSmall(el);
      if (ps) {
        if (!S.moved.has(ps)) shifts.set(ps, Math.max(shifts.get(ps) ?? 0, overlap));
        continue;
      }
      // testo che esce da un contenitore già accorciato con overflow nascosto (es. ticker): si ritaglia
      if (ca && S.padded.has(ca) && !S.clipped.has(ca)) {
        clips.set(ca, Math.ceil(ca.getBoundingClientRect().right - limit));
        continue;
      }
      const plan = planFor(el, interactive, limit);
      if (!plan || pads.has(plan.c)) continue;
      pads.set(plan.c, plan);
    }

    // scritture tutte insieme, dopo le letture
    // un contenitore che ne racchiude un altro dello stesso giro vince: niente margini annidati
    for (const c of [...pads.keys()]) {
      for (let a = c.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        if (pads.has(a)) { pads.delete(c); break; }
      }
    }
    for (const [c, { clip }] of pads) {
      if (!clip || S.clipped.has(c)) continue;
      const radius = getComputedStyle(c).borderTopRightRadius;
      S.clipped.set(c, [c.style.getPropertyValue("clip-path"), c.style.getPropertyPriority("clip-path")]);
      c.style.setProperty("clip-path", `inset(0 ${clip}px 0 0${radius && radius !== "0px" ? ` round ${radius}` : ""})`, "important");
    }
    for (const [c, { value }] of pads) {
      S.padded.set(c, [c.style.getPropertyValue("padding-right"), c.style.getPropertyPriority("padding-right"),
                       c.style.getPropertyValue("box-sizing"), c.style.getPropertyPriority("box-sizing")]);
      c.style.setProperty("box-sizing", "border-box", "important");
      c.style.setProperty("padding-right", `${value}px`, "important");
    }
    bleed(pads, limit);
    for (const [f, extra] of shifts) {
      const cs = getComputedStyle(f);
      const prop = cs.right !== "auto" ? "right" : "left";
      S.moved.set(f, { prop, value: f.style.getPropertyValue(prop), priority: f.style.getPropertyPriority(prop) });
      const now = parseFloat(cs[prop]) || 0;
      f.style.setProperty(prop, `${prop === "right" ? now + extra : now - extra}px`, "important");
    }
    for (const [c, inset] of clips) {
      S.clipped.set(c, [c.style.getPropertyValue("clip-path"), c.style.getPropertyPriority("clip-path")]);
      c.style.setProperty("clip-path", `inset(0 ${inset}px 0 0)`, "important");
    }
    return pads.size + shifts.size + clips.size;
  }

  function pageWiderThanScreen() {
    if (document.documentElement.scrollWidth > S.W + 1) return true;
    for (const el of S.bled.keys()) if (el.getBoundingClientRect().right > S.W + 1) return true;
    return false;
  }

  function unbleed() {
    const put = (el, prop, v, p) => (v ? el.style.setProperty(prop, v, p) : el.style.removeProperty(prop));
    for (const [el, props] of S.bled) for (const [prop, v, p] of props) put(el, prop, v, p);
    S.bled.clear();
  }

  function protect() {
    if (!S.active) return;
    protectInner();
    // la pagina non deve mai diventare più larga dello schermo: Safari sposterebbe gli elementi
    // fissi (il pulsante finirebbe in mezzo alla pagina e non risponderebbe più ai tocchi)
    if (S.bled.size && pageWiderThanScreen()) unbleed();
  }

  function protectInner() {
    // in "pagina normale" si sistemano solo le barre fisse (il resto sta già entro 382 pt);
    // con "tutto schermo" non si tocca niente
    if (!S.narrow && S.layout !== "protetto") return;
    for (let i = 0; i < 6; i++) if (protectPass() === 0) break;
  }

  function unprotect() {
    const put = (el, prop, v, p) => (v ? el.style.setProperty(prop, v, p) : el.style.removeProperty(prop));
    for (const [c, [v, p, bv, bp]] of S.padded) {
      put(c, "padding-right", v, p);
      put(c, "box-sizing", bv, bp);
    }
    for (const [f, { prop, value, priority }] of S.moved) put(f, prop, value, priority);
    for (const [c, [v, p]] of S.clipped) put(c, "clip-path", v, p);
    for (const [el, props] of S.bled) for (const [prop, v, p] of props) put(el, prop, v, p);
    S.bled.clear();
    S.padded.clear();
    S.moved.clear();
    S.clipped.clear();
  }

  let protectTimer = 0;
  function scheduleProtect(delay = 400) {
    clearTimeout(protectTimer);
    protectTimer = setTimeout(() => {
      protect();
    }, delay);
  }

  const domObserver = new MutationObserver((records) => {
    if (!S.active || (!S.narrow && S.layout !== "protetto")) return;
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
    // Assoluto rispetto alla pagina, non fisso: quando la pagina è più larga di quanto Safari
    // si aspetta, Safari disegna gli elementi fissi in un punto diverso da quello che crede
    // JavaScript (pulsante in mezzo alla pagina e tocchi che vanno a vuoto). Gli elementi
    // assoluti invece stanno sempre dove li mettiamo.
    "all:initial!important;position:absolute!important;top:0!important;left:0!important;" +
    "width:0!important;height:0!important;z-index:2147483647!important;";
  const root = host.attachShadow({ mode: window.__DUOLARGO_TEST__ ? "open" : "closed" });
  root.innerHTML = `
    <style>
      button {
        position: absolute; width: 48px; height: 48px; border-radius: 24px; padding: 0; margin: 0;
        border: 0.5px solid rgba(110,110,118,.28);
        background: rgba(162,162,168,.82); color: #fff;
        -webkit-backdrop-filter: blur(12px) saturate(1.8); backdrop-filter: blur(12px) saturate(1.8);
        box-shadow: inset 0 1px 1px rgba(255,255,255,.35), 0 1px 4px rgba(0,0,0,.12);
        display: flex; align-items: center; justify-content: center;
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
        transition: opacity .2s ease-out;
      }
      button.dark {
        background: rgba(40,40,43,.84); border-color: rgba(255,255,255,.11);
        box-shadow: inset 0 1px 1px rgba(255,255,255,.14), 0 2px 8px rgba(0,0,0,.3);
      }
      /* stato: freccia azzurra = pagina allargata, bianca = pagina normale */
      button svg { color: #fff; transition: color .2s; }
      button.on svg { color: #0a84ff; }
      button.on:not(.dark) svg { color: #0066e0; }
      button.moving { opacity: 0; transition: none; }
      button[hidden] { display: none; }
      svg { width: 28px; height: 28px; }
      .toast {
        position: absolute; transform: translateX(-50%); white-space: normal; width: max-content;
        max-width: 300px; padding: 8px 14px; border-radius: 12px;
        background: rgba(30,30,34,.92); color: #fff; font: 14px/1.3 -apple-system, system-ui, sans-serif;
        text-align: center;
      }
      .toast[hidden] { display: none; }
      .menu {
        position: absolute; box-sizing: border-box; width: 250px; padding: 14px; border-radius: 18px;
        background: rgba(28,28,32,.94); color: #f5f5f7;
        -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px);
        box-shadow: 0 10px 34px rgba(0,0,0,.35);
        font: 15px/1.35 -apple-system, system-ui, sans-serif;
        -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
      }
      .menu[hidden] { display: none; }
      .menu .t { margin: 0 0 10px; font-weight: 600; font-size: 16px; }
      .menu .lbl { margin: 0 0 6px; color: #a1a1a8; font-size: 13px; }
      .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 3px; border-radius: 11px; background: #3a3a40; }
      .seg div { padding: 9px 4px; border-radius: 9px; text-align: center; font-size: 13.5px; }
      .seg div.on { background: #f5f5f7; color: #1c1c1e; font-weight: 600; }
      .menu .hint { margin: 8px 0 12px; color: #a1a1a8; font-size: 12.5px; }
      .menu .row { display: flex; align-items: center; justify-content: space-between; gap: 10px;
                   padding: 11px 0; border-top: 1px solid rgba(255,255,255,.12); }
      .sw { flex: none; width: 42px; height: 26px; border-radius: 13px; background: #55555c; position: relative; transition: background .15s; }
      .sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left .15s; }
      .sw.on { background: #34c759; }
      .sw.on::after { left: 19px; }
      .menu .row.close { justify-content: center; color: #78aaeb; font-weight: 600; padding-bottom: 2px; }
    </style>
    <button type="button" hidden aria-label="Largo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3.5 12h17M8 7.5l-4.5 4.5 4.5 4.5M16 7.5l4.5 4.5-4.5 4.5"/>
      </svg>
    </button>
    <div class="toast" hidden></div>
    <div class="menu" hidden>
      <p class="t">DuoLargo</p>
      <p class="lbl">Testo vicino alla colonna di Safari</p>
      <div class="seg">
        <div data-act="protetto">Testo protetto</div>
        <div data-act="tutto">Tutto schermo</div>
      </div>
      <p class="hint"></p>
      <div class="row" data-act="site"><span>Apri questo sito in pagina normale</span><span class="sw"></span></div>
      <div class="row close" data-act="close">Chiudi</div>
    </div>
  `;
  const btn = root.querySelector("button");
  const toast = root.querySelector(".toast");
  const menu = root.querySelector(".menu");
  const HINTS = {
    protetto: "Sfondi e foto arrivano al bordo; testo, link e pulsanti si fermano prima dei tasti di Safari.",
    tutto: "Tutta la pagina arriva al bordo, anche il testo: qualcosa può finire sotto i tasti.",
  };

  let toastTimer = 0;
  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    const vv = window.visualViewport;
    const pageTop = vv ? vv.pageTop : scrollY;
    const visH = vv ? vv.height : innerHeight;
    const pageLeft = vv ? vv.pageLeft : scrollX;
    toast.style.top = `${Math.round(pageTop + visH - 150)}px`;
    toast.style.left = `${Math.round(pageLeft + (S.W - S.strip || innerWidth) / 2)}px`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 2200);
  }


  // Con la pagina allargata Safari impagina gli elementi fissi su un'area più alta di quella visibile:
  // per restare fermo rispetto allo schermo il pulsante segue la "finestra visibile" (visualViewport).
  // Misure dei tasti di Safari sullo schermo esterno (dagli screenshot, in punti):
  // cerchi da 48, centrati a 48 pt dal bordo destro, un tasto ogni 60 pt (12 pt di spazio).
  // "Indietro" ha il centro a 198, "Lettore" a 258. Quando c'è anche "Avanti", indietro e avanti
  // diventano una pillola e "Lettore" scende a 312.
  const SAFARI = { size: 48, step: 60, readerCenter: 258, readerCenterWithForward: 312, fromRight: 48 };

  // C'è il tasto "Avanti"? Safari non lo dice alle pagine (nel tuo test la Navigation API ha
  // risposto di no anche con il tasto visibile), quindi si deduce da come si è arrivati qui:
  // tornando indietro (o con la cache avanti/indietro) di solito esiste una pagina "avanti";
  // seguendo un link nuovo no. In caso di dubbio meglio un po' di spazio in più che coprire il Lettore.
  const FWD_KEY = "duolargo:fwd:" + location.href;
  let fwdHint = false;
  try {
    const type = performance.getEntriesByType("navigation")[0]?.type;
    if (type === "back_forward") fwdHint = true;
    else if (type === "reload") fwdHint = sessionStorage.getItem(FWD_KEY) === "1";
  } catch {}
  function rememberFwd() {
    try { sessionStorage.setItem(FWD_KEY, fwdHint ? "1" : "0"); } catch {}
  }
  rememberFwd();
  window.addEventListener("pageshow", (e) => { if (e.persisted) { fwdHint = true; rememberFwd(); } });
  window.addEventListener("popstate", () => { fwdHint = true; rememberFwd(); setTimeout(placeButton, 50); });

  function canGoForward() {
    let api = false;
    try { api = !!(window.navigation && navigation.canGoForward); } catch {}
    return api || fwdHint;
  }

  // Vetro chiaro o scuro come fa Safari: guarda il colore della pagina dietro la colonna.
  function pageLuminance() {
    const lum = (el) => {
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (!m) return null;
      const [r, g, b, a = 1] = m.map(Number);
      return a < 0.5 ? null : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    try {
      const y = Math.min(innerHeight - 1, Math.max(0, parseFloat(btn.style.top || "0") - scrollY + 24));
      for (const el of document.elementsFromPoint(Math.min(innerWidth - 2, S.W - S.strip - 2), y)) {
        if (el === host) continue;
        for (let e = el; e; e = e.parentElement) {
          const l = lum(e);
          if (l !== null) return l;
        }
      }
    } catch {}
    return lum(document.body) ?? lum(document.documentElement) ?? (matchMedia("(prefers-color-scheme: dark)").matches ? 0 : 1);
  }

  // Il pulsante esiste solo alle due grandezze previste (pagina normale e allargata, entrambe a
  // scala 1). Con lo zoom a due dita è nella pagina e si ingrandirebbe/sposterebbe con lei: si nasconde.
  function isZoomed() {
    const vv = window.visualViewport;
    return !!vv && Math.abs(vv.scale - 1) > 0.02;
  }

  function placeButton() {
    const zoomed = isZoomed();
    const show = S.mode === "largo" && siteEnabled() && S.active && !zoomed && onOuterScreen();
    btn.hidden = !show;
    if (zoomed && !menu.hidden) closeMenu();
    document.documentElement.dataset.duolargoZoom = zoomed ? "si" : "no";
    if (!show) return;
    btn.classList.toggle("on", !S.narrow);
    const vv = window.visualViewport;
    const pageTop = vv ? vv.pageTop : scrollY;
    const reader = canGoForward() ? SAFARI.readerCenterWithForward : SAFARI.readerCenter;
    const centerY = reader + SAFARI.step;
    const centerX = S.W - SAFARI.fromRight * (S.strip / 84);
    btn.style.top = `${Math.round(pageTop + centerY - SAFARI.size / 2)}px`;
    btn.style.left = `${Math.round(centerX - SAFARI.size / 2)}px`;
    btn.classList.toggle("dark", pageLuminance() < 0.45);
    document.documentElement.dataset.duolargoState = S.narrow ? "normale" : "larga";
  }

  let placeQueued = false;
  function queuePlace() {
    if (placeQueued) return;
    placeQueued = true;
    requestAnimationFrame(() => { placeQueued = false; placeButton(); });
  }

  // Mentre la pagina scorre Safari sposta in ritardo gli elementi fissi: il pulsante si dissolve
  // e ricompare al suo posto quando la pagina è ferma. Il tocco continua a funzionare.
  // Si aspetta che la pagina sia ferma: nessun evento di scorrimento per un po' E posizione
  // invariata fra due controlli. Prima il pulsante ricompariva, l'inerzia finale lo rinascondeva
  // e poi ricompariva di nuovo (il "lampeggio").
  let settleTimer = 0;
  let lastMoveAt = 0;
  let lastTop = null;
  let fingerDown = false;
  const currentTop = () => (window.visualViewport ? visualViewport.pageTop : scrollY);
  function checkSettled() {
    const top = currentTop();
    if (fingerDown || performance.now() - lastMoveAt < 180 || top !== lastTop) {
      lastTop = top;
      settleTimer = setTimeout(checkSettled, 120);
      return;
    }
    placeButton();
    btn.classList.remove("moving");
  }
  function onMove() {
    if (!menu.hidden) closeMenu();
    if (btn.hidden) return;
    btn.classList.add("moving");
    lastMoveAt = performance.now();
    lastTop = currentTop();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(checkSettled, 200);
  }
  window.addEventListener("scroll", onMove, { passive: true });
  window.visualViewport?.addEventListener("scroll", onMove, { passive: true });
  document.addEventListener("touchstart", () => { fingerDown = true; }, { passive: true, capture: true });
  const fingerUp = () => { fingerDown = false; };
  document.addEventListener("touchend", fingerUp, { passive: true, capture: true });
  document.addEventListener("touchcancel", fingerUp, { passive: true, capture: true });
  // la pillola indietro/avanti di Safari cambia quando si naviga: si ricolloca il pulsante
  try { window.navigation?.addEventListener("currententrychange", () => setTimeout(placeButton, 50)); } catch {}
  window.addEventListener("pageshow", () => setTimeout(placeButton, 50));
  window.visualViewport?.addEventListener("resize", queuePlace, { passive: true });

  function setNarrow(on) {
    S.narrow = on;
    document.documentElement.style.setProperty("--duolargo-strip", `${S.strip}px`);
    document.documentElement.classList.toggle("duolargo-narrow", on);
    unprotect();
    requestAnimationFrame(() => requestAnimationFrame(protect));
  }

  function toggle() {
    if (S.active) {
      setNarrow(!S.narrow); // lo stato si legge dal colore della freccia
    } else {
      evaluate();
      if (!S.active) showToast(`Non posso allargare: ${S.reason}.`);
    }
    placeButton();
  }

  // ---------- menu (pressione lunga sul pulsante) ----------

  function siteNarrowByDefault() {
    return S.narrowSites.includes(site);
  }

  function renderMenu() {
    for (const o of menu.querySelectorAll(".seg [data-act]")) o.classList.toggle("on", o.dataset.act === S.layout);
    menu.querySelector(".hint").textContent = HINTS[S.layout] || "";
    menu.querySelector(".sw").classList.toggle("on", siteNarrowByDefault());
  }

  function placeMenu() {
    const vv = window.visualViewport;
    const pageTop = vv ? vv.pageTop : scrollY;
    const visH = vv ? vv.height : innerHeight;
    const btnTop = parseFloat(btn.style.top) || pageTop + visH * 0.6;
    const h = menu.getBoundingClientRect().height || 260;
    const top = Math.max(pageTop + 12, Math.min(pageTop + visH - h - 12, btnTop + 24 - h / 2));
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(S.W - S.strip - 12 - 250)}px`; // finisce 12 pt prima della colonna
  }

  function openMenu() {
    renderMenu();
    menu.hidden = false;
    placeMenu();
    document.documentElement.dataset.duolargoMenu = "aperto";
  }

  function closeMenu() {
    menu.hidden = true;
    document.documentElement.dataset.duolargoMenu = "chiuso";
  }

  async function menuAction(act) {
    if (act === "protetto" || act === "tutto") {
      await api.storage.local.set({ layout: act });
      setLayout(act);
      renderMenu();
    } else if (act === "site") {
      const set = new Set(S.narrowSites);
      if (set.has(site)) set.delete(site);
      else set.add(site);
      S.narrowSites = [...set];
      await api.storage.local.set({ narrowSites: S.narrowSites });
      if (S.active && siteNarrowByDefault() !== S.narrow) setNarrow(siteNarrowByDefault());
      renderMenu();
      placeButton();
    } else if (act === "close") {
      closeMenu();
    }
  }

  // Safari non sempre consegna il tocco al pulsante (il punto disegnato e quello "toccabile"
  // non coincidono con la pagina allargata). Quindi controlliamo noi le coordinate di ogni tocco.
  const inRect = (el, x, y, m = 0) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m;
  };
  const onButton = (x, y) => !btn.hidden && inRect(btn, x, y, 10);

  let tap = null; // { x, y, kind: "button" | "menu" | "outside", long }
  let pressTimer = 0;
  let lastHandled = 0;

  document.addEventListener("touchstart", (e) => {
    clearTimeout(pressTimer);
    const t = e.touches[0];
    if (!t || e.touches.length !== 1) { tap = null; return; }
    const x = t.clientX, y = t.clientY;
    if (!menu.hidden && inRect(menu, x, y)) {
      tap = { x, y, kind: "menu" };
      if (e.cancelable) e.preventDefault();
    } else if (onButton(x, y)) {
      tap = { x, y, kind: "button", long: false };
      if (e.cancelable) e.preventDefault();
      pressTimer = setTimeout(() => {
        if (tap && tap.kind === "button") {
          tap.long = true;
          openMenu();
        }
      }, 450);
    } else {
      tap = menu.hidden ? null : { x, y, kind: "outside" };
    }
  }, { capture: true, passive: false });

  document.addEventListener("touchmove", (e) => {
    if (!tap) return;
    const t = e.touches[0];
    if (t && (Math.abs(t.clientX - tap.x) > 12 || Math.abs(t.clientY - tap.y) > 12)) {
      clearTimeout(pressTimer);
      if (tap.kind !== "menu") tap = null;
    }
  }, { capture: true, passive: true });

  document.addEventListener("touchend", (e) => {
    clearTimeout(pressTimer);
    if (!tap) return;
    const cur = tap;
    tap = null;
    const t = e.changedTouches[0];
    if (!t || Math.abs(t.clientX - cur.x) > 12 || Math.abs(t.clientY - cur.y) > 12) return;
    if (cur.kind === "outside") { closeMenu(); return; }
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    lastHandled = Date.now();
    if (cur.kind === "menu") {
      for (const o of menu.querySelectorAll("[data-act]")) {
        if (inRect(o, t.clientX, t.clientY)) { menuAction(o.dataset.act); break; }
      }
    } else if (!cur.long) {
      closeMenu();
      toggle();
    }
  }, { capture: true, passive: false });

  // riserva: se il tocco arriva come click normale (es. nel simulatore senza touch)
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    if (Date.now() - lastHandled < 600) return;
    lastHandled = Date.now();
    toggle();
  });
  menu.addEventListener("click", (e) => {
    if (Date.now() - lastHandled < 600) return;
    const o = e.target.closest("[data-act]");
    if (o) { lastHandled = Date.now(); menuAction(o.dataset.act); }
  });
  btn.addEventListener("contextmenu", (e) => e.preventDefault());

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
    if (siteNarrowByDefault()) setNarrow(true);
    else requestAnimationFrame(() => requestAnimationFrame(protect));
    scheduleProtect(1200); // seconda passata per immagini e font caricati dopo
    placeButton();
  }

  function deactivate() {
    if (!S.active) return;
    closeMenu();
    S.active = false;
    if (S.narrow) setNarrow(false);
    S.narrow = false;
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

  // Aprendo o chiudendo il telefono Safari non sempre avvisa la pagina in tempo (eventi persi
  // mentre la pagina era sospesa, misure dello schermo aggiornate in ritardo). Quindi si
  // ricontrolla anche a intervalli regolari e ogni volta che la pagina torna visibile.
  function watchdog() {
    if (S.mode !== "largo") return;
    if (S.active && !onOuterScreen()) {
      deactivate();
      S.reason = "funziona solo sullo schermo esterno di iPhone Duo";
      placeButton();
      return;
    }
    if (!S.active && !S.tempOff && siteEnabled() && onOuterScreen()) evaluate();
  }
  const watchSoon = () => { watchdog(); setTimeout(watchdog, 300); setTimeout(watchdog, 1200); };
  for (const ev of ["resize", "orientationchange", "pageshow", "focus"]) window.addEventListener(ev, watchSoon, { passive: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) watchSoon(); });
  window.visualViewport?.addEventListener("resize", watchdog, { passive: true });
  setInterval(watchdog, 800);
  window.visualViewport?.addEventListener("scroll", updateLock, { passive: true });
  window.visualViewport?.addEventListener("resize", updateLock, { passive: true });
  window.addEventListener("load", () => scheduleProtect(300));

  function setLayout(layout) {
    document.documentElement.dataset.duolargoLayout = layout;
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
  document.documentElement.appendChild(host); // fuori dal body: niente contenitori posizionati del sito

  api.storage.local.get({ mode: "largo", layout: "protetto", disabledSites: [], narrowSites: [] }).then((v) => {
    S.mode = v.mode;
    S.layout = v.layout;
    document.documentElement.dataset.duolargoLayout = v.layout;
    S.disabledSites = v.disabledSites;
    S.narrowSites = v.narrowSites || [];
    evaluate();
  });

  api.storage.onChanged.addListener((changes) => {
    let reEval = false;
    if (changes.mode) { S.mode = changes.mode.newValue; reEval = true; }
    if (changes.disabledSites) { S.disabledSites = changes.disabledSites.newValue ?? []; reEval = true; }
    if (changes.layout) setLayout(changes.layout.newValue);
    if (changes.narrowSites) S.narrowSites = changes.narrowSites.newValue ?? [];
    if (reEval) {
      if (S.mode !== "largo" || !siteEnabled()) deactivate();
      S.tempOff = false;
      evaluate();
    }
    placeButton();
  });
})();
