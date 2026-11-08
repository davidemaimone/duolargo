import Foundation
import SafariServices

/// Riceve i messaggi da background.js / popup.js (browser.runtime.sendNativeMessage).
/// Gira in un processo separato da Safari: non conosce la posizione della finestra,
/// ma sa su quale modello di iPhone sta girando.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any]
        let type = message?["type"] as? String ?? "?"

        var payload: [String: Any] = ["type": type]
        switch type {
        case "device-info":
            payload["machine"] = Self.machineIdentifier()
            payload["os"] = ProcessInfo.processInfo.operatingSystemVersionString
        default:
            payload["error"] = "messaggio sconosciuto"
        }

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    /// Identificatore hardware, es. "iPhone18,3".
    static func machineIdentifier() -> String {
        var info = utsname()
        uname(&info)
        let bytes = Mirror(reflecting: info.machine).children.compactMap { child -> UInt8? in
            guard let value = child.value as? Int8, value != 0 else { return nil }
            return UInt8(bitPattern: value)
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}
