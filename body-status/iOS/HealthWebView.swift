import SwiftUI
import WebKit
import UIKit

@MainActor
struct NativeDashboardView: View {
    @EnvironmentObject private var model: HealthDashboard
    @Environment(\.scenePhase) private var scenePhase
    @State private var failure: String?
    @State private var reloadID = UUID()

    var body: some View {
        ZStack {
            HealthWebView(model: model, onFailure: { failure = $0 }).id(reloadID)
            if let failure {
                VStack(spacing: 20) {
                    Text("知息暂时未能打开").font(.headline)
                    Text(failure).multilineTextAlignment(.center)
                    Button("重新打开") { self.failure = nil; reloadID = UUID() }
                }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity).background(.background)
            }
            if scenePhase != .active {
                VStack(spacing: 12) {
                    Image(systemName: "leaf").font(.largeTitle)
                    Text("知息").font(.headline)
                    Text("回到 App 后查看身体记录").font(.subheadline)
                }.frame(maxWidth: .infinity, maxHeight: .infinity).background(.background)
            }
        }
    }
}

@MainActor
private struct HealthWebView: UIViewRepresentable {
    @ObservedObject var model: HealthDashboard
    let onFailure: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(model: model, onFailure: onFailure) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(BundledHealthAssets(), forURLScheme: "zhixi")
        configuration.userContentController.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: "zhixiHealth")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.isScrollEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.load(URLRequest(url: URL(string: "zhixi://app/index.html")!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard !model.isLoading, context.coordinator.lastSentAt != model.lastLoadedAt else { return }
        context.coordinator.lastSentAt = model.lastLoadedAt
        webView.evaluateJavaScript("window.dispatchEvent(new Event('zhixi-health-change'))", completionHandler: nil)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "zhixiHealth", contentWorld: .page)
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.stopLoading()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
        private let model: HealthDashboard
        private let onFailure: (String) -> Void
        var lastSentAt: Date?
        private var connecting = false

        init(model: HealthDashboard, onFailure: @escaping (String) -> Void) {
            self.model = model
            self.onFailure = onFailure
        }

        private func trustedPage(_ url: URL?) -> Bool {
            guard let url else { return false }
            return url.scheme == "zhixi" && url.host == "app" && url.path == "/index.html"
                && url.user == nil && url.password == nil && url.port == nil && url.query == nil
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
            decisionHandler(navigationAction.targetFrame?.isMainFrame == true && trustedPage(navigationAction.request.url) ? .allow : .cancel)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                                   replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
            guard message.frameInfo.isMainFrame, trustedPage(message.frameInfo.request.url), trustedPage(message.webView?.url),
                  message.frameInfo.securityOrigin.protocol == "zhixi", message.frameInfo.securityOrigin.host == "app",
                  let body = message.body as? [String: Any], body["version"] as? Int == 1,
                  let action = body["action"] as? String else {
                replyHandler(nil, "仅允许知息本机界面访问健康数据。")
                return
            }
            guard UIApplication.shared.applicationState == .active else {
                replyHandler(nil, "回到 App 后重试。")
                return
            }
            switch action {
            case "status": replyHandler(model.webSnapshot(), nil)
            case "connect", "refresh":
                guard !connecting else { replyHandler(nil, "正在处理健康授权，请稍候。"); return }
                connecting = action == "connect"
                Task { @MainActor in
                    if action == "connect" { await model.connect() }
                    else { await model.refresh() }
                    connecting = false
                    replyHandler(model.webSnapshot(), nil)
                }
            case "settings":
                guard let url = URL(string: UIApplication.openSettingsURLString) else {
                    replyHandler(nil, "系统设置入口不可用。"); return
                }
                UIApplication.shared.open(url, options: [:]) { opened in
                    replyHandler(opened ? ["opened": true] : nil, opened ? nil : "无法打开系统设置。")
                }
            case "export":
                guard let json = body["json"] as? String, let webView = message.webView else {
                    replyHandler(nil, "备份内容不完整。"); return
                }
                share(json, from: webView, replyHandler: replyHandler)
            default: replyHandler(nil, "不支持的操作。")
            }
        }

        private func presenter(for webView: WKWebView) -> UIViewController? {
            var controller = webView.window?.rootViewController
            while let presented = controller?.presentedViewController { controller = presented }
            return controller
        }

        private func share(_ json: String, from webView: WKWebView, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
            guard json.utf8.count <= 100_000_000, let data = json.data(using: .utf8),
                  let backup = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  backup["schemaVersion"] as? Int == 1, let records = backup["records"] as? [Any], records.count <= 250_000,
                  let journal = backup["journal"] as? [Any], journal.count <= 10_000,
                  let presenter = presenter(for: webView), presenter.presentedViewController == nil else {
                replyHandler(nil, "备份格式或大小不支持，或当前无法打开分享。"); return
            }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ZhixiExport-\(UUID().uuidString)", isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                    attributes: [.protectionKey: FileProtectionType.complete])
                let file = directory.appendingPathComponent("知息备份.json")
                try data.write(to: file, options: [.atomic, .completeFileProtection])
                let activity = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                activity.popoverPresentationController?.sourceView = webView
                activity.popoverPresentationController?.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
                activity.completionWithItemsHandler = { _, completed, _, error in
                    Task { @MainActor in
                        try? FileManager.default.removeItem(at: directory)
                        replyHandler(error == nil ? ["shared": completed] : nil, error?.localizedDescription)
                    }
                }
                presenter.present(activity, animated: true)
            } catch {
                try? FileManager.default.removeItem(at: directory)
                replyHandler(nil, "备份未能生成：\(error.localizedDescription)")
            }
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
            guard frame.isMainFrame, trustedPage(frame.request.url), let presenter = presenter(for: webView),
                  UIApplication.shared.applicationState == .active else { completionHandler(false); return }
            let alert = UIAlertController(title: "知息", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "确认", style: .destructive) { _ in completionHandler(true) })
            presenter.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            onFailure("本机界面加载失败，可重新打开。\(error.localizedDescription)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            onFailure("本机界面加载失败，可重新打开。\(error.localizedDescription)")
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            onFailure("界面进程已退出。已保存的日常记录仍保留，重新打开后再读取健康数据。")
        }
    }
}

private final class BundledHealthAssets: NSObject, WKURLSchemeHandler {
    // Xcode 将白名单资源平铺复制进 App；映射保留 Web 的原始相对路径。
    static let files: [String: String] = [
        "/index.html": "text/html; charset=utf-8",
        "/styles.css": "text/css; charset=utf-8",
        "/assets/endfield.css": "text/css; charset=utf-8",
        "/assets/fonts/Saira.ttf": "font/ttf",
        "/app.mjs": "text/javascript", "/views.mjs": "text/javascript",
        "/core.mjs": "text/javascript", "/model.mjs": "text/javascript",
        "/native.mjs": "text/javascript", "/demo.mjs": "text/javascript",
        "/storage.mjs": "text/javascript", "/importer.mjs": "text/javascript",
        "/import-worker.mjs": "text/javascript", "/icon.svg": "image/svg+xml",
        "/manifest.webmanifest": "application/manifest+json"
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.scheme == "zhixi", url.host == "app",
              url.port == nil, url.user == nil, url.password == nil, url.query == nil,
              urlSchemeTask.request.httpMethod == "GET", let mime = Self.files[url.path],
              let resource = Bundle.main.resourceURL?.appendingPathComponent(url.lastPathComponent),
              let data = try? Data(contentsOf: resource) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; worker-src 'self'; connect-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": mime, "Content-Length": String(data.count), "Content-Security-Policy": csp,
            "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"
        ]) else { urlSchemeTask.didFailWithError(URLError(.badServerResponse)); return }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
