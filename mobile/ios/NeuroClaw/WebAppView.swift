import SwiftUI
import WebKit

/// The shared NeuroClaw interface (the home chat at "/", Settings at "/settings", and the rest), full screen, served by the PC, so the
/// phone shows and does exactly what the browser does. WKWebView is Apple's built-in web view; nothing third-party.
/// The page handles its own login (session cookie). A server that cannot be reached shows a page that says so, not a blank screen.
struct WebAppView: UIViewRepresentable {
    let urlString: String
    var path: String = "/"

    /// "192.168.1.20:7861" gets its http://, spaces and a trailing slash go. Without this a missing scheme made the page fail silently.
    static func normalized(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return "" }
        if !s.contains("://") { s = "http://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }

    private var base: String { Self.normalized(urlString) }

    func makeCoordinator() -> Coordinator { Coordinator(base: base) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        if let url = URL(string: base + path) { web.load(URLRequest(url: url)) }
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let base: String
        init(base: String) { self.base = base }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showError(webView, error) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showError(webView, error) }

        private func showError(_ web: WKWebView, _ error: Error) {
            let ns = error as NSError
            if ns.code == NSURLErrorCancelled { return }
            let reason = ns.localizedDescription.replacingOccurrences(of: "<", with: "&lt;")
            let html = "<meta name='viewport' content='width=device-width,initial-scale=1'><body style='margin:0;padding:24px;background:#110c0e;color:#f8ede9;font-family:-apple-system,sans-serif'>"
                + "<h2>Can't reach NeuroClaw</h2><p>\(base) did not answer (\(reason)).</p>"
                + "<p>Check that NeuroClaw is running on your PC, that this phone is on the same network, and that the address in Settings is right. It looks like http://192.168.1.20:7861.</p>"
                + "<p><a style='color:#ffc4b4' href='\(base)/'>Try again</a></p></body>"
            web.loadHTMLString(html, baseURL: nil)
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = action.request.url, action.navigationType == .linkActivated,
               !url.absoluteString.hasPrefix(base) {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }
    }
}
