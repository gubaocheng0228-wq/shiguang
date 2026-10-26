'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_OK = new Set([
  'win:min', 'win:max', 'win:close', 'win:fullscreen',
  'cfg:get', 'cfg:pickLib', 'ui:set',
  'lib:rescan', 'lib:stats', 'lib:list', 'lib:onThisDay',
  'lib:histogram', 'lib:locate', 'lib:around', 'music:list',
  'photo:fav', 'photo:star', 'photo:edit', 'photo:rotate', 'photo:trash', 'photo:showInFolder',
  'album:list', 'album:create', 'album:rename', 'album:remove', 'album:addPhotos', 'album:removePhoto',
  'trash:list', 'trash:restore', 'trash:empty',
  'app:openData', 'app:openLib', 'smoke:report',
]);

const ON_OK = new Set(['lib:state', 'lib:progress', 'lib:error', 'lib:thumb', 'lib:thumbs-done', 'win:max-state', 'win:fullscreen-state']);

contextBridge.exposeInMainWorld('sg', {
  invoke: (channel, payload) => {
    if (!INVOKE_OK.has(channel)) return Promise.reject(new Error('未知通道: ' + channel));
    return ipcRenderer.invoke(channel, payload);
  },
  on: (channel, fn) => {
    if (!ON_OK.has(channel)) return () => {};
    const listener = (_e, arg) => fn(arg);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
