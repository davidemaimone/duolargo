// Fa da ponte tra content.js e la parte nativa (SafariWebExtensionHandler.swift).
const api = globalThis.browser ?? globalThis.chrome;

api.runtime.onMessage.addListener((message) => {
  if (message?.type === "native-info") {
    return api.runtime
      .sendNativeMessage("application.id", { type: "device-info" })
      .catch((error) => ({ error: String(error) }));
  }
  return undefined;
});
