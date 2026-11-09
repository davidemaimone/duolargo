import SwiftUI

/// Schermata dell'app contenitore: istruzioni di attivazione e misure native.
/// Le misure della safe area servono come confronto con quelle lette da Safari:
/// metti questa app in Split View a sinistra e a destra e guarda dove compaiono i margini.
struct ContentView: View {
    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("DuoLargo")
                            .font(.largeTitle.weight(.bold))
                        Text("Versione 0.4")
                            .foregroundStyle(.secondary)
                    }

                    section("Attiva l'estensione") {
                        step("1", "Impostazioni › App › Safari › Estensioni › DuoLargo: accendi Consenti estensione e imposta Tutti i siti web su Consenti.")
                        step("2", "In Safari tocca l'icona a sinistra della barra degli indirizzi › Gestisci le estensioni e accendi DuoLargo.")
                        step("3", "Ricarica le pagine già aperte.")
                    }

                    section("Come si usa") {
                        Text("A iPhone chiuso le pagine si allargano da sole sotto i comandi di Safari. Il pulsante con le frecce nella colonna dei comandi riporta la pagina alla larghezza normale. Dal menu estensioni di Safari scegli il layout, spegni DuoLargo su un sito o attiva la modalità diagnostica.")
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    section("Questa finestra") {
                        row("Modello", DeviceInfo.machine)
                        row("Sistema", ProcessInfo.processInfo.operatingSystemVersionString)
                        row("Area utile", "\(Int(geo.size.width)) × \(Int(geo.size.height)) pt")
                        row("Margine sinistro", "\(Int(geo.safeAreaInsets.leading)) pt")
                        row("Margine destro", "\(Int(geo.safeAreaInsets.trailing)) pt")
                        row("Margine sopra / sotto", "\(Int(geo.safeAreaInsets.top)) / \(Int(geo.safeAreaInsets.bottom)) pt")
                    }
                }
                .padding(20)
                .frame(maxWidth: 560, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func step(_ n: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(n).font(.subheadline.weight(.bold)).foregroundStyle(.tint)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value).monospacedDigit().multilineTextAlignment(.trailing).textSelection(.enabled)
        }
        .font(.subheadline)
    }
}

enum DeviceInfo {
    static var machine: String {
        var info = utsname()
        uname(&info)
        let bytes = Mirror(reflecting: info.machine).children.compactMap { child -> UInt8? in
            guard let value = child.value as? Int8, value != 0 else { return nil }
            return UInt8(bitPattern: value)
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}
