const api = globalThis.browser ?? globalThis.chrome;
const checkbox = document.getElementById("enabled");

api.storage.local.get({ diagEnabled: true }).then((v) => {
  checkbox.checked = v.diagEnabled;
});
checkbox.addEventListener("change", () => {
  api.storage.local.set({ diagEnabled: checkbox.checked });
});

api.runtime
  .sendNativeMessage("application.id", { type: "device-info" })
  .then((r) => {
    document.getElementById("machine").textContent = r?.machine ?? r?.error ?? "?";
    document.getElementById("os").textContent = r?.os ?? "?";
  })
  .catch((e) => {
    document.getElementById("machine").textContent = "errore: " + e;
  });
