// DuoLargo — content script diagnostico (fase 1).
// Non allarga ancora niente: misura come Safari dispone la pagina
// nelle quattro situazioni (esterno, interno, Split View sx/dx).

(() => {
  if (window.top !== window) return;
  if (window.__duoLargoDiag) return;
  window.__duoLargoDiag = true;

  const api = globalThis.browser ?? globalThis.chrome;

  const SITUAZIONI = [
    ["?", "Situazione: scegli"],
    ["esterno", "Schermo esterno (chiuso)"],
    ["interno", "Interno, Safari a tutto schermo"],
    ["split-sx", "Split View, Safari a sinistra"],
    ["split-dx", "Split View, Safari a destra"],
    ["altro", "Altro (orizzontale, piegato…)"],
  ];

  const state = {
    enabled: true,
    open: false,
    situazione: "?",
    native: null,
    touch: null,
    cover: false,
    originalViewport: undefined, // undefined = non toccato, null = non c'era
    bars: false,
  };

  // ---------- misure ----------

  const r2 = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);

  function readSafeArea() {
    const p = document.createElement("div");
    p.style.cssText =
      "position:fixed!important;top:0!important;left:0!important;visibility:hidden!important;" +
      "pointer-events:none!important;box-sizing:content-box!important;width:0!important;height:0!important;" +
      "padding-top:env(safe-area-inset-top,0px)!important;padding-right:env(safe-area-inset-right,0px)!important;" +
      "padding-bottom:env(safe-area-inset-bottom,0px)!important;padding-left:env(safe-area-inset-left,0px)!important;";
    document.documentElement.appendChild(p);
    const cs = getComputedStyle(p);
    const v = {
      top: parseFloat(cs.paddingTop),
      right: parseFloat(cs.paddingRight),
      bottom: parseFloat(cs.paddingBottom),
      left: parseFloat(cs.paddingLeft),
    };
    p.remove();
    return v;
  }

  function readSegments() {
    try {
      const segs = window.viewport?.segments;
      if (!segs) return "n/d";
      return segs.map((s) => `${r2(s.x)},${r2(s.y)} ${r2(s.width)}×${r2(s.height)}`).join(" | ");
    } catch (e) {
      return "errore";
    }
  }

  function collect() {
    const vv = window.visualViewport;
    const de = document.documentElement;
    const meta = document.querySelector('meta[name="viewport"]');
    const sa = readSafeArea();
    return {
      situazione: state.situazione,
      ora: new Date().toISOString(),
      sito: location.hostname,
      inner: `${innerWidth} × ${innerHeight}`,
      outer: `${outerWidth} × ${outerHeight}`,
      clientDoc: `${de.clientWidth} × ${de.clientHeight}`,
      scrollWidth: de.scrollWidth,
      scrollXY: `${r2(scrollX)} , ${r2(scrollY)}`,
      screen: `${screen.width} × ${screen.height}`,
      screenAvail: `${screen.availWidth} × ${screen.availHeight}`,
      screenAvailLT: `${screen.availLeft ?? "n/d"} , ${screen.availTop ?? "n/d"}`,
      screenXY: `${window.screenX} , ${window.screenY}`,
      screenLeftTop: `${window.screenLeft} , ${window.screenTop}`,
      visualViewport: vv
        ? `${r2(vv.width)} × ${r2(vv.height)} · offset ${r2(vv.offsetLeft)},${r2(vv.offsetTop)} · page ${r2(vv.pageLeft)},${r2(vv.pageTop)} · scala ${r2(vv.scale)}`
        : "n/d",
      dpr: devicePixelRatio,
      orientamento: screen.orientation
        ? `${screen.orientation.type} ${screen.orientation.angle}°`
        : `window.orientation ${window.orientation}`,
      mqPortrait: matchMedia("(orientation: portrait)").matches,
      safeArea: `sx ${sa.left} · dx ${sa.right} · su ${sa.top} · giù ${sa.bottom}`,
      coverAttivo: state.cover,
      metaViewport: meta ? meta.content : "(assente)",
      posture: navigator.devicePosture?.type ?? "n/d",
      segmenti: readSegments(),
      mqSegmentiOrizz2: matchMedia("(horizontal-viewport-segments: 2)").matches,
      tocco: state.touch ?? "tocca un punto vicino a un bordo",
      nativo: state.native ? `${state.native.machine ?? "?"} · ${state.native.os ?? state.native.error ?? ""}` : "in attesa",
      userAgent: navigator.userAgent,
    };
  }

  // ---------- esperimenti ----------

  function setCover(on) {
    let meta = document.querySelector('meta[name="viewport"]');
    if (on) {
      if (state.originalViewport === undefined) state.originalViewport = meta ? meta.content : null;
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "viewport";
        meta.content = "width=device-width, initial-scale=1";
        document.head.appendChild(meta);
      }
      if (!/viewport-fit\s*=/.test(meta.content)) meta.content += ", viewport-fit=cover";
      else meta.content = meta.content.replace(/viewport-fit\s*=\s*\w+/, "viewport-fit=cover");
    } else if (state.originalViewport !== undefined) {
      if (state.originalViewport === null) meta?.remove();
      else if (meta) meta.content = state.originalViewport;
      state.originalViewport = undefined;
    }
    state.cover = on;
    setTimeout(render, 350);
  }

  // ---------- interfaccia (Shadow DOM, isolata dal CSS del sito) ----------

  const host = document.createElement("div");
  host.id = "duolargo-diag-host";
  host.style.cssText =
    "all:initial!important;position:fixed!important;top:0!important;left:0!important;" +
    "width:0!important;height:0!important;z-index:2147483647!important;";
  const root = host.attachShadow({ mode: "closed" });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, system-ui, sans-serif; }
      .pill {
        position: fixed; top: calc(env(safe-area-inset-top, 0px) + 8px); left: 50%; transform: translateX(-50%);
        padding: 6px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.35);
        background: #1c4a8c; color: #fff; font-size: 13px; font-weight: 600; letter-spacing: .01em;
        box-shadow: 0 2px 10px rgba(0,0,0,.25); -webkit-tap-highlight-color: transparent;
      }
      .panel {
        position: fixed; top: calc(env(safe-area-inset-top, 0px) + 46px); left: 50%; transform: translateX(-50%);
        width: min(94vw, 360px); max-height: 72vh; overflow: auto; -webkit-overflow-scrolling: touch;
        padding: 12px; border-radius: 14px; background: rgba(22, 26, 34, .94); color: #eef1f6;
        font-size: 12px; line-height: 1.35; box-shadow: 0 8px 30px rgba(0,0,0,.35);
      }
      .panel[hidden], .pill[hidden] { display: none; }
      select, button {
        font-size: 13px; border-radius: 9px; border: 1px solid #3b4556; background: #263041; color: #eef1f6;
        padding: 7px 10px; -webkit-appearance: none; appearance: none;
      }
      select { width: 100%; margin-bottom: 8px; }
      .row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
      button[aria-pressed="true"] { background: #78aaeb; color: #10203a; border-color: #78aaeb; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 3px 0; vertical-align: top; border-top: 1px solid rgba(255,255,255,.08); }
      td:first-child { color: #9aa6b8; padding-right: 10px; white-space: nowrap; }
      td:last-child { font-variant-numeric: tabular-nums; word-break: break-word; }
      .note { color: #9aa6b8; margin-top: 8px; }
      .bar {
        position: fixed; top: 0; bottom: 0; width: 120px; pointer-events: none;
        display: flex; align-items: center; justify-content: center;
        color: #fff; font-size: 16px; font-weight: 700; writing-mode: vertical-rl;
      }
      .bar.sx { left: -120px; background: repeating-linear-gradient(45deg, #d93a3a 0 12px, #8f1d1d 12px 24px); }
      .bar.dx { left: 100%; background: repeating-linear-gradient(45deg, #2f6fe0 0 12px, #173c80 12px 24px); }
      .edge { position: fixed; top: 0; bottom: 0; width: 3px; background: #19c37d; pointer-events: none; }
      .edge.sx { left: 0; }
      .edge.dx { right: 0; }
      .bars[hidden] { display: none; }
    </style>
    <div class="bars" hidden>
      <div class="bar sx">SINISTRA FUORI</div>
      <div class="bar dx">DESTRA FUORI</div>
      <div class="edge sx"></div>
      <div class="edge dx"></div>
    </div>
    <button class="pill" type="button">Duo</button>
    <div class="panel" hidden>
      <select class="situazione"></select>
      <div class="row">
        <button type="button" data-act="bars" aria-pressed="false">Barre di prova</button>
        <button type="button" data-act="cover" aria-pressed="false">Prova cover</button>
        <button type="button" data-act="copy">Copia dati</button>
        <button type="button" data-act="close">Chiudi</button>
      </div>
      <table><tbody class="data"></tbody></table>
      <p class="note">Le barre rosse e blu sono disegnate fuori dalla pagina, a sinistra e a destra. Se in uno screenshot le vedi sotto i comandi di Safari, Safari disegna anche lì. Le linee verdi segnano i bordi della pagina.</p>
    </div>
  `;

  const $ = (sel) => root.querySelector(sel);
  const pill = $(".pill");
  const panel = $(".panel");
  const bars = $(".bars");
  const tbody = $(".data");
  const select = $(".situazione");

  for (const [value, label] of SITUAZIONI) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    select.appendChild(o);
  }

  function render() {
    pill.hidden = !state.enabled;
    panel.hidden = !(state.enabled && state.open);
    bars.hidden = !(state.enabled && state.bars);
    if (panel.hidden) return;
    const data = collect();
    tbody.textContent = "";
    for (const [k, v] of Object.entries(data)) {
      if (k === "userAgent") continue;
      const tr = document.createElement("tr");
      const a = document.createElement("td");
      const b = document.createElement("td");
      a.textContent = k;
      b.textContent = String(v);
      tr.append(a, b);
      tbody.appendChild(tr);
    }
    root.querySelector('[data-act="bars"]').setAttribute("aria-pressed", String(state.bars));
    root.querySelector('[data-act="cover"]').setAttribute("aria-pressed", String(state.cover));
  }

  let scheduled = false;
  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  }

  pill.addEventListener("click", () => {
    state.open = !state.open;
    render();
  });

  select.addEventListener("change", () => {
    state.situazione = select.value;
    render();
  });

  panel.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "close") state.open = false;
    if (act === "bars") state.bars = !state.bars;
    if (act === "cover") setCover(!state.cover);
    if (act === "copy") {
      const text = JSON.stringify(collect(), null, 1);
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copiato";
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        root.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        btn.textContent = "Copiato";
      }
      setTimeout(() => (btn.textContent = "Copia dati"), 1500);
    }
    render();
  });

  // ---------- eventi ----------

  window.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      if (!t) return;
      state.touch =
        `client ${r2(t.clientX)},${r2(t.clientY)} · screen ${r2(t.screenX)},${r2(t.screenY)} · page ${r2(t.pageX)},${r2(t.pageY)}`;
      scheduleRender();
    },
    { capture: true, passive: true }
  );

  window.addEventListener("resize", scheduleRender, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(render, 300));
  window.visualViewport?.addEventListener("resize", scheduleRender);

  // ---------- avvio ----------

  api.storage.local.get({ diagEnabled: true }).then((v) => {
    state.enabled = v.diagEnabled;
    render();
  });
  api.storage.onChanged.addListener((changes) => {
    if (changes.diagEnabled) {
      state.enabled = changes.diagEnabled.newValue;
      render();
    }
  });

  api.runtime
    .sendMessage({ type: "native-info" })
    .then((res) => {
      state.native = res ?? { error: "nessuna risposta" };
      render();
    })
    .catch((e) => {
      state.native = { error: String(e) };
      render();
    });

  (document.body ?? document.documentElement).appendChild(host);
  render();
})();
