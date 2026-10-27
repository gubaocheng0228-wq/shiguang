/* 拾光 手机版 · 与原生层的唯一接口
   真正的实现在 MainActivity 的 JavascriptInterface（window.SG）；
   桌面浏览器调试时可以用 window.SGMOCK 顶替，接口保持一致。 */
(function () {
  'use strict';

  var sg = (typeof window.SG !== 'undefined' && window.SG) ? window.SG : null;
  var mock = window.SGMOCK || null;

  function call(name, args) {
    if (!sg || typeof sg[name] !== 'function') return null;
    try {
      return sg[name].apply(sg, args || []);
    } catch (e) {
      return null;
    }
  }

  function parse(s, fallback) {
    if (!s) return fallback;
    try { return JSON.parse(s); } catch (e) { return fallback; }
  }

  var env = {
    port: 0,
    base: '',
    granted: false,
    music: [],
    version: '1.0.0',
    sdk: 0,
    model: ''
  };

  var Backend = {
    native: !!sg,
    env: env,

    init: function () {
      if (sg) {
        env = parse(call('env'), env) || env;
      } else if (mock) {
        env = mock.env();
      }
      env.base = env.port ? ('http://127.0.0.1:' + env.port) : '';
      this.env = env;
      return env;
    },

    url: function (p) {
      return env.base + p;
    },

    thumb: function (id, w) {
      if (!sg && mock) return mock.thumb(id, w);
      return env.base + '/t/' + id + '?w=' + (w || 360) + '&v=2';
    },

    full: function (id) {
      if (!sg && mock) return mock.full(id);
      return env.base + '/f/' + id;
    },

    music: function (i) {
      if (!sg && mock) return mock.music(i);
      return env.base + '/m/' + i;
    },

    page: function (off, lim, filter) {
      if (!sg && mock) return mock.page(off, lim, filter);
      return parse(call('page', [off, lim, filter || 'all']), []);
    },

    stats: function () {
      if (!sg && mock) return mock.stats();
      return parse(call('stats'), { count: 0, images: 0, videos: 0, bytes: 0, minTs: 0, maxTs: 0, months: [] });
    },

    info: function (id) {
      if (!sg && mock) return mock.info(id);
      return parse(call('info', [id]), null);
    },

    askPermission: function () {
      if (!sg && mock) { mock.askPermission(); return; }
      call('askPermission');
    },

    granted: function () {
      if (!sg && mock) return !!mock.env().granted;
      var v = call('granted');
      return v === true || v === 'true';
    },

    checkUpdate: function (manual) {
      if (!sg && mock) { if (mock.checkUpdate) mock.checkUpdate(!!manual); return; }
      call('checkUpdate', [!!manual]);
    },
    downloadUpdate: function () { call('downloadUpdate'); },
    installUpdate: function () { call('installUpdate'); },
    updateState: function () { return parse(call('updateState'), null); },
    openSettings: function () { call('openSettings'); },
    rescan: function () { call('rescan'); },
    share: function (id) { call('share', [id]); },
    immersive: function (on) { call('immersive', [!!on]); },
    keepAwake: function (on) { call('keepAwake', [!!on]); },
    toast: function (m) { call('toast', [String(m)]); }
  };

  window.Backend = Backend;
})();
