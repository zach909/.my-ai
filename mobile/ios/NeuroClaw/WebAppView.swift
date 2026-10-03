import SwiftUI
import WebKit

/// The PC's own web dashboard (/app: chat, chat groups, store, builder and the rest), full screen, so the phone shows and does exactly
/// what the browser does. WKWebView is Apple's built-in web view; nothing third-party.
/// The page handles its own login (session cookie).
struct WebAppView: UIViewRepresentable {
    let urlString: String

    private var base: String { urlString.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "/")) }

    func makeCoordinator() -> Coordinator { Coordinator(base: base) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        if let url = URL(string: base + "/app") { web.load(URLRequest(url: url)) }
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let base: String
        init(base: String) { self.base = base }
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
