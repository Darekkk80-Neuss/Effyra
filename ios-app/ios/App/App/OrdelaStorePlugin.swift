import Foundation
import Capacitor
import StoreKit

/*
 Ordela – Kaeufe ueber Apple StoreKit 2 (iOS 15+).

 Kleine eigene Bruecke statt Fremd-Plugin: keine Drittfirma, keine Gebuehren,
 keine zusaetzlichen Daten an Dritte. In JavaScript erreichbar als
 window.Capacitor.Plugins.OrdelaStore (siehe index.dev.html, "Kaeufe in der iOS-App").

   products({ ids })                 -> { products: [{ id, displayPrice, title }] }
   purchase({ id, appAccountToken? }) -> { status: purchased|cancelled|pending|unverified, transaction? }
   currentEntitlements()             -> { transactions: [...] }   gekaufte Einmalkaeufe (Plus)
   unfinished()                      -> { transactions: [...] }   noch nicht abgeschlossene Kaeufe
   finish({ id })                    -> {}                        Transaktion abschliessen
   sync()                            -> {}                        "Kauf wiederherstellen" (fragt ggf. nach der Apple-ID)
   Ereignis "transaction"            -> { transaction }           z. B. "Kaufen anfragen" spaeter genehmigt

 StoreKit prueft die Signatur jeder Transaktion auf dem Geraet; weitergegeben
 werden nur verifizierte. KI-Pakete prueft der Worker zusaetzlich bei Apple.
*/
@objc(OrdelaStorePlugin)
public class OrdelaStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OrdelaStorePlugin"
    public let jsName = "OrdelaStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentEntitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unfinished", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise)
    ]

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        // Kaeufe, die ausserhalb von purchase() ankommen (Genehmigung durch Eltern,
        // Kauf auf einem anderen Geraet, Erstattung). Sie bleiben offen, bis die
        // App sie verarbeitet und finish() ruft.
        updatesTask = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard case .verified(let t) = result else { continue }
                self?.notifyListeners("transaction", data: ["transaction": OrdelaStorePlugin.json(t, jws: result.jwsRepresentation)])
            }
        }
    }

    deinit { updatesTask?.cancel() }

    static func json(_ t: Transaction, jws: String) -> [String: Any] {
        return [
            "id": String(t.id),
            "originalId": String(t.originalID),
            "productId": t.productID,
            "purchaseDate": t.purchaseDate.timeIntervalSince1970 * 1000,
            "revoked": t.revocationDate != nil,
            "jws": jws
        ]
    }

    @objc func products(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [String]) ?? []
        Task {
            do {
                let list = try await Product.products(for: ids)
                call.resolve(["products": list.map { ["id": $0.id, "displayPrice": $0.displayPrice, "title": $0.displayName] }])
            } catch {
                call.reject(error.localizedDescription, "products_failed")
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("id fehlt", "bad_request"); return }
        let token = call.getString("appAccountToken").flatMap { UUID(uuidString: $0) }
        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else {
                    call.reject("Produkt nicht gefunden: " + id, "not_found"); return
                }
                var options: Set<Product.PurchaseOption> = []
                if let token = token { options.insert(.appAccountToken(token)) }
                let result = try await product.purchase(options: options)
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let t):
                        call.resolve(["status": "purchased", "transaction": OrdelaStorePlugin.json(t, jws: verification.jwsRepresentation)])
                    case .unverified:
                        call.resolve(["status": "unverified"])
                    }
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                case .pending:
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.resolve(["status": "unknown"])
                }
            } catch {
                call.reject(error.localizedDescription, "purchase_failed")
            }
        }
    }

    @objc func currentEntitlements(_ call: CAPPluginCall) {
        Task {
            var out: [[String: Any]] = []
            for await r in Transaction.currentEntitlements {
                if case .verified(let t) = r, t.revocationDate == nil { out.append(OrdelaStorePlugin.json(t, jws: r.jwsRepresentation)) }
            }
            call.resolve(["transactions": out])
        }
    }

    @objc func unfinished(_ call: CAPPluginCall) {
        Task {
            var out: [[String: Any]] = []
            for await r in Transaction.unfinished {
                if case .verified(let t) = r { out.append(OrdelaStorePlugin.json(t, jws: r.jwsRepresentation)) }
            }
            call.resolve(["transactions": out])
        }
    }

    @objc func finish(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("id fehlt", "bad_request"); return }
        Task {
            for await r in Transaction.unfinished {
                if case .verified(let t) = r, String(t.id) == id { await t.finish() }
            }
            call.resolve()
        }
    }

    @objc func sync(_ call: CAPPluginCall) {
        Task {
            do { try await AppStore.sync(); call.resolve() } catch { call.reject(error.localizedDescription, "sync_failed") }
        }
    }
}

/* Haupt-Ansicht der App: Capacitor-WebView plus das eigene Kauf-Modul. */
class OrdelaViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(OrdelaStorePlugin())
    }
}
