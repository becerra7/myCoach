package app.mycoach.android;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.webkit.CookieManager;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * El widget de Hoy: qué toca y por qué, sin abrir la app.
 * No calcula nada: pide coach_hoy a tu myCoach (lo mismo que la pantalla de Hoy) con la sesión que dejó la app,
 * y lo dice igual que la web. Si no hay red, enseña lo último que leyó y de cuándo es.
 */
public class HoyWidget extends AppWidgetProvider {
    private static final String PREFS = "hoy", K_JSON = "json", K_HORA = "hora";

    public static void actualizarTodos(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, HoyWidget.class));
        if (ids.length == 0) return;
        Intent i = new Intent(ctx, HoyWidget.class).setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        ctx.sendBroadcast(i);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        final PendingResult pr = goAsync();
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            try { pintar(app, mgr, ids, leer(app)); } finally { pr.finish(); }
        }).start();
    }

    /** Lo que se enseña: estado (0 sin estado, 1 bien, 2 suave, 3 recuperar), título, subtítulo y pie. */
    static final class Vista { int estado; String etiqueta = "", titulo = "", sub = "", pie = ""; }

    private static Vista leer(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String cookie = null;
        try { cookie = CookieManager.getInstance().getCookie(BuildConfig.BASE_URL); } catch (Exception e) { /* sin vista web todavía */ }
        if (cookie == null || !cookie.contains("mc_s=")) return fija(ctx, R.string.w_entrar_t, R.string.w_entrar_s);
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(BuildConfig.BASE_URL + "/api/mcp").openConnection();
            c.setConnectTimeout(8000); c.setReadTimeout(20000);
            c.setRequestMethod("POST"); c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Cookie", cookie);
            try (OutputStream o = c.getOutputStream()) { o.write("{\"tool\":\"coach_hoy\",\"input\":{}}".getBytes(StandardCharsets.UTF_8)); }
            int codigo = c.getResponseCode();
            if (codigo == 401) return fija(ctx, R.string.w_entrar_t, R.string.w_entrar_s);
            if (codigo != 200) throw new Exception("HTTP " + codigo);
            String cuerpo = todo(c.getInputStream());
            JSONObject p = new JSONObject(cuerpo).optJSONObject("payload");
            if (p == null || p.optJSONObject("semaforo") == null) throw new Exception("sin semáforo");
            String hora = new SimpleDateFormat("HH:mm", Locale.forLanguageTag("es-ES")).format(new Date());
            sp.edit().putString(K_JSON, p.toString()).putString(K_HORA, hora).apply();
            return deCoach(p, "");
        } catch (Exception e) {
            // Sin red o con el servidor caído: lo último que se leyó, diciendo de cuándo es.
            String guardado = sp.getString(K_JSON, null);
            if (guardado != null) try {
                JSONObject p = new JSONObject(guardado);
                String hoy = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
                if (hoy.equals(p.optString("fecha"))) return deCoach(p, "Sin conexión · leído a las " + sp.getString(K_HORA, "—"));
            } catch (Exception x) { /* guardado ilegible: se trata como si no hubiera */ }
            return fija(ctx, R.string.w_sin_t, R.string.w_sin_s);
        }
    }

    private static Vista fija(Context ctx, int t, int s) { Vista v = new Vista(); v.titulo = ctx.getString(t); v.sub = ctx.getString(s); return v; }

    /** La frase, con las mismas piezas que da el motor y el mismo orden que la pantalla de Hoy de la web. */
    static Vista deCoach(JSONObject p, String pie) {
        Vista v = new Vista(); v.pie = pie;
        JSONObject sem = p.optJSONObject("semaforo");
        String color = sem.optString("color", "verde");
        v.estado = "rojo".equals(color) ? 3 : "ambar".equals(color) ? 2 : 1;
        v.etiqueta = v.estado == 3 ? "✕  Toca recuperar" : v.estado == 2 ? "!  Mejor suave" : "✓  Vas bien";
        JSONArray motivos = sem.optJSONArray(v.estado == 1 ? "positivos" : "razones");
        StringBuilder porque = new StringBuilder();
        for (int i = 0; motivos != null && i < Math.min(2, motivos.length()); i++) porque.append(i == 0 ? "" : " y ").append(motivos.optString(i));
        v.sub = porque.length() > 0 ? mayus(porque.toString()) + "." : "";
        JSONObject prop = p.optJSONObject("propuesta"), ses = p.optJSONObject("sesion_prevista");
        JSONArray hecho = p.optJSONArray("ya_entrenado_hoy");
        if (hecho != null && hecho.length() > 0) { v.estado = 1; v.etiqueta = "✓  Hecho"; v.titulo = "Ya has entrenado hoy."; v.sub = "Ahora toca recuperar."; }
        else if (prop != null && prop.optString("texto").length() > 0) v.titulo = prop.optString("texto");
        else if (ses == null) v.titulo = "Hoy tienes el día libre.";
        else if ("descanso".equals(ses.optString("t"))) v.titulo = "Hoy toca descanso.";
        else {
            String d = ses.optString("d", "entreno").split(",")[0].trim();
            v.titulo = "Hoy toca " + (d.isEmpty() ? "entreno" : d.substring(0, 1).toLowerCase(Locale.ROOT) + d.substring(1)) + ".";
        }
        return v;
    }

    private static String mayus(String t) { return t.isEmpty() ? t : t.substring(0, 1).toUpperCase(Locale.ROOT) + t.substring(1); }

    private static String todo(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[8192]; int n;
        while ((n = in.read(buf)) > 0) { b.write(buf, 0, n); if (b.size() > 2_000_000) break; }
        return b.toString("UTF-8");
    }

    private static void pintar(Context ctx, AppWidgetManager mgr, int[] ids, Vista v) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_hoy);
        String fecha = mayus(new SimpleDateFormat("EEEE d", Locale.forLanguageTag("es-ES")).format(new Date()));
        rv.setTextViewText(R.id.w_fecha, v.pie.isEmpty() ? fecha : v.pie);
        rv.setTextViewText(R.id.w_titulo, v.titulo);
        rv.setTextViewText(R.id.w_sub, v.sub);
        rv.setViewVisibility(R.id.w_sub, v.sub.isEmpty() ? View.GONE : View.VISIBLE);
        rv.setViewVisibility(R.id.w_estado, v.estado == 0 ? View.GONE : View.VISIBLE);
        if (v.estado != 0) {
            rv.setTextViewText(R.id.w_estado, v.etiqueta);
            rv.setInt(R.id.w_estado, "setBackgroundResource", v.estado == 3 ? R.drawable.w_estado_bad : v.estado == 2 ? R.drawable.w_estado_warn : R.drawable.w_estado_good);
            rv.setTextColor(R.id.w_estado, ctx.getColor(v.estado == 3 ? R.color.bad : v.estado == 2 ? R.color.warn : R.color.good));
        }
        rv.setContentDescription(R.id.w_raiz, "myCoach. " + (v.estado != 0 ? v.etiqueta.substring(3) + ". " : "") + v.titulo + " " + v.sub);
        PendingIntent abrir = PendingIntent.getActivity(ctx, 0, new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.w_raiz, abrir);
        for (int id : ids) mgr.updateAppWidget(id, rv);
    }
}
