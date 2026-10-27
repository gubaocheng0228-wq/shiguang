/* 拾光 手机版 · 骨架：状态、数据装载、路由、面板、引导 */
(function () {
  'use strict';

  var doc = document;

  function $(sel, root) { return (root || doc).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function on(node, ev, fn, opt) { if (node) node.addEventListener(ev, fn, opt); }

  /* ---------------------------------------------------------------- 工具 */

  var U = {
    ym: function (ts) {
      var d = new Date(ts);
      return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), w: d.getDay() };
    },
    ymLabel: function (ts) { var t = U.ym(ts); return t.y + ' 年 ' + t.m + ' 月'; },
    mdLabel: function (ts) { var t = U.ym(ts); return t.m + ' 月 ' + t.d + ' 日'; },
    mdShort: function (ts) { var t = U.ym(ts); return t.m + '/' + t.d; },
    fullLabel: function (ts) {
      var t = U.ym(ts);
      var wk = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][t.w];
      return t.y + ' 年 ' + t.m + ' 月 ' + t.d + ' 日 · ' + wk;
    },
    agoLabel: function (ts) {
      var t = U.ym(ts), now = new Date();
      var n = now.getFullYear() - t.y;
      if (n <= 0) return '今年';
      return n === 1 ? '去年今天' : n + ' 年前的今天';
    },
    dur: function (ms) {
      var s = Math.round((ms || 0) / 1000);
      var m = Math.floor(s / 60);
      s = s % 60;
      if (m >= 60) {
        var h = Math.floor(m / 60);
        return h + ':' + (m % 60 < 10 ? '0' : '') + (m % 60) + ':' + (s < 10 ? '0' : '') + s;
      }
      return m + ':' + (s < 10 ? '0' : '') + s;
    },
    bytes: function (n) {
      n = n || 0;
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
      if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
      return (n / 1073741824).toFixed(2) + ' GB';
    },
    num: function (n) {
      try { return Number(n).toLocaleString('en-US'); } catch (e) { return String(n); }
    },
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); }
  };

  function colsFor(w) {
    if (w >= 880) return 6;
    if (w >= 620) return 5;
    if (w >= 470) return 4;
    return 3;
  }
  window.colsFor = colsFor;

  /** 屏幕物理像素宽度：大图按这个尺寸取，才不会在高分屏上发虚。 */
  function pxW() {
    var dpr = Math.min(3, window.devicePixelRatio || 2);
    var px = Math.round((window.innerWidth || 393) * dpr);
    if (px < 640) px = 640;
    if (px > 2160) px = 2160;
    return px;
  }
  window.pxW = pxW;

  function applyCols() {
    var n = colsFor(window.innerWidth || document.documentElement.clientWidth || 393);
    document.documentElement.style.setProperty('--cols', n);
    return n;
  }
  window.applyCols = applyCols;

  var LS = {
    get: function (k, d) {
      try {
        var v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { }
    }
  };

  /* ---------------------------------------------------------------- 状态 */

  var S = {
    items: [],
    byId: {},
    view: [],
    months: [],
    years: [],
    stats: null,
    music: [],
    filter: 'all',
    q: '',
    page: 'home',
    ready: false,
    cfg: { music: true, speed: 6000, zoom: true, tour: false },
    favSet: null,
    hideSet: null,
    insets: { t: 0, b: 0, l: 0, r: 0 }
  };
  S.update = { state: 'idle' };
  window.S = S;
  window.U = U;
  window.LS = LS;

  /* ---------------------------------------------------------------- 外壳 */

  var App = {
    $: $, $$: $$, el: el, U: U, LS: LS,
    sheetOpen: false,

    boot: function () {
      hydrateIcons();

      S.cfg = Object.assign({ music: true, speed: 6000, zoom: true, tour: false }, LS.get('sg.cfg', {}) || {});
      S.favSet = {};
      (LS.get('sg.fav', []) || []).forEach(function (id) { S.favSet[id] = 1; });
      S.hideSet = {};
      (LS.get('sg.hide', []) || []).forEach(function (id) { S.hideSet[id] = 1; });

      App.insetHook();

      var env = Backend.init();
      S.music = env.music || [];
      S.version = env.version || '1.0.0';
      $('#gate-ver').textContent = S.version;
      $('#me-ver').textContent = S.version;

      applyCols();
      App.bindShell();
      App.bindDock();

      if (!env.granted) {
        App.gate('perm');
        App.hideSplash(400);
        return;
      }
      App.load();
    },

    insetHook: function () {
      var root = doc.documentElement;
      window.__inset = function (t, b, l, r, kb) {
        S.insets = { t: t || 0, b: b || 0, l: l || 0, r: r || 0 };
        root.style.setProperty('--it', (t || 0) + 'px');
        root.style.setProperty('--ib', (b || 0) + 'px');
        root.style.setProperty('--il', (l || 0) + 'px');
        root.style.setProperty('--ir', (r || 0) + 'px');
        root.style.setProperty('--kb', (kb || 0) + 'px');
      };
      var in0 = (Backend.env && Backend.env.insets) || null;
      if (in0) window.__inset(in0[0], in0[1], in0[2], in0[3], 0);
    },

    hideSplash: function (delay) {
      setTimeout(function () {
        var sp = $('#splash');
        if (!sp) return;
        sp.classList.add('out');
        setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 700);
      }, delay || 0);
    },

    splashText: function (t) {
      var s = $('.sp-sub');
      if (s) s.textContent = t;
    },

    /* ------------------------------------------------------------ 装载 */

    load: function () {
      var stats;
      try {
        stats = Backend.stats();
      } catch (e) {
        App.gate('error');
        App.hideSplash(200);
        return;
      }
      S.stats = stats;

      if (!stats || !stats.count) {
        App.gate('empty');
        App.hideSplash(300);
        return;
      }

      App.splashText('正在读相册…');
      var out = [];
      var off = 0;
      var LIM = 400;
      var guard = 0;

      function step() {
        var batch;
        try {
          batch = Backend.page(off, LIM, 'all');
        } catch (e) {
          batch = null;
        }
        if (!batch) {
          App.gate('error');
          App.hideSplash(200);
          return;
        }
        for (var i = 0; i < batch.length; i++) out.push(batch[i]);
        off += batch.length;
        if (batch.length && off < stats.count && guard++ < 400) {
          App.splashText('正在读相册… ' + U.num(out.length) + ' / ' + U.num(stats.count));
          setTimeout(step, 0);
        } else {
          App.finish(out);
        }
      }
      step();
    },

    finish: function (all) {
      var items = [];
      for (var i = 0; i < all.length; i++) {
        var it = all[i];
        if (S.hideSet[it.id]) continue;
        items.push(it);
        S.byId[it.id] = it;
      }
      S.items = items;
      S.ready = true;
      $('#shell').hidden = false;
      App.reindex();
      App.go('home', true);
      App.hideSplash(120);
      if (S.cfg.autoUpdate !== false) {
        setTimeout(function () { Backend.checkUpdate(false); }, 2500);
      }
      if (!S.cfg.tour) setTimeout(function () { App.tour(); }, 900);
    },

    reindex: function () {
      var f = S.filter === 'all' ? null : S.filter;
      var q = (S.q || '').trim().toLowerCase();
      var view = [];
      var i, it;
      for (i = 0; i < S.items.length; i++) {
        it = S.items[i];
        if (f === 'image' && it.k !== 1) continue;
        if (f === 'video' && it.k !== 2) continue;
        if (f === 'fav' && !S.favSet[it.id]) continue;
        if (q && !App.match(it, q)) continue;
        view.push(it);
      }
      S.view = view;

      var months = [];
      var years = [];
      var cur = null;
      var ymap = {};
      for (i = 0; i < view.length; i++) {
        it = view[i];
        var d = new Date(it.t);
        var y = d.getFullYear();
        var m = d.getMonth() + 1;
        var key = y * 100 + m;
        if (!cur || cur.key !== key) {
          cur = { key: key, y: y, m: m, list: [] };
          months.push(cur);
          if (!ymap[y]) {
            ymap[y] = { y: y, n: 0, cover: it, months: 0, videos: 0 };
            years.push(ymap[y]);
          }
          ymap[y].months++;
        }
        cur.list.push(it);
        ymap[y].n++;
        if (it.k === 2) ymap[y].videos++;
      }
      S.months = months;
      S.years = years;
    },

    match: function (it, q) {
      if (!q) return true;
      if ((it.n || '').toLowerCase().indexOf(q) >= 0) return true;
      var d = new Date(it.t);
      var y = String(d.getFullYear());
      var m = d.getMonth() + 1;
      var dd = d.getDate();
      var s1 = y + (m < 10 ? '0' : '') + m;
      var s2 = y + '-' + (m < 10 ? '0' : '') + m;
      if (s1.indexOf(q) === 0 || s2.indexOf(q) === 0) return true;
      if ((m + '月') === q || (m + '月' + dd + '日') === q || (m + '月' + dd) === q) return true;
      if ((m + '/' + dd) === q) return true;
      if (y === q) return true;
      return false;
    },

    setFilter: function (f) {
      if (S.filter === f) return;
      S.filter = f;
      $$('#chips .chip').forEach(function (b) { b.classList.toggle('on', b.dataset.f === f); });
      App.reindex();
      if (S.page === 'timeline') TL.rebuild();
      if (S.page === 'home') Home.render();
    },

    /* ------------------------------------------------------------ 路由 */

    go: function (p, force) {
      if (S.page === p && !force) return;
      S.page = p;
      $$('.page').forEach(function (sec) {
        var on = sec.dataset.page === p;
        sec.hidden = !on;
        if (on) {
          sec.classList.remove('animate-in');
          void sec.offsetWidth;
          sec.classList.add('animate-in');
        }
      });
      $$('.dock-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.nav === p); });
      $('#chips').hidden = p !== 'timeline';

      var title = $('#bar-title');
      var sub = $('#bar-sub');
      if (p === 'home') {
        title.textContent = '拾光';
        title.classList.add('wordmark');
        sub.textContent = U.mdLabel(Date.now());
        Home.render();
      } else if (p === 'timeline') {
        title.textContent = '时间线';
        title.classList.remove('wordmark');
        sub.textContent = U.num(S.view.length) + ' 段回忆';
        TL.enter();
      } else if (p === 'fav') {
        title.textContent = '收藏';
        title.classList.remove('wordmark');
        sub.textContent = U.num(Object.keys(S.favSet).length) + ' 张';
        App.renderFav();
      } else {
        title.textContent = '我的';
        title.classList.remove('wordmark');
        sub.textContent = '';
        App.renderMe();
      }
      $('#bar').classList.toggle('solid', p !== 'home');
      App.hydrateAll();
    },

    hydrateAll: function () { hydrateIcons(); },

    /* ------------------------------------------------------------ 授权页 */

    gate: function (kind) {
      var g = $('#gate');
      g.hidden = false;
      var title = $('#gate-title');
      var text = $('#gate-text');
      var stats = $('#gate-stats');
      var allow = $('#gate-allow');
      var set = $('#gate-settings');
      var later = $('#gate-later');

      stats.hidden = true;
      allow.hidden = false;
      set.hidden = true;
      later.hidden = false;

      if (kind === 'perm') {
        var denied = LS.get('sg.permAsked', false);
        title.textContent = denied ? '还差一步：允许访问相册' : '先看一眼你的相册';
        text.textContent = denied
          ? '刚才的系统弹窗被关掉了。点下面的按钮再试一次；如果一直不出现弹窗，就到系统设置里手动打开「照片和视频」权限。'
          : '拾光只读取这台手机里的照片和视频，不联网、不上传。缩略图和索引都放在本机的缓存里，随时可以清掉。';
        allow.textContent = denied ? '再试一次' : '允许访问相册';
        if (denied) set.hidden = false;
        later.textContent = '先看看界面';
        later.hidden = true;
      } else if (kind === 'empty') {
        title.textContent = '相册里还没有照片';
        text.textContent = '用手机拍几张，或者把照片拷进相册，再回来点一下「重新扫描」。拾光不会修改或移动你的任何文件。';
        allow.textContent = '重新扫描';
        later.hidden = true;
      } else {
        title.textContent = '读不到相册';
        text.textContent = '系统没让拾光读取相册（可能是权限被收回，或者存储暂时不可用）。可以到系统设置里检查权限，然后重试。';
        allow.textContent = '重新扫描';
        set.hidden = false;
        later.hidden = true;
      }

      // 用 onclick 覆盖，避免反复进入授权页时叠加多个监听
      allow.onclick = function () {
        if (kind === 'perm') {
          LS.set('sg.permAsked', true);
          Backend.askPermission();
        } else {
          location.reload();
        }
      };
      set.onclick = function () { Backend.openSettings(); };
    },

    onPerm: function (ok) {
      if (ok) {
        $('#gate').hidden = true;
        S.ready = false;
        Backend.rescan();
        App.load();
      } else {
        App.gate('perm');
      }
    },

    /* ------------------------------------------------------------ 收藏/隐藏 */

    isFav: function (id) { return !!S.favSet[id]; },

    toggleFav: function (id) {
      if (S.favSet[id]) delete S.favSet[id];
      else S.favSet[id] = 1;
      LS.set('sg.fav', Object.keys(S.favSet).map(Number));
      var it = S.byId[id];
      App.toast(S.favSet[id] ? '已收藏' : '已取消收藏');
      if (it) { App.reindex(); }
      if (S.page === 'fav') App.renderFav();
      return !!S.favSet[id];
    },

    hide: function (id) {
      S.hideSet[id] = 1;
      LS.set('sg.hide', Object.keys(S.hideSet).map(Number));
      S.items = S.items.filter(function (x) { return x.id !== id; });
      delete S.byId[id];
      App.reindex();
      App.toast('已隐藏，可在「我的 → 已隐藏」里恢复');
    },

    renderFav: function () {
      var grid = $('#fav-grid');
      var list = S.items.filter(function (it) { return S.favSet[it.id]; });
      grid.innerHTML = '';
      $('#fav-empty').hidden = list.length > 0;
      $('#fav-sub').textContent = list.length ? U.num(list.length) + ' 段回忆' : '还没有标心的照片';
      for (var i = 0; i < list.length; i++) grid.appendChild(App.tile(list[i], 360));
      App.hydrateAll();
    },

    renderMe: function () {
      var ok = Backend.granted();
      var perm = $('#li-perm');
      perm.classList.toggle('bad', !ok);
      $('#perm-state').textContent = ok ? '已允许' : '未允许，点这里打开';
      if (S.music.length) {
        $('#music-names').textContent = S.music.map(function (m) { return m.title; }).join(' · ');
      } else {
        $('#music-names').textContent = '未内置音乐';
      }
      $('#sw-music').checked = !!S.cfg.music;
      $('#sw-zoom').checked = !!S.cfg.zoom;
      $$('#seg-speed button').forEach(function (b) {
        b.classList.toggle('on', Number(b.dataset.v) === Number(S.cfg.speed));
      });
      $('#update-state').textContent = App.updateText();
      $('#li-update').classList.toggle('hot', S.update && S.update.state === 'found');
      $('#hidden-n').textContent = Object.keys(S.hideSet).length;
      var s = S.stats || { images: 0, videos: 0 };
      $('#me-line').textContent = U.num(s.images) + ' 张照片 · ' + U.num(s.videos) + ' 段视频';
    },

    /* ------------------------------------------------------------ 元素工厂 */

    tile: function (it, w, opts) {
      opts = opts || {};
      var b = doc.createElement('div');
      b.className = 'tile' + (opts.cls ? ' ' + opts.cls : '');
      b.dataset.id = it.id;

      var img = doc.createElement('img');
      img.decoding = 'async';
      img.alt = '';
      img.src = Backend.thumb(it.id, w || 320);
      img.addEventListener('load', function () { img.classList.add('on'); }, { once: true });
      img.addEventListener('error', function () {
        img.classList.add('on');
        b.style.background = 'linear-gradient(150deg,#1b2130,#12161f)';
      }, { once: true });
      b.appendChild(img);

      if (it.k === 2) {
        var play = el('span', 'tplay');
        play.innerHTML = iconSvg('play');
        b.appendChild(play);
        if (it.d) b.appendChild(el('span', 'tdur', U.dur(it.d)));
      }
      return b;
    },

    /* ------------------------------------------------------------ 面板 */

    sheet: function (html, cls) {
      var sh = $('#sheet');
      var bg = $('#sheet-bg');
      $('#sheet-body').innerHTML = html;
      sh.className = 'sheet' + (cls ? ' ' + cls : '');
      sh.hidden = false;
      bg.hidden = false;
      App.sheetOpen = true;
      hydrateIcons(sh);
      requestAnimationFrame(function () {
        sh.classList.add('on');
        bg.classList.add('on');
      });
      on(bg, 'click', App.closeSheet);
    },

    closeSheet: function () {
      var sh = $('#sheet');
      var bg = $('#sheet-bg');
      if (!App.sheetOpen) return;
      App.sheetOpen = false;
      sh.classList.remove('on');
      bg.classList.remove('on');
      setTimeout(function () {
        if (App.sheetOpen) return;
        sh.hidden = true;
        bg.hidden = true;
        $('#sheet-body').innerHTML = '';
      }, 320);
    },

    toastTimer: 0,
    toast: function (msg, ms) {
      var t = $('#toast');
      t.textContent = msg;
      t.hidden = false;
      requestAnimationFrame(function () { t.classList.add('on'); });
      clearTimeout(App.toastTimer);
      App.toastTimer = setTimeout(function () {
        t.classList.remove('on');
        setTimeout(function () { t.hidden = true; }, 300);
      }, ms || 1900);
    },

    /* ------------------------------------------------------------ 事件 */

    bindShell: function () {
      on($('#btn-search'), 'click', App.searchSheet);
      on($('#btn-more'), 'click', App.menuSheet);

      $$('#chips .chip').forEach(function (b) {
        on(b, 'click', function () { App.setFilter(b.dataset.f); });
      });

      // 首页
      on($('#hero-review'), 'click', function () { Home.review(); });
      on($('#hero-play'), 'click', function () { Home.play(); });
      on($('#hero-shuffle'), 'click', function () { Home.shuffle(); });
      on($('#recent-all'), 'click', function () { App.go('timeline'); });

      // 我的
      on($('#li-perm'), 'click', function () {
        if (Backend.granted()) Backend.openSettings();
        else Backend.askPermission();
      });
      on($('#li-rescan'), 'click', function () {
        Backend.rescan();
        App.gateRefresh();
      });
      on($('#sw-music'), 'change', function (e) {
        S.cfg.music = e.target.checked;
        LS.set('sg.cfg', S.cfg);
        App.toast(S.cfg.music ? '放映时会播放背景音乐' : '已关闭背景音乐');
      });
      on($('#sw-zoom'), 'change', function (e) {
        S.cfg.zoom = e.target.checked;
        LS.set('sg.cfg', S.cfg);
      });
      $$('#seg-speed button').forEach(function (b) {
        on(b, 'click', function () {
          S.cfg.speed = Number(b.dataset.v);
          LS.set('sg.cfg', S.cfg);
          App.renderMe();
        });
      });
      on($('#li-update'), 'click', App.updateSheet);
      on($('#li-hidden'), 'click', App.hiddenSheet);
      on($('#li-tour'), 'click', function () { App.tour(true); });

      // 全局委托：点击方格
      doc.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('.tile') : null;
        if (!t) return;
        var id = Number(t.dataset.id);
        var host = t.parentNode;
        var grid = t.closest('.grid, .tl-g');
        if (!grid) return;
        var items = [];
        var kids = grid.querySelectorAll('.tile');
        for (var i = 0; i < kids.length; i++) {
          var x = S.byId[Number(kids[i].dataset.id)];
          if (x) items.push(x);
        }
        if (!items.length) return;
        var at = 0;
        for (var j = 0; j < items.length; j++) if (items[j].id === id) { at = j; break; }
        // 月分块里的方格只在本月内翻页，时间线整屏时补齐相邻月份
        if (grid.classList.contains('tl-g')) {
          var blk = grid.parentNode;
          var mk = blk && blk.dataset.key ? Number(blk.dataset.key) : 0;
          var mo = S.months.filter(function (x) { return x.key === mk; })[0];
          if (mo) { items = mo.list; at = Math.max(0, mo.list.findIndex(function (x) { return x.id === id; })); }
        }
        VW.open(items, at);
      }, true);
    },

    gateRefresh: function () {
      App.toast('正在重新扫描…');
      location.reload();
    },

    bindDock: function () {
      $$('.dock-btn').forEach(function (b) {
        on(b, 'click', function () { App.go(b.dataset.nav); });
      });
      on($('#dock-play'), 'click', function () { App.startShow(); });
    },

    startShow: function (from) {
      var list = from && from.length ? from : (S.view.length ? S.view : S.items);
      if (!list.length) { App.toast('还没有可以放映的照片'); return; }
      var at = 0;
      if (!from && S.page === 'timeline' && TL.currentItem) {
        var k = list.indexOf(TL.currentItem);
        if (k >= 0) at = k;
      }
      SS.start(list, at);
    },

    /* ------------------------------------------------------------ 更新 */

    updateText: function () {
      var u = S.update || {};
      switch (u.state) {
        case 'checking': return '检查中…';
        case 'latest': return '已是最新';
        case 'found': return '新版本 ' + (u.ver || '');
        case 'downloading': return '下载中 ' + (u.pct || 0) + '%';
        case 'ready': return '可安装';
        case 'needPermission': return '需要允许安装';
        case 'error': return '检查失败';
        default: return '未检查';
      }
    },

    updateSheet: function () {
      var u = S.update || {};
      var html = '<h3 class="sh-title">检查更新</h3>';
      html += '<div class="kv"><b>当前版本</b><span>' + (u.curName || S.version || '1.0.2') + '</span></div>';

      if (u.state === 'found' || u.state === 'downloading' || u.state === 'ready' || u.state === 'needPermission') {
        html += '<div class="kv"><b>新版本</b><span>' + (u.ver || '') + '</span></div>';
        if (u.size) html += '<div class="kv"><b>大小</b><span>' + U.bytes(u.size) + '</span></div>';
        if (u.notes) {
          html += '<div class="kv"><b>更新内容</b><span>' + String(u.notes).replace(/</g, '&lt;') + '</span></div>';
        }
      }

      if (u.state === 'checking') {
        html += '<p class="sh-note">正在检查…</p>';
      } else if (u.state === 'latest') {
        html += '<p class="sh-note">已经是最新版本了。</p>';
      } else if (u.state === 'downloading') {
        html += '<div class="upbar"><i style="width:' + (u.pct || 0) + '%"></i></div>';
        html += '<p class="sh-note">正在下载 ' + (u.pct || 0) + '% ，请保持网络，别退出。</p>';
      } else if (u.state === 'ready') {
        html += '<p class="sh-note">下载完成，点下面安装。安装时系统会弹一次确认。</p>';
      } else if (u.state === 'needPermission') {
        html += '<p class="sh-note">系统需要你允许「安装未知应用」。已经帮你跳到设置页，打开开关后回来点安装。</p>';
      } else if (u.state === 'error') {
        html += '<p class="sh-note">' + String(u.msg || '检查失败').replace(/</g, '&lt;') + '</p>';
      } else {
        html += '<p class="sh-note">从服务器获取最新版本信息。</p>';
      }

      if (u.state === 'found') html += '<button class="btn gold wide" id="up-do" type="button">下载并更新</button>';
      if (u.state === 'ready' || u.state === 'needPermission') {
        html += '<button class="btn gold wide" id="up-install" type="button">安装新版本</button>';
      }
      html += '<button class="btn glass wide" id="up-check" type="button">重新检查</button>';

      App.sheet(html);

      var doBtn = $('#up-do');
      if (doBtn) doBtn.onclick = function () { Backend.downloadUpdate(); };
      var insBtn = $('#up-install');
      if (insBtn) insBtn.onclick = function () { Backend.installUpdate(); };
      $('#up-check').onclick = function () {
        S.update = { state: 'checking', curName: (S.update || {}).curName };
        App.updateSheet();
        Backend.checkUpdate(true);
      };
    },

    /* ------------------------------------------------------------ 搜索 */

    searchSheet: function () {
      App.sheet(
        '<h3 class="sh-title">搜索</h3>' +
        '<div class="searchbox"><span class="ic i-search"></span>' +
        '<input id="q-input" type="search" placeholder="名称或日期，如 2026 / 1027 / 10月" autocomplete="off" spellcheck="false"></div>' +
        '<div id="q-list" style="margin-top:12px"></div>'
      );
      var input = $('#q-input');
      var list = $('#q-list');
      setTimeout(function () { input.focus(); }, 320);

      function render() {
        var q = input.value.trim().toLowerCase();
        list.innerHTML = '';
        if (!q) {
          list.innerHTML = '<p class="sh-note">试试输入年份「2026」、月日「1027」或者照片名的一部分。</p>';
          return;
        }
        var hits = S.items.filter(function (it) { return App.match(it, q); }).slice(0, 60);
        if (!hits.length) {
          list.innerHTML = '<p class="sh-note">没有找到匹配的回忆。</p>';
          return;
        }
        var g = el('div', 'grid');
        for (var i = 0; i < hits.length; i++) g.appendChild(App.tile(hits[i], 300));
        list.appendChild(g);
        var p = el('p', 'sh-note', '共 ' + U.num(hits.length) + ' 段' + (hits.length >= 60 ? '（只显示前 60）' : ''));
        list.appendChild(p);
        App.hydrateAll();
      }
      on(input, 'input', render);
      render();
    },

    /* ------------------------------------------------------------ 菜单 */

    menuSheet: function () {
      var isTl = S.page === 'timeline';
      App.sheet(
        '<h3 class="sh-title">' + (isTl ? '时间线' : '拾光') + '</h3>' +
        '<button class="sh-row" id="m-show"><span class="ic i-play"></span>开始放映<small>含背景音乐</small></button>' +
        '<button class="sh-row" id="m-year"><span class="ic i-cal"></span>按年份跳转<small>' + (S.years.length ? S.years[S.years.length - 1].y + '—' + S.years[0].y : '') + '</small></button>' +
        (isTl ? '<button class="sh-row" id="m-top"><span class="ic i-arrow-down"></span>回到最新</button>' : '') +
        '<button class="sh-row" id="m-tour"><span class="ic i-sparkles"></span>功能引导</button>' +
        '<button class="sh-row" id="m-about"><span class="ic i-shield"></span>关于拾光</button>'
      );
      on($('#m-show'), 'click', function () { App.closeSheet(); setTimeout(App.startShow, 200); });
      on($('#m-year'), 'click', function () { App.closeSheet(); setTimeout(App.yearSheet, 180); });
      on($('#m-tour'), 'click', function () { App.closeSheet(); setTimeout(function () { App.tour(true); }, 200); });
      on($('#m-about'), 'click', function () { App.closeSheet(); setTimeout(App.aboutSheet, 180); });
      var top = $('#m-top');
      if (top) on(top, 'click', function () { App.closeSheet(); TL.jump(0); });
    },

    yearSheet: function () {
      var html = '<h3 class="sh-title">跳到哪一年</h3>';
      for (var i = 0; i < S.years.length; i++) {
        var y = S.years[i];
        html += '<button class="sh-row" data-y="' + y.y + '"><span class="ic i-cal"></span>' + y.y + ' 年<small>' + U.num(y.n) + ' 段</small></button>';
      }
      App.sheet(html);
      $$('#sheet-body .sh-row').forEach(function (b) {
        on(b, 'click', function () {
          var y = Number(b.dataset.y);
          App.closeSheet();
          App.go('timeline');
          setTimeout(function () { TL.jumpYear(y); }, 120);
        });
      });
    },

    aboutSheet: function () {
      App.sheet(
        '<h3 class="sh-title">关于拾光</h3>' +
        '<div class="kv"><b>版本</b><span>手机版 ' + (S.version || '1.0.0') + '</span></div>' +
        '<div class="kv"><b>相册</b><span>' + U.num((S.stats && S.stats.images) || 0) + ' 张照片 · ' + U.num((S.stats && S.stats.videos) || 0) + ' 段视频</span></div>' +
        '<div class="kv"><b>占用</b><span>' + U.bytes((S.stats && S.stats.bytes) || 0) + '</span></div>' +
        '<div class="kv"><b>最早的回忆</b><span>' + ((S.stats && S.stats.minTs) ? U.ymLabel(S.stats.minTs) : '—') + '</span></div>' +
        '<p class="sh-note">拾光只是一个「看照片的窗口」：它读取系统相册，不复制、不修改、不上传。没有账号，也没有云端。所有缩略图都是本机现做的，清掉应用缓存会重新生成。</p>'
      );
    },

    hiddenSheet: function () {
      var ids = Object.keys(S.hideSet).map(Number);
      var html = '<h3 class="sh-title">已隐藏 ' + ids.length + ' 张</h3>';
      if (!ids.length) html += '<p class="sh-note">这里只影响拾光里显示的照片，手机相册里的文件一个都没动。</p>';
      else {
        for (var i = 0; i < ids.length; i++) {
          html += '<button class="sh-row" data-restore="' + ids[i] + '"><span class="ic i-eyeoff"></span>恢复显示<small>#' + ids[i] + '</small></button>';
        }
        html += '<p class="sh-note">恢复后回到时间线里。文件本身一直在系统相册中，拾光从不改文件。</p>';
      }
      App.sheet(html);
      $$('#sheet-body .sh-row').forEach(function (b) {
        on(b, 'click', function () {
          var id = Number(b.dataset.restore);
          delete S.hideSet[id];
          LS.set('sg.hide', Object.keys(S.hideSet).map(Number));
          App.closeSheet();
          App.toast('已恢复，正在重新读取…');
          setTimeout(function () { location.reload(); }, 600);
        });
      });
    },

    /* ------------------------------------------------------------ 引导 */

    tourIndex: 0,
    tourSteps: [
      {
        art: '✦',
        h: '照片都在这台手机里',
        p: '拾光不联网、不注册账号。它只是把系统相册里的照片和视频，按时间排成一条可以往回走的长廊。'
      },
      {
        art: '⌛',
        h: '往上游，就是往回走',
        p: '时间线按年月排好，右侧那条细细的光带是「记忆密度」：手指按上去滑动，就能一步跨过好几年。'
      },
      {
        art: '♪',
        h: '全屏放映，配着歌',
        p: '点底部中间的金色按钮，照片会一张一张慢慢淡入、轻轻推近，配着《好想我回来啊》和《花落时相遇》。点一下屏幕暂停，往下滑退出。'
      },
      {
        art: '♡',
        h: '喜欢的，标个心',
        p: '大图里点一下心形就收进「收藏」。想专注看某几个月，用时间线顶部的筛选；不想看的照片可以「隐藏」，文件不会被动到。'
      }
    ],

    tour: function (manual) {
      App.tourIndex = 0;
      App.manualTour = !!manual;
      $('#tour').hidden = false;
      App.renderTour();
    },

    renderTour: function () {
      var st = App.tourSteps[App.tourIndex];
      var last = App.tourIndex === App.tourSteps.length - 1;
      $('#tour-art').textContent = st.art;
      $('#tour-h').textContent = st.h;
      $('#tour-p').textContent = st.p;
      var dots = $('#tour-dots');
      dots.innerHTML = '';
      for (var i = 0; i < App.tourSteps.length; i++) {
        var d = el('i');
        if (i === App.tourIndex) d.className = 'on';
        dots.appendChild(d);
      }
      $('#tour-next').textContent = last ? '开始用' : '下一步';
      $('#tour-allow').hidden = !(last && !Backend.granted());
      $('#tour-skip').onclick = App.endTour;
      $('#tour-next').onclick = function () {
        if (last) { App.endTour(); return; }
        App.tourIndex++;
        App.renderTour();
      };
      $('#tour-allow').onclick = function () {
        LS.set('sg.permAsked', true);
        Backend.askPermission();
      };
    },

    endTour: function () {
      $('#tour').hidden = true;
      if (!App.manualTour) {
        S.cfg.tour = true;
        LS.set('sg.cfg', S.cfg);
      }
    }
  };

  window.App = App;

  /* -------------------------------------------------------------- 启动 */

  window.SGPerm = function (ok) { App.onPerm(!!ok); };

  // 原生更新器的状态回调
  window.SGUpdate = function (o) {
    if (!o) return;
    var prev = (S.update && S.update.state) || '';
    S.update = o;
    if (S.page === 'me') {
      $('#update-state').textContent = App.updateText();
      $('#li-update').classList.toggle('hot', o.state === 'found');
    }
    if (App.sheetOpen && o.state !== prev) App.updateSheet();
    if (o.state === 'downloading' && App.sheetOpen) {
      var bar = document.querySelector('.upbar i');
      if (bar) bar.style.width = (o.pct || 0) + '%';
      var note = document.querySelector('#sheet-body .sh-note');
      if (note) note.textContent = '正在下载 ' + (o.pct || 0) + '% ，请保持网络，别退出。';
    }
    if (o.state === 'found' && prev !== 'found') {
      App.toast('发现新版本 ' + (o.ver || '') + '，去「我的 → 检查更新」升级', 3200);
    }
    if (o.state === 'ready' && prev !== 'ready') {
      App.toast('新版本已下载，去「我的 → 检查更新」安装', 3000);
    }
  };

  window.SGBack = function () {
    if (App.sheetOpen) { App.closeSheet(); return true; }
    if (window.VW && VW.isOpen()) { VW.close(); return true; }
    if (window.SS && SS.isOpen()) { SS.stop(); return true; }
    if (S.page !== 'home') { App.go('home'); return true; }
    return false;
  };

  window.addEventListener('load', function () {
    try {
      App.boot();
    } catch (e) {
      var g = document.getElementById('gate');
      var t = document.getElementById('gate-title');
      var x = document.getElementById('gate-text');
      if (g) g.hidden = false;
      if (t) t.textContent = '启动时出错了';
      if (x) x.textContent = String(e && e.message ? e.message : e);
    }
  });

  window.addEventListener('resize', function () {
    applyCols();
    if (window.TL && S.page === 'timeline') TL.onResize();
  });
})();
