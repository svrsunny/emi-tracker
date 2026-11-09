/**
 * Preload bridge: exposes a tiny, whitelisted API to the sandboxed renderer. The renderer
 * can only call the channels listed here and subscribe to the listed events.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const INVOKE = [
  'data:load', 'loan:save', 'loan:status', 'loan:delete', 'payment:save', 'payment:reverse', 'adjustment:save', 'adjustment:delete',
  'reminder:save', 'reminder:delete', 'bill:save', 'bill:delete', 'billPayment:save', 'billPayment:delete', 'category:save', 'category:delete', 'prefs:set', 'local:set', 'audit:list',
  'notification:update', 'notification:test', 'reminders:runNow', 'reminders:diagnostics', 'backup:create', 'backup:chooseDir',
  'backup:pick', 'backup:preview', 'backup:restore', 'backup:history', 'file:reveal', 'app:openDataDir', 'sync:chooseFolder',
  'sync:setPassphrase', 'sync:now', 'sync:all', 'export:save', 'export:fullJson', 'import:openText', 'import:apply', 'report:pdf',
  'report:print', 'lock:status', 'lock:unlock', 'lock:hello', 'lock:set', 'lock:now', 'lan:status', 'lan:pair', 'lan:cancelPair', 'lan:removePeer', 'debt:save', 'debt:delete', 'debtRepayment:save', 'debtRepayment:delete', 'attachment:add', 'attachment:open', 'demo:load', 'diagnostics:get', 'data:resetAll',
] as const;
const EVENTS = ['notification', 'data:changed', 'navigate', 'lock:changed'] as const;

contextBridge.exposeInMainWorld('emi', {
  invoke(channel: string, payload?: unknown) {
    if (!(INVOKE as readonly string[]).includes(channel)) return Promise.resolve({ ok: false, error: `Unknown channel ${channel}` });
    return ipcRenderer.invoke(channel, payload);
  },
  on(event: string, cb: (payload: unknown) => void) {
    if (!(EVENTS as readonly string[]).includes(event)) return () => {};
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
