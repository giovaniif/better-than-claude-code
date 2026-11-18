import SwiftUI
import WebKit
import UserNotifications

struct HostWebView: UIViewRepresentable {
    let host: URL
    @ObservedObject var connection: Connection
    let active: Bool

    func makeCoordinator() -> Coordinator { Coordinator(host: host, connection: connection) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let content = config.userContentController
        let script = try! String(contentsOf: Bundle.main.url(forResource: "bridge", withExtension: "js")!)
        content.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(context.coordinator, name: "switchyard")
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        UNUserNotificationCenter.current().delegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.bounces = false
        context.coordinator.web = web
        context.coordinator.speech.emit = { [weak web] event in
            guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
            web?.evaluateJavaScript("window.SwitchyardMobile?.receive(\(json))", completionHandler: nil)
        }
        web.load(URLRequest(url: host))
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        guard context.coordinator.active != active else { return }
        context.coordinator.active = active
        if !active { context.coordinator.speech.stopAll() }
        web.evaluateJavaScript(active ? "window.dispatchEvent(new Event('yard:resume'))" : "window.dispatchEvent(new Event('yard:pause'))", completionHandler: nil)
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        coordinator.speech.stopAll()
        web.configuration.userContentController.removeScriptMessageHandler(forName: "switchyard")
        web.stopLoading()
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UNUserNotificationCenterDelegate {
        let host: URL
        let connection: Connection
        let speech = SpeechBridge()
        weak var web: WKWebView?
        var active = true

        init(host: URL, connection: Connection) { self.host = host; self.connection = connection }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url,
                  HostAddress.sameOrigin(host, url), let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
            if op == "connected" { connection.connected(); return }
            if op == "notification-permission", let id = body["id"] as? Int {
                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, _ in
                    DispatchQueue.main.async { self?.speech.emit?(["id": id, "type": "notification-permission", "granted": granted]) }
                }
                return
            }
            if op == "notify", let note = body["note"] as? [String: Any], let title = note["title"] as? String {
                let content = UNMutableNotificationContent()
                content.title = String(title.prefix(200))
                content.body = String((note["body"] as? String ?? "").prefix(1000))
                content.sound = .default
                content.userInfo = ["host": host.absoluteString, "sessionId": note["sessionId"] as? String ?? ""]
                let id = "\(host.absoluteString):\(note["sessionId"] as? String ?? UUID().uuidString)"
                UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
                return
            }
            guard active else { return }
            speech.handle(body)
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            // Sandboxed MCP frames can load their own resources but get no native bridge.
            if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
            if HostAddress.sameOrigin(host, url), action.targetFrame != nil { decisionHandler(.allow); return }
            decisionHandler(.cancel)
            if ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? ""), action.navigationType == .linkActivated {
                UIApplication.shared.open(url)
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { connection.failed(error.localizedDescription) }
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            speech.stopAll()
            webView.reload()
        }

        func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
            completionHandler([.banner, .sound])
        }

        func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
            let info = response.notification.request.content.userInfo
            if info["host"] as? String == host.absoluteString, let id = info["sessionId"] as? String, !id.isEmpty {
                DispatchQueue.main.async { [weak self] in self?.speech.emit?(["type": "notification-open", "note": ["title": "", "sessionId": id]]) }
            }
            completionHandler()
        }
    }
}
