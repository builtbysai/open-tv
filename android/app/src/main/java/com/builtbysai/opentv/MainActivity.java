package com.builtbysai.opentv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.SystemClock;
import android.app.SearchManager;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Collections;

/** TV host for the bundled viewer. No remote URL configuration or unrestricted JS interface. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int OPEN_FILE = 100, SAVE_FILE = 101;
    private WebView web;
    private FrameLayout root;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingExport;
    private Map<String, String> securityHeaders = new HashMap<>();
    private MediaSession mediaSession;
    private AudioManager audioManager;
    // The page owns play and pause. Android System WebView requests and handles audio focus for
    // its own media (ducking or pausing on a real interruption), so the host never asks for focus
    // itself: a second request from the same app takes focus from WebView, which then pauses the
    // element about a second into playback. The host only reports lifecycle changes.
    private boolean playing, privateMode, destroyed, stopped, foreground = true;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(16,19,19));
        setContentView(root);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(16,19,19));
        root.addView(web, new FrameLayout.LayoutParams(-1,-1));
        setupMedia();
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false); // The viewer starts media only after Watch/Resume.
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " OpenTVAndroid/" + BuildConfig.VERSION_NAME);
        web.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        try (var stream = getAssets().open("security-headers.json")) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] bytes = new byte[4096]; int count;
            while ((count = stream.read(bytes)) != -1) buffer.write(bytes, 0, count);
            JSONObject json = new JSONObject(buffer.toString(StandardCharsets.UTF_8.name()));
            var names = json.keys();
            while (names.hasNext()) { String key = names.next(); securityHeaders.put(key, json.getString(key)); }
        } catch (Exception ignored) { message("App assets are missing. Reinstall this Open TV package."); finish(); return; }
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!trustedAppUri(request.getUrl())) return null;
                String requested = request.getUrl().getPath();
                if (requested != null && (requested.startsWith(PROXY_PREFIX) || requested.startsWith(PROXY_SECURE))) return proxyHttp(request);
                Uri resource = request.getUrl();
                if ("/".equals(resource.getPath()) || "".equals(resource.getPath())) resource = resource.buildUpon().path("/index.html").build();
                WebResourceResponse response = loader.shouldInterceptRequest(resource);
                if (response == null) response = new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", null, new ByteArrayInputStream(new byte[0]));
                response.setResponseHeaders(securityHeaders);
                return response;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!request.isForMainFrame()) return !"https".equals(uri.getScheme());
                if (trustedAppUri(uri) && ("/".equals(uri.getPath()) || "".equals(uri.getPath()) || "/index.html".equals(uri.getPath()))) return false;
                if (request.hasGesture() && "https".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException ignored) { message("Open this provider link on your phone or computer."); }
                }
                if (request.hasGesture() && "mailto".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_SENDTO, uri)); }
                    catch (ActivityNotFoundException ignored) { message("No email app is installed. Use the published copyright address on your phone or computer."); }
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) { callback.onCustomViewHidden(); return; }
                customView = view; customCallback = callback; web.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(-1,-1));
                // Page fullscreen (the player shell, with the page's own chrome) arrives here
                // too: the system bars always go with it.
                view.requestFocus(); immersive();
            }
            @Override public void onHideCustomView() { hideCustomView(); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try { startActivityForResult(intent, OPEN_FILE); }
                catch (ActivityNotFoundException ignored) { callback.onReceiveValue(null); fileCallback = null; message("No file picker is installed. Use playlist URLs or install a compatible document picker."); }
                return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "OpenTVDevice", Collections.singleton(ORIGIN), (view, message, sourceOrigin, mainFrame, reply) -> {
                if (destroyed || !mainFrame || !ORIGIN.equals(sourceOrigin.toString())) return;
                try {
                    String data = message.getData();
                    if (data == null) return;
                    if (data.length() > 6_000_000) { message("Backup too large for TV export. Use the web viewer."); return; }
                    JSONObject json = new JSONObject(data);
                    if ("foreground".equals(json.optString("type"))) {
                        // A phone asked to play: come back to the front if Android allows it
                        // (it does when "Display over other apps" is granted).
                        if (!foreground) try { startActivity(new Intent(MainActivity.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (RuntimeException ignored) {}
                        return;
                    }
                    if ("volume".equals(json.optString("type")) && audioManager != null) {
                        int step = json.optInt("step", 99);
                        int direction = step == 1 ? AudioManager.ADJUST_RAISE : step == -1 ? AudioManager.ADJUST_LOWER : step == 0 ? AudioManager.ADJUST_TOGGLE_MUTE : 0;
                        if (step == 1 || step == -1 || step == 0)
                            audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI);
                        return;
                    }
                    if ("autostart".equals(json.optString("type")) && json.opt("enabled") instanceof Boolean) {
                        getSharedPreferences(BootReceiver.PREFS, MODE_PRIVATE).edit().putBoolean(BootReceiver.AUTOSTART, json.getBoolean("enabled")).apply(); return;
                    }
                    if ("privacy".equals(json.optString("type")) && json.opt("enabled") instanceof Boolean) {
                        setPrivateMode(json.getBoolean("enabled")); return;
                    }
                    if ("media".equals(json.optString("type"))) { updateMedia(json); return; }
                    if (!"export".equals(json.optString("type"))) return;
                    String name = json.getString("name"), content = json.getString("content");
                    if (!name.matches("open-tv-[a-z-]+\\.json")) return;
                    if (content.length() > 5_000_000) { message("Backup too large for TV export. Use the web viewer."); return; }
                    if (pendingExport != null) { message("Finish the current backup before exporting another."); return; }
                    new JSONObject(content); // Only bounded JSON exports, never arbitrary paths or commands.
                    pendingExport = content;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, name);
                    try { startActivityForResult(intent, SAVE_FILE); }
                    catch (ActivityNotFoundException ignored) { pendingExport = null; message("No document provider is installed. Export a backup from the web viewer instead."); }
                } catch (Exception ignored) { message("This backup could not be exported."); }
            });
        }
        web.setDownloadListener((url, agent, disposition, mime, size) -> message("Use JSON export controls with an up-to-date Android System WebView, or export from the web viewer."));
        String query = searchQuery(getIntent());
        web.loadUrl(ORIGIN + "/index.html?tv=1" + (query == null ? "" : "&q=" + Uri.encode(query)));
        web.requestFocus();
        immersive();
    }
    private static final String PROXY_PREFIX = "/__http/";
    // An HTTPS playlist whose variants or segments are plain HTTP is fetched here too, so all
    // of it comes back through the same route.
    private static final String PROXY_SECURE = "/__https/";
    private static final int PROXY_PLAYLIST_LIMIT = 2_000_000;
    private static WebResourceResponse proxyError(int code, String reason) {
        WebResourceResponse response = new WebResourceResponse("text/plain", "UTF-8", code, reason, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
        return response;
    }
    // A plain-HTTP media address the page cannot load itself (it is served over HTTPS), fetched here
    // and handed back from the app's own origin: /__http/<host[:port]>/<path>?<query>. Only GET,
    // only http, never this device's own loopback or link-local addresses, and only for requests
    // made by the viewer itself. XMLTV guides (/__https/) come through here too: native HTTP has
    // no CORS, so a redirect chain through a host without CORS headers still arrives. Any
    // response type passes through unchanged; only HLS playlists are rewritten.
    private WebResourceResponse proxyHttp(WebResourceRequest request) {
        String origin = request.getRequestHeaders().get("Origin");
        if (!"GET".equals(request.getMethod()) || (origin != null && !ORIGIN.equals(origin))) return proxyError(403, "Forbidden");
        String encoded = request.getUrl().getEncodedPath();
        boolean secure = encoded.startsWith(PROXY_SECURE);
        String path = encoded.substring((secure ? PROXY_SECURE : PROXY_PREFIX).length());
        String query = request.getUrl().getEncodedQuery();
        String target = (secure ? "https://" : "http://") + path + (query == null ? "" : "?" + query);
        HttpURLConnection connection = null;
        try {
            for (int hop = 0; hop < 5; hop++) {
                URL url = new URL(target);
                if (!("http".equals(url.getProtocol()) || "https".equals(url.getProtocol())) || url.getUserInfo() != null) return proxyError(400, "Bad address");
                for (InetAddress address : InetAddress.getAllByName(url.getHost()))
                    if (address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isAnyLocalAddress()) return proxyError(403, "Blocked address");
                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(30000);
                String range = request.getRequestHeaders().get("Range");
                if (range != null) connection.setRequestProperty("Range", range);
                connection.setRequestProperty("Accept", "*/*");
                int code = connection.getResponseCode();
                if (code >= 300 && code < 400 && connection.getHeaderField("Location") != null) {
                    // Followed here (every hop re-checked above), so a playlist reached through a
                    // redirect is still rewritten against where it really came from.
                    target = new URL(url, connection.getHeaderField("Location")).toString();
                    connection.disconnect();
                    continue;
                }
                String type = connection.getContentType() == null ? "application/octet-stream" : connection.getContentType();
                String mime = type.split(";")[0].trim();
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", ORIGIN);
                headers.put("Cache-Control", "no-store");
                // Where the redirects ended, so the page can check it (a guide must land on HTTPS).
                headers.put("X-Open-TV-Url", target);
                // Content-Length is absent when the connection already decoded gzip for us.
                for (String name : new String[] { "Content-Range", "Accept-Ranges", "Content-Length" }) {
                    String value = connection.getHeaderField(name);
                    if (value != null) headers.put(name, value);
                }
                InputStream body = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (body == null) body = new ByteArrayInputStream(new byte[0]);
                String lower = mime.toLowerCase();
                boolean playlist = lower.contains("mpegurl") || (url.getPath().toLowerCase().endsWith(".m3u8") && !lower.contains("xml"));
                if (playlist && code < 300) {
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    byte[] chunk = new byte[8192]; int count;
                    while ((count = body.read(chunk)) != -1) {
                        buffer.write(chunk, 0, count);
                        if (buffer.size() > PROXY_PLAYLIST_LIMIT) return proxyError(502, "Playlist too large");
                    }
                    body.close(); connection.disconnect();
                    headers.remove("Content-Length"); headers.remove("Content-Range");
                    String rewritten = rewritePlaylist(buffer.toString(StandardCharsets.UTF_8.name()), url);
                    return new WebResourceResponse(mime, "UTF-8", code, code == 206 ? "Partial Content" : "OK", headers, new ByteArrayInputStream(rewritten.getBytes(StandardCharsets.UTF_8)));
                }
                String reason = connection.getResponseMessage() == null || connection.getResponseMessage().isEmpty() ? "OK" : connection.getResponseMessage();
                return new WebResourceResponse(mime, null, code, reason, headers, body);
            }
            return proxyError(508, "Too many redirects");
        } catch (Exception failure) {
            if (connection != null) connection.disconnect();
            return proxyError(502, "Could not reach the server");
        }
    }
    // Every address inside a playlist (variants, segments, keys, audio and subtitle renditions)
    // is resolved against where the playlist came from and pointed back through this route.
    private static String rewritePlaylist(String text, URL base) throws Exception {
        StringBuilder out = new StringBuilder();
        for (String line : text.split("\\r?\\n", -1)) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) { out.append(line).append('\n'); continue; }
            if (!trimmed.startsWith("#")) { out.append(proxied(trimmed, base)).append('\n'); continue; }
            java.util.regex.Matcher match = java.util.regex.Pattern.compile("URI=\"([^\"]*)\"").matcher(line);
            StringBuffer replaced = new StringBuffer();
            while (match.find()) match.appendReplacement(replaced, java.util.regex.Matcher.quoteReplacement("URI=\"" + proxied(match.group(1), base) + "\""));
            match.appendTail(replaced);
            out.append(replaced).append('\n');
        }
        return out.toString();
    }
    private static String proxied(String reference, URL base) throws Exception {
        if (reference.startsWith("data:") || reference.startsWith("skd:")) return reference;
        URL url = new URL(base, reference);
        String scheme = url.getProtocol();
        if (!"http".equals(scheme) && !"https".equals(scheme)) return reference;
        return ("https".equals(scheme) ? PROXY_SECURE : PROXY_PREFIX) + url.getAuthority() + url.getFile();
    }
    private static boolean trustedAppUri(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
    private void message(String value) { Toast.makeText(this, value, Toast.LENGTH_LONG).show(); }
    private void dispatchMedia(String key) {
        if (!destroyed && web != null) web.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:" + JSONObject.quote(key) + ",bubbles:true,cancelable:true}))", null);
    }
    private void setupMedia() {
        audioManager = (AudioManager)getSystemService(AUDIO_SERVICE);
        mediaSession = new MediaSession(this,"OpenTV");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { dispatchMedia("MediaPlay"); }
            @Override public void onPause() { dispatchMedia("MediaPause"); }
            @Override public void onStop() { dispatchMedia("MediaStop"); }
            @Override public void onSkipToNext() { dispatchMedia("MediaTrackNext"); }
            @Override public void onSkipToPrevious() { dispatchMedia("MediaTrackPrevious"); }
            @Override public void onFastForward() { dispatchMedia("MediaFastForward"); }
            @Override public void onRewind() { dispatchMedia("MediaRewind"); }
            @Override public void onSeekTo(long position) {
                if (position < 0 || position > 604800000L) return;
                web.evaluateJavascript("window.dispatchEvent(new CustomEvent('opentv:seek',{detail:{seconds:" + position / 1000.0 + "}}))",null);
            }
        });
    }
    // A line in the page's playback log (Settings → About → Playback log).
    private void hostLog(String event) {
        if (!destroyed && web != null) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('opentv:hostlog',{detail:{event:" + JSONObject.quote(event) + "}}))", null);
    }
    // Voice search and the system search key land in the app's own search.
    private static String searchQuery(Intent intent) {
        if (intent == null || !Intent.ACTION_SEARCH.equals(intent.getAction())) return null;
        String query = intent.getStringExtra(SearchManager.QUERY);
        if (query == null) return null;
        query = query.replaceAll("[\\p{Cntrl}]", "").trim();
        return query.isEmpty() ? null : query.substring(0, Math.min(query.length(), 200));
    }
    private void openSearch(String query) {
        if (destroyed || web == null) return;
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('opentv:search',{detail:{text:" + JSONObject.quote(query == null ? "" : query) + "}}))", null);
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String query = searchQuery(intent);
        if (query != null) openSearch(query);
    }
    @Override public boolean onSearchRequested() { openSearch(null); return true; }
    private void setPrivateMode(boolean enabled) {
        privateMode = enabled;
        if (enabled) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            mediaSession.setActive(false); mediaSession.setMetadata(null);
        } else if (foreground) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            if (customView == null) web.setVisibility(View.VISIBLE);
        }
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!enabled);
    }
    private void updateMedia(JSONObject json) {
        if (!foreground) { mediaSession.setActive(false);mediaSession.setMetadata(null);return; }
        String phase = json.optString("phase");
        int state = switch (phase) {
            case "playing" -> PlaybackState.STATE_PLAYING;
            case "paused" -> PlaybackState.STATE_PAUSED;
            case "loading", "buffering", "recovering" -> PlaybackState.STATE_BUFFERING;
            default -> PlaybackState.STATE_STOPPED;
        };
        playing = state == PlaybackState.STATE_PLAYING || (playing && state == PlaybackState.STATE_BUFFERING);
        if (privateMode || state == PlaybackState.STATE_STOPPED) {mediaSession.setActive(false);mediaSession.setMetadata(null);return;}
        long position = Math.max(0,Math.min(604800000L,json.optLong("position"))), duration = Math.max(0,Math.min(604800000L,json.optLong("duration")));
        String title = json.optString("title","Open TV").replaceAll("[\\p{Cntrl}]","");
        if (title.length() > 120) title = title.substring(0,120);
        mediaSession.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE,title).putString(MediaMetadata.METADATA_KEY_ARTIST,"Open TV").putLong(MediaMetadata.METADATA_KEY_DURATION,duration).build());
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_FAST_FORWARD | PlaybackState.ACTION_REWIND;
        if (duration > 0) actions |= PlaybackState.ACTION_SEEK_TO;
        mediaSession.setPlaybackState(new PlaybackState.Builder().setActions(actions).setState(state,position,state == PlaybackState.STATE_PLAYING ? 1f : 0f,SystemClock.elapsedRealtime()).build());
        mediaSession.setActive(true);
    }
    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView); customView = null;
        web.setVisibility(View.VISIBLE);
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null; immersive();
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        String key = switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "MediaPlayPause";
            case KeyEvent.KEYCODE_MEDIA_PLAY -> "MediaPlay";
            case KeyEvent.KEYCODE_MEDIA_PAUSE -> "MediaPause";
            case KeyEvent.KEYCODE_MEDIA_STOP -> "MediaStop";
            case KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_CHANNEL_UP -> "MediaTrackNext";
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_CHANNEL_DOWN -> "MediaTrackPrevious";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "MediaFastForward";
            case KeyEvent.KEYCODE_MEDIA_REWIND -> "MediaRewind";
            default -> null;
        };
        if (key != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && (event.getRepeatCount() == 0 || key.equals("MediaFastForward") || key.equals("MediaRewind")))
                dispatchMedia(key);
            return true;
        }
        return super.dispatchKeyEvent(event); // D-pad, Select, system Volume/Home and IME remain native.
    }
    @Override public void onBackPressed() {
        // In fullscreen the page decides first (wake hidden controls, then leave fullscreen,
        // which hides the custom view); only a Back it leaves unhandled closes the view here.
        web.evaluateJavascript("!window.dispatchEvent(new Event('opentv:back',{cancelable:true}))", handled -> {
            if ("true".equals(handled)) return;
            if (customView != null) { hideCustomView(); return; }
            finish();
        });
    }
    // An overlay, a system dialog or the file picker pauses the activity without stopping it:
    // playback carries on. Only private content is hidden from the recents screenshot.
    @Override protected void onPause() {
        foreground = false;
        if (privateMode) {if (customView != null) hideCustomView();web.setVisibility(View.INVISIBLE);}
        mediaSession.setActive(false);mediaSession.setMetadata(null);
        hostLog("activity paused (overlay or dialog); playback continues");
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume(); foreground = true;
        if (web == null) return;
        if (!privateMode) setPrivateMode(false);
        hostLog("activity resumed");
        immersive();
    }
    // Leaving the app for real (Home, another app, an input switch): the page pauses what plays
    // and remembers it; coming back restores it, playing if it was playing.
    @Override protected void onStop() {
        stopped = true;
        if (web != null) {
            hostLog("activity stopped; the page pauses playback");
            web.evaluateJavascript("window.dispatchEvent(new Event('opentv:suspend'))", null);
            web.onPause();
        }
        super.onStop();
    }
    @Override protected void onStart() {
        super.onStart();
        if (!stopped || web == null) return;
        stopped = false;
        web.onResume();
        hostLog("activity started again; the page restores playback");
        web.evaluateJavascript("window.dispatchEvent(new Event('opentv:resume'))", null);
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        if (request == OPEN_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(uri == null ? null : new Uri[] { uri }); fileCallback = null;
        } else if (request == SAVE_FILE) {
            String content = pendingExport; pendingExport = null;
            if (uri != null && content != null) try (OutputStream stream = getContentResolver().openOutputStream(uri)) {
                if (stream == null) throw new IllegalStateException();
                stream.write(content.getBytes(StandardCharsets.UTF_8)); message("Backup saved.");
            } catch (Exception ignored) { message("The backup could not be saved. Choose another document provider."); }
        }
    }
    @Override protected void onDestroy() {
        destroyed = true;
        if (mediaSession != null) {mediaSession.setActive(false);mediaSession.release();}
        if (fileCallback != null) {fileCallback.onReceiveValue(null);fileCallback = null;}
        pendingExport = null;
        if (web != null) { root.removeView(web); web.destroy();web = null; }
        super.onDestroy();
    }
}
