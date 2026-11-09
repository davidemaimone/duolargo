// Simulatore dello schermo esterno di iPhone Duo (Chromium headless, emulazione mobile).
// Riproduce: pagina normale a 382 pt + colonna di 84 pt, e pagina allargata a 466 pt con DuoLargo.
// NON riproduce i comportamenti propri di Safari (come consegna i tocchi, quando rimpicciolisce
// la pagina, come taglia gli elementi fissi): quelli vanno verificati sul telefono.
//
// Uso: node tools/sim/run.mjs [cartella-uscita]
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import url from "url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "/opt/npm-tools/node_modules/playwright");

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.resolve(process.argv[2] || path.join(here, "out"));
fs.mkdirSync(out, { recursive: true });

const W = 466, STRIP = 84, H = 678, LIMIT = W - STRIP;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1";
const script = fs.readFileSync(path.join(root, "userscript/duolargo.user.js"), "utf8");
const fixtures = fs.readdirSync(path.join(here, "fixtures")).filter((f) => f.endsWith(".html"));

const CHECK = ({ W, LIMIT }) => {
  const INTER = 'a[href],button,input,select,textarea,label,summary,[role="button"]';
  const desc = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.className && typeof el.className === "string") s += "." + el.className.trim().split(/\s+/).join(".");
    const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
    return t ? `${s} «${t}»` : s;
  };
  const inSideScroller = (el) => {
    for (let e = el.parentElement; e; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX;
      if ((o === "auto" || o === "scroll") && e.scrollWidth > e.clientWidth + 2) return true;
    }
    return false;
  };
  const clipped = (el, r) => {
    // il testo che esce da un contenitore con overflow nascosto non si vede: conta solo la parte visibile
    let right = r.right;
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX;
      if (o === "hidden" || o === "clip") right = Math.min(right, e.getBoundingClientRect().right);
      const m = /inset\(\s*\S+\s+([\d.]+)px/.exec(getComputedStyle(e).clipPath || "");
      if (m) right = Math.min(right, e.getBoundingClientRect().right - parseFloat(m[1]));
    }
    return right;
  };
  const res = {
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.querySelector('meta[name="viewport"]')?.content,
    attivo: document.documentElement.getAttribute("data-duolargo"),
    sottoLaColonna: [],
    troppoStretti: [],
    contenitoriModificati: 0,
  };
  for (const el of document.body.getElementsByTagName("*")) {
    if (el.id === "duolargo-host") continue;
    if (el.style && el.style.getPropertyValue("padding-right") && el.style.getPropertyPriority("padding-right") === "important") res.contenitoriModificati++;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim().length > 1);
    const inter = el.matches(INTER);
    if (!direct && !inter) continue;
    if (inSideScroller(el)) continue;
    // per il testo conta dove finiscono davvero le lettere, non il riquadro dell'elemento
    let textRight = r.right;
    if (direct && !inter) {
      textRight = -Infinity;
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const rr of range.getClientRects()) if (rr.width) textRight = Math.max(textRight, rr.right);
      }
      if (textRight === -Infinity) continue;
    }
    const right = clipped(el, { right: textRight });
    if (right > LIMIT + 1 && r.left < W) res.sottoLaColonna.push(`${desc(el)} [${Math.round(r.left)}–${Math.round(right)}]`);
    if (direct && !inter && r.width < 140 && (el.textContent || "").trim().length > 40) res.troppoStretti.push(`${desc(el)} [larghezza ${Math.round(r.width)}]`);
  }
  return res;
};

const browser = await chromium.launch();
const results = {};
for (const f of fixtures) {
  const name = f.replace(/\.html$/, "");
  const fileUrl = url.pathToFileURL(path.join(here, "fixtures", f)).href;
  const opts = { deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA };

  // 1) Safari normale: la pagina riceve 382 pt
  const c1 = await browser.newContext({ ...opts, viewport: { width: LIMIT, height: H } });
  const p1 = await c1.newPage();
  await p1.goto(fileUrl);
  await p1.waitForTimeout(300);
  await p1.screenshot({ path: path.join(out, `${name}-prima.png`) });
  const bg = await p1.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await c1.close();

  // 2) DuoLargo attivo: pagina a 466 pt, colonna di 84 pt a destra
  const c2 = await browser.newContext({ ...opts, viewport: { width: W, height: H } });
  await c2.addInitScript(`window.__DUOLARGO_TEST__ = { W: ${W}, strip: ${STRIP} };`);
  const p2 = await c2.newPage();
  const errors = [];
  p2.on("pageerror", (e) => errors.push(String(e)));
  await p2.goto(fileUrl);
  await p2.addScriptTag({ content: script });
  await p2.waitForTimeout(1800);
  await p2.screenshot({ path: path.join(out, `${name}-dopo.png`) });
  const check = await p2.evaluate(CHECK, { W, LIMIT });

  // 3) il pulsante: un tocco deve riportare la pagina normale, un secondo tocco riallargarla
  const btnBox = await p2.evaluate(() => {
    const host = document.getElementById("duolargo-host");
    return host ? true : false;
  });
  let tocchi = "pulsante assente";
  if (btnBox) {
    const tapAt = async () => {
      // il pulsante è nel Shadow DOM chiuso: lo tocchiamo dove dovrebbe stare
      const pos = await p2.evaluate(({ W, STRIP }) => ({ x: W - Math.round(STRIP * 0.58 - 22) - 22, y: Math.round(visualViewport.height * 0.6) }), { W, STRIP });
      await p2.touchscreen.tap(pos.x, pos.y);
      await p2.waitForTimeout(500);
      return p2.evaluate(({ LIMIT }) => {
        // in modalità normale il contenuto (non fisso) deve restare entro 382 pt
        let maxRight = 0;
        for (const el of document.body.getElementsByTagName("*")) {
          if (el.id === "duolargo-host") continue;
          let skip = false;
          for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
            const c = getComputedStyle(e);
            if (c.position === "fixed" || (e !== el && c.overflowX !== "visible")) { skip = true; break; }
          }
          if (skip) continue;
          const r = el.getBoundingClientRect();
          if (r.width && r.height) maxRight = Math.max(maxRight, r.right);
        }
        return `${document.documentElement.dataset.duolargoState} (contenuto fino a ${Math.round(maxRight)} pt)`;
      }, { LIMIT });
    };
    const v1 = await tapAt();
    await p2.screenshot({ path: path.join(out, `${name}-normale.png`) });
    const v2 = await tapAt();
    tocchi = { dopoPrimoTocco: v1, dopoSecondoTocco: v2 };
  }
  await c2.close();
  results[name] = { ...check, errori: errors, tocchi, sfondo: bg };
}
await browser.close();
fs.writeFileSync(path.join(out, "risultati.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
