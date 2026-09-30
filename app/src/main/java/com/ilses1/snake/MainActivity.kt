package com.ilses1.snake

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * 3D 贪吃蛇的安卓外壳。
 *
 * 只做四件事：全屏承载、离线资源映射、生命周期联动、返回键转发。
 * 游戏逻辑全部在 assets/index.html 里，与网页版共用同一份代码。
 *
 * 为什么不用 file:// 直接加载本地 html：
 * ES module 与 importmap 在 file:// 协议下会被 CORS 拦掉，three.js 根本 import 不进来。
 * 所以走 WebViewAssetLoader 把 assets 映射到 https://appassets.androidplatform.net/assets/，
 * 这是一个「看起来是 https」的同源地址，模块加载才成立。
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    private val pageUrl
        get() = "https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/index.html"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 玩游戏时别息屏
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // 刘海/挖孔屏：允许内容延伸到挖孔区域，避免出现黑边
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        goImmersive()

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
            // 页面本身已 overflow:hidden，这里再关掉滚动条与回弹，避免滑动时露出白边
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            isHapticFeedbackEnabled = false
            // 长按不要弹「复制/搜索」菜单
            setOnLongClickListener { true }

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true                 // localStorage 存档最高分/音效开关
                mediaPlaybackRequiresUserGesture = false // 程序化配乐无需用户手势即可出声
                allowFileAccess = false
                allowContentAccess = false
                cacheMode = WebSettings.LOAD_DEFAULT
                useWideViewPort = true
                loadWithOverviewMode = true
                setSupportZoom(false)                    // 双指缩放会干扰滑动操作
                builtInZoomControls = false
                displayZoomControls = false
                textZoom = 100
                // 本项目无网，禁用混合内容与不安全来源
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "[web] ${msg.message()} @${msg.lineNumber()}")
                    }
                    return true
                }
            }

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    val url = request.url
                    if (url.host == WebViewAssetLoader.DEFAULT_DOMAIN) return false
                    // 站外链接丢给系统浏览器，游戏内不做站内跳转
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, url))
                        true
                    } catch (e: Exception) {
                        Log.w(TAG, "no activity for $url", e)
                        true
                    }
                }
            }

            if (BuildConfig.DEBUG) {
                // 可用桌面 Chrome 打开 chrome://inspect 远程调试
                WebView.setWebContentsDebuggingEnabled(true)
            }

            loadUrl(pageUrl)
        }

        setContentView(webView)
    }

    /** 沉浸式全屏：隐藏状态栏与导航栏，用户从边缘上滑可临时唤出 */
    private fun goImmersive() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) goImmersive()
    }

    private fun evalJs(code: String, onResult: ((String) -> Unit)? = null) {
        if (!::webView.isInitialized) return
        webView.evaluateJavascript(code, onResult)
    }

    override fun onPause() {
        super.onPause()
        if (!::webView.isInitialized) return
        // 切后台自动暂停，回来时显示暂停面板；pause() 在非 playing 状态下是空操作
        evalJs("window.__snake3d && window.__snake3d.pause && window.__snake3d.pause()")
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
    }

    /**
     * 返回键：
     *  游戏中 → 暂停（防手滑退出），页面返回 true
     *  其他   → 交回系统，退出 App
     */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (!::webView.isInitialized) {
            @Suppress("DEPRECATION")
            super.onBackPressed()
            return
        }
        evalJs(HANDLE_BACK_JS) { raw ->
            if (raw.trim('"') == "true") {
                // 页面已消费这次返回
                return@evalJs
            }
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            // 停掉 rAF / AudioContext，避免泄漏
            webView.loadUrl("about:blank")
            webView.destroy()
        }
        super.onDestroy()
    }

    private companion object {
        const val TAG = "SnakeWebView"

        /**
         * evaluateJavascript 的结果是 JSON 编码的，字符串会带引号，
         * 所以取完后要 trim('"') 再比较。
         */
        const val HANDLE_BACK_JS =
            "(window.__snake3d && window.__snake3d.handleBack)" +
                " ? String(window.__snake3d.handleBack()) : 'false'"
    }
}
