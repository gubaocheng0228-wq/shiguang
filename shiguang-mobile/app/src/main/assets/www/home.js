/* 拾光 手机版 · 回忆首页 */
(function () {
  'use strict';

  var doc = document;
  function $(s, r) { return (r || doc).querySelector(s); }
  function on(n, e, f) { if (n) n.addEventListener(e, f); }

  var Home = {
    day: null,
    list: [],

    render: function () {
      if (!S.ready) return;
      Home.pick();
      Home.hero();
      Home.statsLine();
      Home.yearRow();
      Home.recent();
      hydrateIcons();
    },

    pick: function () {
      var now = new Date();
      var m = now.getMonth() + 1;
      var d = now.getDate();
      var groups = {};
      for (var i = 0; i < S.items.length; i++) {
        var it = S.items[i];
        var t = new Date(it.t);
        if (t.getMonth() + 1 !== m || t.getDate() !== d) continue;
        if (t.getFullYear() >= now.getFullYear()) continue;
        var y = t.getFullYear();
        (groups[y] = groups[y] || []).push(it);
      }
      var bestY = 0, bestN = 0;
      Object.keys(groups).sort(function (a, b) { return Number(b) - Number(a); }).forEach(function (y) {
        if (groups[y].length > bestN) { bestN = groups[y].length; bestY = Number(y); }
      });
      if (bestY) {
        Home.day = { y: bestY, list: groups[bestY] };
        Home.list = groups[bestY];
      } else {
        Home.day = null;
        Home.list = S.items.slice(0, 12);
      }
    },

    hero: function () {
      var cover = null;
      var kicker, title, sub;

      if (Home.day && Home.list.length) {
        var best = Home.list[0];
        for (var i = 0; i < Home.list.length; i++) {
          if (Home.list[i].k === 1) { best = Home.list[i]; break; }
        }
        cover = best;
        kicker = '那年今日';
        title = U.agoLabel(best.t);
        sub = U.fullLabel(best.t).replace(' · ', ' ') + ' · ' + U.num(Home.list.length) + ' 段回忆';
      } else if (S.items.length) {
        cover = S.items[0];
        kicker = '最新的回忆';
        title = U.mdLabel(cover.t);
        sub = U.fullLabel(cover.t).replace(' · ', ' ') + ' · 从这里往回看';
      } else {
        return;
      }

      var img = $('#hero-img');
      if (cover) {
        img.style.backgroundImage = 'url("' + Backend.thumb(cover.id, pxW()) + '")';
      }
      $('#hero-kicker').textContent = kicker;
      $('#hero-date').textContent = title;
      $('#hero-sub').textContent = sub;

      var thumbs = $('#hero-thumbs');
      thumbs.innerHTML = '';
      for (var j = 0; j < Math.min(3, Home.list.length); j++) {
        var t = doc.createElement('i');
        t.style.backgroundImage = 'url("' + Backend.thumb(Home.list[j].id, 160) + '")';
        thumbs.appendChild(t);
      }
      thumbs.hidden = Home.list.length < 2;
    },

    statsLine: function () {
      var s = S.stats || {};
      var box = $('#home-stats');
      var minY = s.minTs ? new Date(s.minTs).getFullYear() : '';
      var maxY = s.maxTs ? new Date(s.maxTs).getFullYear() : '';
      var span = minY && maxY ? (minY === maxY ? minY + ' 年' : minY + ' — ' + maxY) : '';
      box.textContent = U.num(s.images || 0) + ' 张照片 · ' + U.num(s.videos || 0) + ' 段视频' + (span ? ' · ' + span : '');
    },

    yearRow: function () {
      var row = $('#yearrow');
      row.innerHTML = '';
      $('#years-hint').textContent = S.years.length ? S.years.length + ' 年' : '';
      for (var i = 0; i < S.years.length; i++) {
        (function (y) {
          var c = doc.createElement('button');
          c.className = 'ycard';
          c.type = 'button';
          var b = doc.createElement('div');
          b.className = 'yb';
          b.style.backgroundImage = 'url("' + Backend.thumb(y.cover.id, 360) + '")';
          c.appendChild(b);
          c.appendChild(doc.createElement('div')).className = 'ys';
          var yb = doc.createElement('b');
          yb.textContent = y.y;
          c.appendChild(yb);
          var sp = doc.createElement('span');
          sp.textContent = U.num(y.n) + (y.videos && y.videos === y.n ? ' 段视频' : ' 段');
          c.appendChild(sp);
          on(c, 'click', function () {
            App.go('timeline');
            setTimeout(function () { TL.jumpYear(y.y); }, 80);
          });
          row.appendChild(c);
        })(S.years[i]);
      }
    },

    recent: function () {
      var grid = $('#recent-grid');
      grid.innerHTML = '';
      var n = Math.min(12, S.items.length);
      for (var i = 0; i < n; i++) grid.appendChild(App.tile(S.items[i], 360));
    },

    review: function () {
      if (!Home.list.length) return;
      VW.open(Home.list, 0);
    },

    play: function () {
      if (!Home.list.length) return;
      SS.start(Home.list, 0);
    },

    shuffle: function () {
      if (!S.items.length) return;
      var n = Math.min(120, S.items.length);
      var pool = S.items.slice(0, n);
      for (var i = pool.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      SS.start(pool, 0);
    }
  };

  window.Home = Home;
})();
