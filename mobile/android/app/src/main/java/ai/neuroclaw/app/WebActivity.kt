package ai.neuroclaw.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

/**
 * The shared NeuroClaw interface (the home chat at "/", Settings at "/settings", and the rest), full screen, served by
 * the PC, so the phone shows and does exactly what the browser does. Uses Android's built-in WebView; nothing third-party.
 * The page handles its own login (session cookie), so no password is passed in.
 * A server that cannot be reached shows a page that says so and offers to try again, instead of a blank screen.
 */
class WebActivity : Activity() {
    private lateinit var web: WebView
    private var chooser: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val base = Shared.brain(this).settings.serverUrl
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) view.loadDataWithBaseURL(null, errorPage(base, error.description.toString()), "text/html", "utf-8", null)
                }

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (base.isNotEmpty() && request.url.toString().startsWith(base)) return false
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                // Camera and microphone only for the NeuroClaw server the person entered, and Android still asks for its own permission.
                override fun onPermissionRequest(request: PermissionRequest) {
                    if (base.isNotEmpty() && request.origin.toString().startsWith(base)) request.grant(request.resources) else request.deny()
                }
                override fun onShowFileChooser(
                    view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams,
                ): Boolean {
                    chooser?.onReceiveValue(null)
                    chooser = callback
                    startActivityForResult(params.createIntent(), REQ_FILE)
                    return true
                }
            }
        }
        setContentView(web)
        val path = intent.getStringExtra(EXTRA_PATH)?.takeIf { it.startsWith("/") } ?: "/"
        when {
            base.isEmpty() -> {
                Toast.makeText(this, "Enter your PC address on the main screen and tap Save first.", Toast.LENGTH_LONG).show()
                finish()
            }
            savedInstanceState != null && web.restoreState(savedInstanceState) != null -> Unit
            else -> web.loadUrl("$base$path")
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            chooser?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            chooser = null
        } else super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) { web.goBack(); return true }
        return super.onKeyDown(keyCode, event)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    private fun errorPage(base: String, reason: String): String {
        val where = android.text.TextUtils.htmlEncode(base)
        val why = android.text.TextUtils.htmlEncode(reason)
        return "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
            "<body style='margin:0;padding:24px;background:#110c0e;color:#f8ede9;font-family:sans-serif'>" +
            "<h2>Can't reach NeuroClaw</h2><p>$where did not answer ($why).</p>" +
            "<p>Check that NeuroClaw is running on your PC, that this phone is on the same network, and that the address on the main screen is right. It looks like http://192.168.1.20:7861.</p>" +
            "<p><a style='color:#ffc4b4' href='$where/'>Try again</a></p></body>"
    }

    companion object {
        const val EXTRA_PATH = "path"
        private const val REQ_FILE = 71
    }
}
