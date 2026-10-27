/* 拾光 手机版 · 大图查看（左右翻页 / 双指缩放 / 双击放大 / 下滑关闭） */
(function () {
  'use strict';

  var doc = document;
  function $(s) { return doc.querySelector(s); }
  function on(n, e, f, o) { if (n) n.addEventListener(e, f, o); }

  var V = {
    open: false,
    list: [],
    idx: 0,
    scale: 1,
    x: 0,
    y: 0,
    token: 0,
    chrome: true
  };

  var E = null;
  function els() {
    if (!E) {
      E = {
        root: $('#viewer'),
        stage: $('#v-stage'),
        item: $('#v-item'),
        load: $('#v-load'),
        top: $('#v-top'),
        bottom: $('#v-bottom'),
        title: $('#v-title'),
        when: $('#v-when'),
        desc: $('#v-desc'),
        count: $('#v-count'),
        fav: $('#v-fav')
      };
    }
    return E;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var VW = {
    isOpen: function () { return V.open; },

    open: function (list, idx) {
      if (!list || !list.length) return;
      var e = els();
      V.list = list;
      V.idx = clamp(idx || 0, 0, list.length - 1);
      V.open = true;
      e.root.hidden = false;
      this.setChrome(true);
      this.render();
      this.bind();
      Backend.keepAwake(true);
    },

    close: function () {
      if (!V.open) return;
      var e = els();
      V.open = false;
      e.root.hidden = true;
      var vd = e.item.querySelector('video');
      if (vd) { vd.pause(); vd.removeAttribute('src'); vd.load(); }
      e.item.innerHTML = '';
      V.scale = 1; V.x = 0; V.y = 0;
      Backend.keepAwake(false);
    },

    setChrome: function (show) {
      var e = els();
      V.chrome = show;
      e.top.classList.toggle('hide', !show);
      e.bottom.classList.toggle('hide', !show);
      e.count.classList.toggle('hide', !show);
    },

    render: function () {
      var e = els();
      var it = V.list[V.idx];
      if (!it) return;
      V.token++;
      var tok = V.token;
      V.scale = 1; V.x = 0; V.y = 0;

      e.item.style.transition = 'none';
      e.item.style.transform = 'translate3d(0,0,0)';
      e.item.style.opacity = '1';
      e.item.innerHTML = '';

      e.title.textContent = it.n || U.mdLabel(it.t);
      e.when.textContent = U.fullLabel(it.t);
      e.desc.textContent = (it.k === 2 ? '视频 ' + U.dur(it.d) : (it.w ? it.w + ' × ' + it.h : '照片')) + ' · ' + U.bytes(it.s);
      e.count.textContent = (V.idx + 1) + ' / ' + V.list.length;
      e.fav.classList.toggle('on', !!S.favSet[it.id]);
      e.fav.querySelector('i').textContent = S.favSet[it.id] ? '已收藏' : '收藏';
      e.load.classList.remove('on');

      if (it.k === 2) {
        var vd = doc.createElement('video');
        vd.controls = true;
        vd.playsInline = true;
        vd.setAttribute('playsinline', '');
        vd.preload = 'metadata';
        vd.poster = Backend.thumb(it.id, 720);
        vd.src = Backend.full(it.id);
        e.item.appendChild(vd);
      } else {
        var img = doc.createElement('img');
        img.alt = '';
        img.style.transform = 'translate3d(0,0,0) scale(1)';
        img.src = Backend.thumb(it.id, pxW());
        img.addEventListener('load', function () { img.classList.add('on'); }, { once: true });
        e.item.appendChild(img);

        var full = new Image();
        full.onload = function () {
          if (tok !== V.token) return;
          img.src = full.src;
          e.load.classList.remove('on');
        };
        full.onerror = function () {
          if (tok !== V.token) return;
          e.load.classList.remove('on');
        };
        setTimeout(function () {
          if (tok === V.token && !full.complete) e.load.classList.add('on');
        }, 260);
        full.src = Backend.full(it.id);

        // 预取相邻
        var nb = [V.idx - 1, V.idx + 1];
        for (var i = 0; i < nb.length; i++) {
          var n = V.list[nb[i]];
          if (n && n.k === 1) { var p = new Image(); p.src = Backend.full(n.id); }
        }
      }
    },

    go: function (n, dir) {
      if (n < 0 || n >= V.list.length) {
        App.toast(dir > 0 ? '已经是最后一张' : '已经是第一张');
        this.spring();
        return;
      }
      var e = els();
      var node = e.item;
      node.style.transition = 'transform .22s ease, opacity .22s ease';
      node.style.transform = 'translate3d(' + (-dir * 90) + 'px,0,0)';
      node.style.opacity = '0.2';
      var self = this;
      setTimeout(function () {
        V.idx = n;
        self.render();
        node.style.transition = 'none';
        node.style.transform = 'translate3d(' + (dir * 90) + 'px,0,0)';
        node.style.opacity = '0.2';
        requestAnimationFrame(function () {
          node.style.transition = 'transform .26s cubic-bezier(.22,.61,.36,1), opacity .26s';
          node.style.transform = 'translate3d(0,0,0)';
          node.style.opacity = '1';
        });
      }, 190);
    },

    spring: function () {
      var node = els().item;
      node.style.transition = 'transform .24s cubic-bezier(.22,.61,.36,1), opacity .24s';
      node.style.transform = 'translate3d(0,0,0)';
      node.style.opacity = '1';
    },

    applyZoom: function (animate) {
      var img = els().item.querySelector('img');
      if (!img) return;
      img.style.transition = animate ? 'transform .28s cubic-bezier(.22,.61,.36,1)' : 'none';
      img.style.transform = 'translate3d(' + V.x + 'px,' + V.y + 'px,0) scale(' + V.scale + ')';
    },

    clampPan: function () {
      var img = els().item.querySelector('img');
      if (!img) return;
      var w = img.clientWidth || window.innerWidth;
      var h = img.clientHeight || window.innerHeight;
      var mx = Math.max(0, (w * V.scale - w) / 2);
      var my = Math.max(0, (h * V.scale - h) / 2);
      V.x = clamp(V.x, -mx, mx);
      V.y = clamp(V.y, -my, my);
    },

    toggleZoomAt: function (px, py) {
      var img = els().item.querySelector('img');
      if (!img) return;
      if (V.scale > 1.05) {
        V.scale = 1; V.x = 0; V.y = 0;
        this.applyZoom(true);
        return;
      }
      var r = els().stage.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var s2 = 2.4;
      V.scale = s2;
      V.x = (cx - px) * (s2 - 1);
      V.y = (cy - py) * (s2 - 1);
      this.clampPan();
      this.applyZoom(true);
    },

    bind: function () {
      if (V.bound) return;
      V.bound = true;
      var e = els();
      var stage = e.stage;
      var self = VW;

      var mode = 'none';
      var sx = 0, sy = 0, lx = 0, ly = 0;
      var d0 = 0, s0 = 1, x0 = 0, y0 = 0, fx = 0, fy = 0;
      var moved = 0, t0 = 0;
      var lastTap = 0, lastTapX = 0, lastTapY = 0;

      function dist(a, b) {
        var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }

      on(stage, 'touchstart', function (ev) {
        var t = ev.touches;
        t0 = Date.now();
        moved = 0;
        if (t.length === 2) {
          mode = 'pinch';
          d0 = dist(t[0], t[1]) || 1;
          s0 = V.scale; x0 = V.x; y0 = V.y;
          var r = stage.getBoundingClientRect();
          fx = (t[0].clientX + t[1].clientX) / 2 - r.left - r.width / 2;
          fy = (t[0].clientY + t[1].clientY) / 2 - r.top - r.height / 2;
          ev.preventDefault();
          return;
        }
        mode = V.scale > 1.02 ? 'pan' : 'swipe';
        sx = lx = t[0].clientX;
        sy = ly = t[0].clientY;
        x0 = V.x; y0 = V.y;
      }, { passive: false });

      on(stage, 'touchmove', function (ev) {
        var t = ev.touches;
        if (mode === 'pinch' && t.length === 2) {
          var d = dist(t[0], t[1]) || 1;
          var ns = clamp(s0 * d / d0, 1, 6);
          var ratio = ns / s0;
          V.scale = ns;
          V.x = fx - (fx - x0) * ratio;
          V.y = fy - (fy - y0) * ratio;
          if (V.scale <= 1.02) { V.scale = 1; V.x = 0; V.y = 0; }
          self.clampPan();
          self.applyZoom(false);
          ev.preventDefault();
          return;
        }
        if (!t.length) return;
        var dx = t[0].clientX - sx;
        var dy = t[0].clientY - sy;
        moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));

        if (mode === 'pan') {
          V.x = x0 + dx;
          V.y = y0 + dy;
          self.clampPan();
          self.applyZoom(false);
          ev.preventDefault();
        } else if (mode === 'swipe') {
          var w = stage.clientWidth;
          if (Math.abs(dx) > Math.abs(dy)) {
            e.item.style.transition = 'none';
            e.item.style.transform = 'translate3d(' + dx + 'px,0,0)';
            e.item.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / (w * 1.2)));
          } else if (dy > 0) {
            e.item.style.transition = 'none';
            e.item.style.transform = 'translate3d(0,' + (dy * 0.7) + 'px,0)';
            e.item.style.opacity = String(Math.max(0.3, 1 - dy / 500));
          }
          ev.preventDefault();
        }
      }, { passive: false });

      on(stage, 'touchend', function (ev) {
        if (mode === 'pinch') {
          if (V.scale < 1.05) { V.scale = 1; V.x = 0; V.y = 0; }
          self.clampPan();
          self.applyZoom(true);
          mode = 'none';
          return;
        }
        if (mode === 'pan') {
          self.clampPan();
          self.applyZoom(true);
          mode = 'none';
          return;
        }
        var w = stage.clientWidth;
        var dx = (ev.changedTouches[0] ? ev.changedTouches[0].clientX : sx) - sx;
        var dy = (ev.changedTouches[0] ? ev.changedTouches[0].clientY : sy) - sy;
        var dt = Date.now() - t0;
        mode = 'none';

        if (Math.abs(dx) > w * 0.24 && Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0) self.go(V.idx + 1, 1);
          else self.go(V.idx - 1, -1);
          return;
        }
        if (dy > 110 && Math.abs(dy) > Math.abs(dx)) {
          self.close();
          return;
        }

        self.spring();

        if (moved < 14 && dt < 320) {
          var now = Date.now();
          var px = ev.changedTouches[0] ? ev.changedTouches[0].clientX : sx;
          var py = ev.changedTouches[0] ? ev.changedTouches[0].clientY : sy;
          if (now - lastTap < 300 && Math.abs(px - lastTapX) < 40 && Math.abs(py - lastTapY) < 40) {
            lastTap = 0;
            self.toggleZoomAt(px, py);
          } else {
            lastTap = now; lastTapX = px; lastTapY = py;
            self.setChrome(!V.chrome);
          }
        }
      }, { passive: true });

      on($('#v-close'), 'click', function () { VW.close(); });
      on($('#v-more'), 'click', function () { VW.moreSheet(); });
      on($('#v-fav'), 'click', function () {
        var it = V.list[V.idx];
        if (!it) return;
        var on = App.toggleFav(it.id);
        E.fav.classList.toggle('on', on);
        E.fav.querySelector('i').textContent = on ? '已收藏' : '收藏';
      });
      on($('#v-share'), 'click', function () {
        var it = V.list[V.idx];
        if (it) Backend.share(it.id);
      });
      on($('#v-info'), 'click', function () { VW.infoSheet(); });
      on($('#v-hide'), 'click', function () { VW.hideCurrent(); });
    },

    hideCurrent: function () {
      var it = V.list[V.idx];
      if (!it) return;
      App.hide(it.id);
      if (V.list.length <= 1) { this.close(); return; }
      V.list.splice(V.idx, 1);
      if (V.idx >= V.list.length) V.idx = V.list.length - 1;
      this.render();
    },

    infoSheet: function () {
      var it = V.list[V.idx];
      if (!it) return;
      var rows = [
        ['名称', it.n || '—'],
        ['时间', U.fullLabel(it.t)],
        ['类型', it.k === 2 ? '视频' : '照片'],
        ['尺寸', it.w ? it.w + ' × ' + it.h : '—'],
        ['大小', U.bytes(it.s)],
        ['相册', it.b || '—']
      ];
      if (it.k === 2 && it.d) rows.splice(3, 0, ['时长', U.dur(it.d)]);
      var html = '<h3 class="sh-title">详细信息</h3>';
      for (var i = 0; i < rows.length; i++) {
        html += '<div class="kv"><b>' + rows[i][0] + '</b><span>' + String(rows[i][1]).replace(/</g, '&lt;') + '</span></div>';
      }
      App.sheet(html);
    },

    moreSheet: function () {
      var it = V.list[V.idx];
      if (!it) return;
      App.sheet(
        '<h3 class="sh-title">' + (it.n || '') + '</h3>' +
        '<button class="sh-row" id="vm-show"><span class="ic i-play"></span>从这里开始放映</button>' +
        '<button class="sh-row" id="vm-share"><span class="ic i-share"></span>分享到其他应用</button>' +
        '<button class="sh-row" id="vm-hide"><span class="ic i-eyeoff"></span>在拾光里隐藏</button>'
      );
      on($('#vm-show'), 'click', function () {
        App.closeSheet();
        SS.start(V.list, V.idx);
      });
      on($('#vm-share'), 'click', function () { App.closeSheet(); Backend.share(it.id); });
      on($('#vm-hide'), 'click', function () {
        App.closeSheet();
        setTimeout(function () { VW.hideCurrent(); }, 240);
      });
    }
  };

  window.VW = VW;
})();
