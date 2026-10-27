/* 拾光 手机版 · 全屏放映（交叉淡入 + 缓慢推近 + 背景音乐 + 底部时间轴） */
(function () {
  'use strict';

  var doc = document;
  function $(s) { return doc.querySelector(s); }
  function on(n, e, f, o) { if (n) n.addEventListener(e, f, o); }

  var S2 = {
    open: false,
    list: [],
    idx: 0,
    timer: 0,
    paused: false,
    layer: 0,
    raf: 0,
    t0: 0,
    audio: null,
    track: -1,
    vol: 0,
    fadeTimer: 0
  };

  var E = null;
  function els() {
    if (!E) {
      E = {
        root: $('#show'),
        a: $('#s-a'),
        b: $('#s-b'),
        cap: $('#s-cap'),
        date: $('#s-date'),
        sub: $('#s-sub'),
        pause: $('#s-pause'),
        music: $('#s-music'),
        musicName: $('#s-music-name'),
        bar: $('#s-bar'),
        prog: $('#s-prog'),
        months: $('#s-months')
      };
    }
    return E;
  }

  /** 放映要的是「屏幕物理像素」级别的图，太小就会糊（9:20 屏幕尤其明显）。 */
  function shotW() {
    var dpr = Math.min(3, window.devicePixelRatio || 2);
    var px = Math.round(Math.max(window.innerWidth, window.innerHeight) * dpr);
    if (px < 720) px = 720;
    if (px > 2160) px = 2160;
    return px;
  }

  function pct(i, n) {
    if (n <= 1) return 50;
    return (i / (n - 1)) * 100;
  }

  var SS = {
    isOpen: function () { return S2.open; },
    isPaused: function () { return S2.paused; },

    start: function (list, idx) {
      if (!list || !list.length) {
        App.toast('这里还没有可以放映的照片');
        return;
      }
      if (window.VW && VW.isOpen()) VW.close();
      var e = els();
      S2.list = list;
      S2.idx = Math.max(0, Math.min(idx || 0, list.length - 1));
      S2.open = true;
      S2.paused = false;
      S2.layer = 0;
      e.root.hidden = false;
      [e.a, e.b].forEach(function (l) {
        l.className = 's-layer';
        var bb = l.querySelector('.s-bg');
        var ff = l.querySelector('.s-fg');
        if (bb) bb.style.backgroundImage = '';
        if (ff) ff.style.backgroundImage = '';
      });
      e.pause.hidden = true;

      this.buildMonths();
      this.paint(S2.idx, true);
      this.applyChrome(true);
      this.restart();

      Backend.immersive(true);
      Backend.keepAwake(true);
      this.startMusic();
      this.bind();
    },

    stop: function () {
      if (!S2.open) return;
      var e = els();
      S2.open = false;
      clearTimeout(S2.timer);
      if (S2.raf) cancelAnimationFrame(S2.raf);
      S2.raf = 0;
      e.root.hidden = true;
      this.stopMusic();
      Backend.immersive(false);
      Backend.keepAwake(false);
    },

    buildMonths: function () {
      var box = els().months;
      box.innerHTML = '';
      var n = S2.list.length;
      var lastY = -1;
      for (var i = 0; i < n; i++) {
        var y = new Date(S2.list[i].t).getFullYear();
        if (y !== lastY) {
          lastY = y;
          var u = doc.createElement('u');
          u.style.left = pct(i, n) + '%';
          box.appendChild(u);
          var em = doc.createElement('em');
          em.textContent = y;
          em.style.left = pct(i, n) + '%';
          box.appendChild(em);
        }
      }
      var dot = doc.createElement('div');
      dot.className = 's-dot';
      var old = doc.getElementById('s-dot');
      if (old) old.parentNode.removeChild(old);
      box.appendChild(dot);
    },

    paint: function (i, instant) {
      var e = els();
      var it = S2.list[i];
      if (!it) return;

      var cur = S2.layer === 0 ? e.a : e.b;
      var next = S2.layer === 0 ? e.b : e.a;

      next.className = 's-layer';
      var url = 'url("' + Backend.thumb(it.id, shotW()) + '")';
      var nbg = next.querySelector('.s-bg');
      var nfg = next.querySelector('.s-fg');
      if (nbg) nbg.style.backgroundImage = 'url("' + Backend.thumb(it.id, 180) + '")';
      if (nfg) nfg.style.backgroundImage = url;
      void next.offsetWidth;

      if (!instant) {
        next.classList.add('on');
      } else {
        next.style.transition = 'none';
        next.classList.add('on');
        void next.offsetWidth;
        next.style.transition = '';
      }
      if (S.cfg.zoom) {
        requestAnimationFrame(function () { next.classList.add('zoom'); });
      }

      cur.classList.remove('on');
      cur.classList.remove('zoom');

      // 预取下一张，换片时不再等网络
      if (S2.list.length > 1) {
        var nxt = S2.list[(i + 1) % S2.list.length];
        if (nxt) {
          var pre = new Image();
          pre.src = Backend.thumb(nxt.id, shotW());
        }
      }
      S2.layer = 1 - S2.layer;

      e.date.textContent = U.fullLabel(it.t);
      var bits = ['第 ' + (i + 1) + ' / ' + S2.list.length + ' 张'];
      if (it.k === 2 && it.d) bits.push('视频 ' + U.dur(it.d));
      if (it.b) bits.push(it.b);
      if (it.w) bits.push(it.w + '×' + it.h);
      e.sub.textContent = bits.join(' · ');

      var dot = doc.getElementById('s-dot');
      if (dot) dot.style.left = pct(i, S2.list.length) + '%';
      e.prog.style.width = '0%';
      this.applyChrome(true);
    },

    next: function () {
      if (!S2.open) return;
      S2.idx = (S2.idx + 1) % S2.list.length;
      this.paint(S2.idx, false);
      this.restart();
    },

    prev: function () {
      if (!S2.open) return;
      S2.idx = (S2.idx - 1 + S2.list.length) % S2.list.length;
      this.paint(S2.idx, false);
      this.restart();
    },

    restart: function () {
      clearTimeout(S2.timer);
      if (S2.raf) { cancelAnimationFrame(S2.raf); S2.raf = 0; }
      if (S2.paused) return;
      var dur = Math.max(2500, Number(S.cfg.speed) || 6000);
      S2.t0 = Date.now();
      var self = this;
      var bar = els().prog;
      function step() {
        if (!S2.open || S2.paused) return;
        var p = Math.min(1, (Date.now() - S2.t0) / dur);
        bar.style.width = (p * 100).toFixed(1) + '%';
        if (p < 1) S2.raf = requestAnimationFrame(step);
      }
      S2.raf = requestAnimationFrame(step);
      S2.timer = setTimeout(function () { self.next(); }, dur);
    },

    togglePause: function () {
      S2.paused = !S2.paused;
      els().pause.hidden = !S2.paused;
      if (S2.paused) {
        clearTimeout(S2.timer);
        if (S2.raf) { cancelAnimationFrame(S2.raf); S2.raf = 0; }
        if (S2.audio) S2.audio.pause();
      } else {
        if (S2.audio && S.cfg.music) {
          var p = S2.audio.play();
          if (p && p.catch) p.catch(function () { });
        }
        this.restart();
      }
      this.applyChrome(true);
    },

    applyChrome: function (reveal) {
      var e = els();
      var playing = !S2.paused;
      e.root.classList.toggle('chrome-off', playing && !reveal);
      clearTimeout(S2.chromeTimer);
      if (playing) {
        S2.chromeTimer = setTimeout(function () {
          if (S2.open && !S2.paused) e.root.classList.add('chrome-off');
        }, 4200);
      }
      // 每张照片的日期说明先亮一下再退场
      e.root.classList.remove('cap-off');
      clearTimeout(S2.capTimer);
      S2.capTimer = setTimeout(function () {
        if (S2.open) e.root.classList.add('cap-off');
      }, 3400);
    },

    /* ------------------------------------------------------------ 音乐 */

    startMusic: function () {
      if (!S.cfg.music || !S.music.length) {
        els().music.hidden = true;
        return;
      }
      if (!S2.audio) {
        S2.audio = new Audio();
        S2.audio.preload = 'auto';
        S2.audio.addEventListener('ended', function () {
          if (!S2.open) return;
          SS.nextTrack();
        });
      }
      S2.track = Math.floor(Math.random() * S.music.length);
      this.playTrack(S2.track, true);
      els().music.hidden = false;
      this.updateBadge();
    },

    playTrack: function (i, fadeIn) {
      if (!S2.audio || !S.music.length) return;
      S2.track = ((i % S.music.length) + S.music.length) % S.music.length;
      S2.audio.src = Backend.music(S2.track);
      S2.audio.volume = fadeIn ? 0 : 0.8;
      var p = S2.audio.play();
      if (p && p.catch) p.catch(function () { });
      if (fadeIn) {
        clearInterval(S2.fadeTimer);
        var v = 0;
        S2.fadeTimer = setInterval(function () {
          v += 0.05;
          if (v >= 0.8) { v = 0.8; clearInterval(S2.fadeTimer); }
          try { S2.audio.volume = v; } catch (err) { }
        }, 120);
      }
      this.updateBadge();
    },

    nextTrack: function () {
      if (!S.music.length) return;
      this.playTrack(S2.track + 1, false);
    },

    toggleMusic: function () {
      if (!S.music.length) return;
      if (!S2.audio) { this.startMusic(); return; }
      if (S2.audio.paused) {
        S2.audio.play().catch(function () { });
        S.cfg.music = true;
      } else {
        S2.audio.pause();
        S.cfg.music = false;
      }
      LS.set('sg.cfg', S.cfg);
      this.updateBadge();
    },

    updateBadge: function () {
      var e = els();
      var m = S.music[S2.track];
      var playing = S2.audio && !S2.audio.paused;
      e.music.hidden = !(S.cfg.music && m);
      e.music.style.opacity = playing ? '1' : '0.45';
      e.musicName.textContent = (m ? m.title : '背景音乐') + (playing ? '' : ' · 已暂停');
    },

    stopMusic: function () {
      clearInterval(S2.fadeTimer);
      if (S2.audio) {
        try { S2.audio.pause(); S2.audio.removeAttribute('src'); } catch (e) { }
      }
    },

    /* ------------------------------------------------------------ 手势 */

    bind: function () {
      if (S2.bound) return;
      S2.bound = true;
      var e = els();
      var sx = 0, sy = 0, moved = 0, t0 = 0;

      on(e.root, 'touchstart', function (ev) {
        if (ev.touches.length !== 1) return;
        sx = ev.touches[0].clientX;
        sy = ev.touches[0].clientY;
        moved = 0;
        t0 = Date.now();
      }, { passive: true });

      on(e.root, 'touchmove', function (ev) {
        if (ev.touches.length !== 1) return;
        var dx = ev.touches[0].clientX - sx;
        var dy = ev.touches[0].clientY - sy;
        moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
        if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
          e.root.style.transform = 'translate3d(0,' + (dy * 0.45) + 'px,0)';
          e.root.style.opacity = String(Math.max(0.4, 1 - dy / 460));
        }
      }, { passive: true });

      on(e.root, 'touchend', function (ev) {
        e.root.style.transform = '';
        e.root.style.opacity = '';
        var t = ev.changedTouches[0];
        if (!t) return;
        var dx = t.clientX - sx;
        var dy = t.clientY - sy;
        var dt = Date.now() - t0;
        if (dy > 110 && Math.abs(dy) > Math.abs(dx)) { SS.stop(); return; }
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0) SS.next(); else SS.prev();
          return;
        }
        if (moved < 16 && dt < 400) {
          var tag = (ev.target && ev.target.closest) ? ev.target.closest('.s-top, .s-bar') : null;
          if (tag) return;
          SS.togglePause();
        }
      }, { passive: true });

      on($('#s-close'), 'click', function (ev) {
        ev.stopPropagation();
        SS.stop();
      });

      on(e.music, 'click', function (ev) {
        ev.stopPropagation();
        SS.toggleMusic();
      });

      on(doc, 'visibilitychange', function () {
        if (doc.hidden && S2.open && !S2.paused) SS.togglePause();
      });
    }
  };

  window.SS = SS;
})();
