/* 拾光 手机版 · 时间线（按月份虚拟滚动 + 右侧密度光带） */
(function () {
  'use strict';

  var doc = document;
  function $(s) { return doc.querySelector(s); }

  var HEAD_Y = 46;
  var HEAD_M = 30;
  var GAP = 3;
  var BLOCK_PAD = 16;

  var T = {
    geo: null,
    prefix: [],
    total: 0,
    mounted: {},
    first: -1,
    last: -1,
    cur: 0,
    currentItem: null,
    railBg: null,
    raf: 0
  };

  var TL = {
    currentItem: null,

    els: function () {
      if (!T.els) {
        T.els = {
          scroll: $('#tl-scroll'),
          sizer: $('#tl-sizer'),
          blocks: $('#tl-blocks'),
          end: $('#tl-end'),
          rail: $('#tl-rail'),
          canvas: $('#tl-canvas'),
          bubble: $('#tl-bubble'),
          empty: $('#tl-empty')
        };
      }
      return T.els;
    },

    cols: function (w) {
      return (window.colsFor || function (x) { return x >= 620 ? 5 : 3; })(w);
    },

    enter: function () {
      var e = this.els();
      if (!LS.get('sg.tlHint', false)) {
        LS.set('sg.tlHint', true);
        setTimeout(function () { App.toast('按住右边那条光带，可以一步跨过好几年', 2800); }, 900);
      }
      var wNow = e.blocks.clientWidth || 0;
      if (!T.geo || Math.abs((T.geo.W || 0) - wNow) > 2) {
        this.rebuild(S.months[T.cur] ? S.months[T.cur].key : null);
      } else {
        this.paint(true);
      }
      this.drawRail();
      var self = this;
      if (!T.bound) {
        T.bound = true;
        e.scroll.addEventListener('scroll', function () { self.onScroll(); }, { passive: true });
        this.bindRail();
      }
    },

    onScroll: function () {
      var self = this;
      if (T.raf) return;
      T.raf = requestAnimationFrame(function () {
        T.raf = 0;
        self.paint(false);
        self.drawRail(true);
      });
    },

    rebuild: function (keepKey) {
      var e = this.els();
      var monthCount = S.months.length;
      if (!monthCount) {
        e.blocks.innerHTML = '';
        T.mounted = {};
        T.prefix = [];
        T.total = 0;
        e.sizer.style.height = '0px';
        e.empty.hidden = false;
        T.geo = { W: 0, cols: 3, cell: 0 };
        return;
      }
      e.empty.hidden = true;

      var W = e.blocks.clientWidth;
      if (!W || W < 40) {
        T.retry = (T.retry || 0) + 1;
        if (T.retry < 8) {
          var me = this;
          requestAnimationFrame(function () { me.rebuild(keepKey); });
          return;
        }
        W = window.innerWidth - 44;
      }
      T.retry = 0;
      var cols = this.cols(window.innerWidth || W);
      var cell = (W - GAP * (cols - 1)) / cols;
      var prefix = [];
      var total = 0;

      for (var i = 0; i < monthCount; i++) {
        var mo = S.months[i];
        var rows = Math.ceil(mo.list.length / cols);
        var isNew = i === 0 || S.months[i - 1].y !== mo.y;
        var h = (isNew ? HEAD_Y : 0) + HEAD_M + rows * cell + (rows - 1) * GAP + BLOCK_PAD;
        mo._h = h;
        mo._rows = rows;
        mo._newY = isNew;
        prefix.push(total);
        total += h;
      }

      T.prefix = prefix;
      T.total = total;
      T.geo = { W: W, cols: cols, cell: cell };
      T.mounted = {};
      e.blocks.innerHTML = '';
      e.sizer.style.height = (total + 70) + 'px';
      e.end.style.top = total + 'px';
      e.end.hidden = false;

      var docEl = doc.documentElement;
      docEl.style.setProperty('--cols', cols);

      if (keepKey != null) {
        var idx = -1;
        for (var j = 0; j < monthCount; j++) if (S.months[j].key === keepKey) { idx = j; break; }
        if (idx >= 0) e.scroll.scrollTop = prefix[idx];
        else e.scroll.scrollTop = 0;
      }

      this.paint(true);
      this.drawRail();
    },

    locate: function (y) {
      var p = T.prefix;
      if (!p.length) return 0;
      var lo = 0, hi = p.length - 1, mid;
      while (lo < hi) {
        mid = (lo + hi + 1) >> 1;
        if (p[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },

    paint: function (force) {
      var e = this.els();
      var months = S.months;
      if (!months.length) return;

      var st = e.scroll.scrollTop;
      var vh = e.scroll.clientHeight;
      var a = this.locate(st);
      var b = this.locate(st + vh);
      a = Math.max(0, a - 1);
      b = Math.min(months.length - 1, b + 1);
      if (!force && a === T.first && b === T.last) { this.onChrome(a); return; }
      T.first = a;
      T.last = b;

      for (var i = a; i <= b; i++) {
        if (!T.mounted[i]) this.mount(i);
      }
      for (var k in T.mounted) {
        var n = Number(k);
        if (n < a || n > b) this.unmount(n);
      }

      // 回收：太远的一次性清空，避免长时间滑动后节点堆积
      if (Object.keys(T.mounted).length > 40) {
        for (var k2 in T.mounted) {
          var n2 = Number(k2);
          if (Math.abs(n2 - a) > 6) this.unmount(n2);
        }
      }

      this.onChrome(a);
    },

    onChrome: function (a) {
      T.cur = a;
      var mo = S.months[a];
      if (!mo) return;
      TL.currentItem = mo.list[0] || null;
      var sub = $('#bar-sub');
      if (sub && S.page === 'timeline') {
        sub.textContent = mo.y + ' 年 ' + mo.m + ' 月 · ' + U.num(mo.list.length) + ' 段';
      }
    },

    mount: function (i) {
      var e = this.els();
      var mo = S.months[i];
      if (!mo) return;
      var node = doc.createElement('div');
      node.className = 'tl-block';
      node.dataset.key = mo.key;
      node.style.top = T.prefix[i] + 'px';
      node.style.height = (mo._h - BLOCK_PAD) + 'px';

      var html = '';
      if (mo._newY) {
        html += '<div class="tl-y" style="height:' + HEAD_Y + 'px"><b>' + mo.y + '</b><i></i></div>';
      }
      html += '<div class="tl-m" style="height:' + HEAD_M + 'px"><b>' + mo.m + ' 月</b><span>' + mo.list.length + ' 段</span></div>';
      node.innerHTML = html;

      var g = doc.createElement('div');
      g.className = 'tl-g';
      g.style.gap = GAP + 'px';
      for (var j = 0; j < mo.list.length; j++) {
        g.appendChild(App.tile(mo.list[j], 360));
      }
      node.appendChild(g);
      e.blocks.appendChild(node);
      T.mounted[i] = node;
    },

    unmount: function (i) {
      var node = T.mounted[i];
      if (node && node.parentNode) node.parentNode.removeChild(node);
      delete T.mounted[i];
    },

    /* ---------------------------------------------------------- 密度光带 */

    railGeom: function () {
      var e = this.els();
      var r = e.rail.getBoundingClientRect();
      return { r: r, top: 8, span: Math.max(1, r.height - 16), x: (r.width || 30) - 7 };
    },

    drawStatic: function (W, H, dpr) {
      var e = this.els();
      var cv = T.railBg;
      if (!cv) { cv = T.railBg = doc.createElement('canvas'); }
      cv.width = W * dpr;
      cv.height = H * dpr;
      var g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);

      var x = W - 7;
      var top = 8, span = Math.max(1, H - 16);
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x, top + span);
      g.stroke();

      var months = S.months;
      for (var i = 0; i < months.length; i++) {
        var mo = months[i];
        var y = top + (T.prefix[i] / Math.max(1, T.total)) * span;
        var len = 3 + Math.min(11, Math.log(mo.list.length + 1) / Math.LN2 * 2.6);
        var alpha = 0.16 + Math.min(0.55, (mo.list.length / 60) * 0.55);
        g.strokeStyle = 'rgba(224,178,106,' + alpha.toFixed(2) + ')';
        g.lineWidth = 2;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x - len, y);
        g.lineTo(x, y);
        g.stroke();
      }
    },

    drawRail: function (onlyThumb) {
      var e = this.els();
      if (!e.canvas || !S.months.length) return;
      var W = e.rail.clientWidth || 30;
      var H = e.rail.clientHeight || 400;
      var dpr = Math.min(3, window.devicePixelRatio || 1);

      if (!onlyThumb || !T.railReady) {
        this.drawStatic(W, H, dpr);
        e.canvas.width = W * dpr;
        e.canvas.height = H * dpr;
        e.canvas.style.width = W + 'px';
        e.canvas.style.height = H + 'px';
        T.railReady = true;
      }

      var g = e.canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      if (T.railBg) g.drawImage(T.railBg, 0, 0, W, H);

      var p = e.scroll.scrollTop / Math.max(1, e.scroll.scrollHeight - e.scroll.clientHeight);
      p = U.clamp(p, 0, 1);
      var y = 8 + p * Math.max(1, H - 16);
      g.fillStyle = 'rgba(255,240,214,0.95)';
      g.beginPath();
      g.arc(W - 7, y, 3.2, 0, Math.PI * 2);
      g.fill();
    },

    bindRail: function () {
      var self = this;
      var e = this.els();
      var dragging = false;

      function scrub(clientY) {
        var g = self.railGeom();
        var ratio = U.clamp((clientY - g.r.top - g.top) / g.span, 0, 1);
        var target = ratio * Math.max(1, T.total);
        var i = self.locate(target);
        var mo = S.months[i];
        if (!mo) return;
        e.scroll.scrollTop = T.prefix[i];
        e.bubble.innerHTML = '<b>' + mo.y + '</b> 年 ' + mo.m + ' 月';
        e.bubble.style.top = (g.top + ratio * g.span) + 'px';
        e.bubble.classList.add('on');
        self.drawRail(true);
      }

      e.rail.addEventListener('pointerdown', function (ev) {
        dragging = true;
        try { e.rail.setPointerCapture(ev.pointerId); } catch (err) { }
        scrub(ev.clientY);
        ev.preventDefault();
      }, { passive: false });

      e.rail.addEventListener('pointermove', function (ev) {
        if (!dragging) return;
        scrub(ev.clientY);
        ev.preventDefault();
      }, { passive: false });

      function end(ev) {
        if (!dragging) return;
        dragging = false;
        setTimeout(function () { e.bubble.classList.remove('on'); }, 700);
      }
      e.rail.addEventListener('pointerup', end);
      e.rail.addEventListener('pointercancel', end);

      // 轻点光带空白处也可以跳
      e.rail.addEventListener('click', function (ev) {
        if (ev.detail === 0) return;
      });
    },

    jump: function (i) {
      var e = this.els();
      if (!S.months.length) return;
      i = U.clamp(i, 0, S.months.length - 1);
      e.scroll.scrollTop = T.prefix[i] || 0;
      this.paint(true);
      this.drawRail();
    },

    jumpYear: function (y) {
      for (var i = 0; i < S.months.length; i++) {
        if (S.months[i].y === y) {
          this.jump(i);
          App.toast(y + ' 年');
          return;
        }
      }
      App.toast('没有 ' + y + ' 年的回忆');
    },

    jumpToDate: function (ts) {
      for (var i = 0; i < S.months.length; i++) {
        var mo = S.months[i];
        if (mo.list.length && mo.list[0].t <= ts) { this.jump(i); return; }
      }
      this.jump(S.months.length - 1);
    },

    onResize: function () {
      var e = this.els();
      var key = S.months[T.cur] ? S.months[T.cur].key : null;
      T.geo = null;
      T.railReady = false;
      this.rebuild(key);
    }
  };

  window.TL = TL;
})();
