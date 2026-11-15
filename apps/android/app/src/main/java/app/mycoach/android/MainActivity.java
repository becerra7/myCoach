package app.mycoach.android;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * La app es la web de myCoach dentro de una vista web: no replica nada. Sirve para entrar con tu cuenta
 * (la sesión se queda en el teléfono) y para que el widget pueda leer tu día con esa misma sesión.
 */
public class MainActivity extends Activity {
    private WebView web;
    private View aviso;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        FrameLayout raiz = new FrameLayout(this);
        raiz.setFitsSystemWindows(true);
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.paper));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                // myCoach se queda dentro; lo demás (Claude, Garmin Connect, mapas) se abre en su app o en el navegador.
                if (Uri.parse(BuildConfig.BASE_URL).getHost().equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* no hay quien lo abra */ }
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) aviso.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                CookieManager.getInstance().flush();
                HoyWidget.actualizarTodos(MainActivity.this);
            }
        });
        raiz.addView(web, new FrameLayout.LayoutParams(-1, -1));
        aviso = avisoSinRed();
        aviso.setVisibility(View.GONE);
        raiz.addView(aviso, new FrameLayout.LayoutParams(-1, -1));
        setContentView(raiz);
        if (estado != null) web.restoreState(estado); else web.loadUrl(BuildConfig.BASE_URL + "/");
    }

    /** Sin conexión: qué pasa y qué hacer, sin la página de error del navegador. */
    private View avisoSinRed() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setGravity(Gravity.CENTER);
        c.setBackgroundColor(getColor(R.color.paper));
        int p = (int) (24 * getResources().getDisplayMetrics().density);
        c.setPadding(p, p, p, p);
        TextView t = new TextView(this);
        t.setText(R.string.sin_red_t);
        t.setTextSize(22);
        t.setTextColor(getColor(R.color.ink));
        t.setGravity(Gravity.CENTER);
        TextView d = new TextView(this);
        d.setText(R.string.sin_red_s);
        d.setTextSize(16);
        d.setTextColor(getColor(R.color.ink2));
        d.setGravity(Gravity.CENTER);
        d.setPadding(0, p / 3, 0, p);
        Button b = new Button(this);
        b.setText(R.string.reintentar);
        b.setOnClickListener(v -> { aviso.setVisibility(View.GONE); web.loadUrl(BuildConfig.BASE_URL + "/"); });
        c.addView(t); c.addView(d); c.addView(b, new LinearLayout.LayoutParams(-2, -2));
        return c;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    protected void onPause() {
        super.onPause();
        // Al salir de la app (acabas de aplicar un cambio, de anotar cómo estás…) el widget se pone al día.
        CookieManager.getInstance().flush();
        HoyWidget.actualizarTodos(this);
    }

    @Override
    public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
