const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

const HINTS = {
  protetto: "Sfondi e foto arrivano al bordo; testo, link e pulsanti si fermano prima dei comandi di Safari.",
  tutto: "Tutta la pagina arriva al bordo, anche il testo.",
};

let tabId = null;
let site = null;

function showLayout(layout) {
  for (const b of document.querySelectorAll("[data-layout]")) {
    b.setAttribute("aria-pressed", String(b.dataset.layout === layout));
  }
  $("layoutHint").textContent = HINTS[layout];
}

async function refreshStatus() {
  if (tabId == null) return;
  try {
    const st = await api.tabs.sendMessage(tabId, { type: "status" });
    if (!st) throw new Error("nessuna risposta");
    site = st.site;
    $("site").textContent = st.site;
    $("siteOn").checked = st.enabled;
    $("status").textContent = st.active ? `Attivo: pagina larga ${st.W} pt, colonna ${st.strip} pt.` : `Non attivo: ${st.reason || "in attesa"}.`;
  } catch (e) {
    $("site").textContent = "pagina non raggiungibile";
    $("siteOn").disabled = true;
    $("status").textContent = "Ricarica la pagina e riapri questo menu.";
  }
}

async function init() {
  const v = await api.storage.local.get({ mode: "largo", layout: "protetto", disabledSites: [] });
  showLayout(v.layout);
  $("diag").checked = v.mode === "diag";

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  await refreshStatus();

  try {
    const r = await api.runtime.sendNativeMessage("application.id", { type: "device-info" });
    if (r?.machine) $("status").textContent += ` ${r.machine}.`;
  } catch {}
}

$("siteOn").addEventListener("change", async () => {
  if (!site) return;
  const { disabledSites } = await api.storage.local.get({ disabledSites: [] });
  const set = new Set(disabledSites);
  if ($("siteOn").checked) set.delete(site);
  else set.add(site);
  await api.storage.local.set({ disabledSites: [...set] });
  setTimeout(refreshStatus, 600);
});

for (const b of document.querySelectorAll("[data-layout]")) {
  b.addEventListener("click", async () => {
    await api.storage.local.set({ layout: b.dataset.layout });
    showLayout(b.dataset.layout);
  });
}

$("diag").addEventListener("change", async () => {
  await api.storage.local.set({ mode: $("diag").checked ? "diag" : "largo" });
  setTimeout(refreshStatus, 600);
});

init();
