/*
 * Open TV embed bridge, protocol v1.
 *
 * Add this to the page your server returns for /embed/movie/{id} and /embed/tv/{id}/{s}/{e}:
 *
 *   <script src="https://tv.builtbysai.com/bridge/opentv-embed.js"></script>
 *
 * (or copy the file to your own server; it has no dependencies). It finds the page's <video>
 * and lets the Open TV app pause, seek, set volume and hear about progress, which is what makes
 * the phone remote, the progress bar and "Up next" work.
 *
 * If your player is not a plain <video>, define before this script loads:
 *
 *   window.OpenTVPlayer = {
 *     play(), pause(), seek(seconds), volume(0..1), muted(boolean),
 *     get(): { playing, buffering, time, duration, volume, muted }   // optional, see below
 *   };
 *   and call window.OpenTVEmbed.update() when something changed.
 *
 * Messages are only sent to, and only accepted from, the page that embeds this one.
 * This is the only file in the project allowed to post to "*", and only when the browser
 * cannot tell us who the parent is.
 */
(function () {
  "use strict";
  if (window.__opentvEmbed || window.parent === window) return;
  window.__opentvEmbed = true;

  var parentOrigin = null;
  try {
    if (location.ancestorOrigins && location.ancestorOrigins.length) parentOrigin = location.ancestorOrigins[0];
    else if (document.referrer) parentOrigin = new URL(document.referrer).origin;
  } catch (e) { /* unknown parent */ }

  function post(message) {
    try { window.parent.postMessage(message, parentOrigin || "*"); } catch (e) { /* parent gone */ }
  }

  var video = null;
  var custom = function () { return window.OpenTVPlayer || null; };
  var announced = false;
  var lastKey = "";

  function find() {
    if (custom()) return true;
    var v = document.querySelector("video");
    if (v) { video = v; return true; }
    return false;
  }

  function read() {
    var c = custom();
    if (c) {
      var s = (c.get && c.get()) || {};
      return {
        playing: !!s.playing, buffering: !!s.buffering,
        time: +s.time || 0, duration: +s.duration || 0,
        volume: s.volume == null ? 1 : +s.volume, muted: !!s.muted,
      };
    }
    if (!video) return null;
    return {
      playing: !video.paused && !video.ended,
      buffering: !video.paused && video.readyState < 3,
      time: video.currentTime || 0,
      duration: isFinite(video.duration) ? video.duration : 0,
      volume: video.volume, muted: video.muted,
    };
  }

  function announce() {
    if (!find()) return;
    announced = true;
    post({ opentv: 1, type: "ready", caps: { seek: true, volume: true, mute: true } });
    state(true);
  }

  function state(force) {
    if (!announced) return;
    var s = read();
    if (!s) return;
    var key = [s.playing, s.buffering, Math.floor(s.time), s.volume, s.muted, Math.floor(s.duration)].join();
    if (!force && key === lastKey) return;
    lastKey = key;
    post({ opentv: 1, type: "state", playing: s.playing, buffering: s.buffering, time: s.time, duration: s.duration, volume: s.volume, muted: s.muted });
  }

  function command(cmd, value) {
    var c = custom();
    var s = read() || {};
    if (c) {
      if (cmd === "play" && c.play) c.play();
      else if (cmd === "pause" && c.pause) c.pause();
      else if (cmd === "toggle") (s.playing ? c.pause : c.play).call(c);
      else if (cmd === "seek" && c.seek) c.seek(value);
      else if (cmd === "seekBy" && c.seek) c.seek(Math.max(0, (s.time || 0) + value));
      else if (cmd === "volume" && c.volume) c.volume(value);
      else if (cmd === "mute" && c.muted) c.muted(true);
      else if (cmd === "unmute" && c.muted) c.muted(false);
      return;
    }
    if (!video) return;
    var ignore = function () { /* autoplay policy or aborted */ };
    if (cmd === "play") { var p = video.play(); if (p && p.catch) p.catch(ignore); }
    else if (cmd === "pause") video.pause();
    else if (cmd === "toggle") { if (video.paused) { var q = video.play(); if (q && q.catch) q.catch(ignore); } else video.pause(); }
    else if (cmd === "seek") video.currentTime = Math.max(0, value);
    else if (cmd === "seekBy") video.currentTime = Math.max(0, video.currentTime + value);
    else if (cmd === "volume") { video.volume = Math.max(0, Math.min(1, value)); if (video.volume > 0) video.muted = false; }
    else if (cmd === "mute") video.muted = true;
    else if (cmd === "unmute") video.muted = false;
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    if (parentOrigin && event.origin !== parentOrigin) return;
    var m = event.data;
    if (!m || m.opentv !== 1) return;
    if (m.type === "hello") announce();
    else if (m.type === "cmd") { command(m.cmd, m.value); setTimeout(function () { state(true); }, 50); }
  });

  // Back from a physical remote while this frame has the keyboard: hand it to the app.
  document.addEventListener("keydown", function (e) {
    var back = e.key === "Escape" || e.key === "BrowserBack" || e.key === "GoBack" || e.keyCode === 10009 || e.keyCode === 461;
    if (back) post({ opentv: 1, type: "key", key: "back" });
  }, true);

  function wire(v) {
    ["play", "pause", "playing", "waiting", "seeked", "volumechange", "durationchange", "loadedmetadata", "stalled"].forEach(function (name) {
      v.addEventListener(name, function () { state(false); });
    });
    v.addEventListener("ended", function () { state(true); post({ opentv: 1, type: "ended" }); });
    v.addEventListener("error", function () { post({ opentv: 1, type: "error", code: "media" }); });
  }

  // The <video> may appear after the page loads: watch for it for a minute.
  function boot() {
    if (find()) { if (video) wire(video); announce(); return; }
    var tries = 0;
    var timer = setInterval(function () {
      if (find() || ++tries > 120) {
        clearInterval(timer);
        if (video) wire(video);
        announce();
      }
    }, 500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  setInterval(function () { state(false); }, 1000);
  window.OpenTVEmbed = { update: function () { state(true); }, announce: announce };
})();
