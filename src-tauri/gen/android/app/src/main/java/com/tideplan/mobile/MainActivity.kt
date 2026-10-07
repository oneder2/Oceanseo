package com.tideplan.mobile

import android.os.Bundle
import android.content.res.Configuration
import androidx.activity.enableEdgeToEdge
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowCompat
import android.webkit.WebView
import android.view.ViewGroup
import kotlin.math.roundToInt

class MainActivity : TauriActivity() {
  private var contentWebView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    contentWebView = webView
    webView.settings.textZoom = (resources.configuration.fontScale * 100).roundToInt()
    // Keep content clear of camera cutouts, gesture bars and the soft keyboard.
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
      // WebView padding does not resize its CSS viewport. Use layout margins so
      // fixed navigation and the composer stay above system bars and the IME.
      val layout = view.layoutParams as? ViewGroup.MarginLayoutParams
      val bottom = maxOf(bars.bottom, keyboard.bottom)
      if (layout != null && (layout.leftMargin != bars.left || layout.topMargin != bars.top ||
          layout.rightMargin != bars.right || layout.bottomMargin != bottom)) {
        layout.setMargins(bars.left, bars.top, bars.right, bottom)
        view.layoutParams = layout
      }
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(webView)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        // Closing the IME must not also dismiss the user's editor or draft.
        if (ViewCompat.getRootWindowInsets(webView)?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
          WindowCompat.getInsetsController(window, webView).hide(WindowInsetsCompat.Type.ime())
          return
        }
        webView.evaluateJavascript("window.__tideplanBack?.() === true") { handled ->
          if (handled != "true") moveTaskToBack(true)
        }
      }
    })
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    contentWebView?.settings?.textZoom = (newConfig.fontScale * 100).roundToInt()
  }
}
