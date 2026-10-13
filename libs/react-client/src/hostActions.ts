/** Generic host actions. Shop-specific handlers and parameters belong to the host. */
import type { Socket } from 'socket.io-client';

export const HOST_CHANNEL = 'hraizn-host';
export const HOST_TIMEOUT_MS = 35000;
const MAX_BYTES = 8192;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]{0,48}$/;
const record = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
export function boundedHostMessage(
  value: unknown
): value is Record<string, any> {
  if (!record(value)) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_BYTES;
  } catch {
    return false;
  }
}
export const isHostMessage = (value: unknown) =>
  record(value) && value.channel === HOST_CHANNEL;
export function isOwnWindowMessage(event: MessageEvent, win: Window) {
  return (
    event.source === win &&
    event.origin === win.location.origin &&
    !isHostMessage(event.data)
  );
}
export function sendHostSocketMessage(
  socket: Socket | undefined,
  data: unknown
) {
  if (!socket?.connected || socket.io.engine?.transport?.writable !== true)
    return false;
  socket.volatile.emit('window_message', data);
  return true;
}
type Action = { name: string; mutating: boolean };
type Pending = {
  link: HTMLAnchorElement;
  action: string;
  mutating: boolean;
  expiresAt: number;
  timer: number;
  forwarded: boolean;
};

export function parseHostActions(actions: unknown): Action[] | null {
  if (!Array.isArray(actions) || !actions.length || actions.length > 32)
    return null;
  const names = new Set();
  for (const action of actions) {
    if (
      !record(action) ||
      typeof action.name !== 'string' ||
      !NAME.test(action.name) ||
      typeof action.mutating !== 'boolean' ||
      names.has(action.name) ||
      Object.keys(action).some((k) => !['name', 'mutating'].includes(k))
    )
      return null;
    names.add(action.name);
  }
  return actions;
}

export class HostActionBridge {
  readonly handshakeId: string;
  readonly parentOrigin: string | null;
  private actions = new Map<string, Action>();
  private pending = new Map<string, Pending>();
  private uncertain = false;
  private ready = false;

  constructor(
    private win: Window,
    private doc: Document,
    origins: string[],
    private rootPath: string,
    private send: (data: any) => boolean
  ) {
    this.handshakeId = win.crypto.randomUUID();
    const query = new URL(win.location.href).searchParams;
    let candidate =
      query.get('hraiznHostOrigin') || query.get('hraiznShopOrigin');
    if (!candidate && doc.referrer) {
      try {
        candidate = new URL(doc.referrer).origin;
      } catch {
        /* No trust from invalid referrer. */
      }
    }
    this.parentOrigin =
      candidate && origins.includes(candidate) ? candidate : null;
    win.addEventListener('message', this.receive);
    doc.addEventListener('click', this.click);
    this.hello();
  }

  private hello() {
    if (this.parentOrigin && this.win.parent !== this.win) {
      this.win.parent.postMessage(
        this.envelope({ type: 'hello' }),
        this.parentOrigin
      );
    }
  }
  private envelope(data: Record<string, unknown>) {
    return {
      source: 'hraizn-chat',
      channel: HOST_CHANNEL,
      version: 1,
      handshakeId: this.handshakeId,
      ...data
    };
  }
  private announce(link: HTMLAnchorElement, message: string) {
    const container = link.parentElement;
    if (!container) return;
    let status = container.querySelector<HTMLElement>(
      '[data-hraizn-action-status]'
    );
    if (!status) {
      status = this.doc.createElement('span');
      status.setAttribute('data-hraizn-action-status', '');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      container.appendChild(status);
    }
    status.textContent = message;
  }
  private finish(id: string, success: boolean, message: string) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    this.win.clearTimeout(entry.timer);
    entry.link.classList.remove('hraizn-action-link-pending');
    entry.link.classList.toggle('hraizn-action-link-success', success);
    entry.link.classList.toggle('hraizn-action-link-error', !success);
    entry.link.removeAttribute('aria-busy');
    entry.link.removeAttribute('aria-disabled');
    this.announce(entry.link, message);
  }
  private receive = (event: MessageEvent) => {
    const message = event.data;
    if (
      event.source !== this.win.parent ||
      event.origin !== this.parentOrigin ||
      !boundedHostMessage(message) ||
      message.source !== 'hraizn-host' ||
      message.channel !== HOST_CHANNEL ||
      message.version !== 1 ||
      message.handshakeId !== this.handshakeId
    )
      return;
    if (message.type === 'ready' && !this.ready) {
      const actions = parseHostActions(message.actions);
      if (!actions) return;
      this.actions = new Map(actions.map((a) => [a.name, a]));
      this.ready = true;
    } else if (
      message.type === 'response' &&
      UUID.test(message.requestId) &&
      typeof message.success === 'boolean' &&
      typeof message.code === 'string' &&
      /^[A-Z_]{1,40}$/.test(message.code)
    ) {
      const entry = this.pending.get(message.requestId);
      if (!entry || !entry.forwarded || Date.now() > entry.expiresAt) return;
      const success = message.success === true && !message.error;
      if (entry.mutating && message.code === 'CHECK_CART')
        this.uncertain = true;
      this.finish(
        message.requestId,
        success,
        success
          ? 'Die Aktion wurde ausgeführt.'
          : this.uncertain
          ? 'Bitte prüfen Sie die Shopseite, bevor Sie die Aktion erneut ausführen.'
          : 'Die Aktion konnte nicht ausgeführt werden. Bitte prüfen Sie die Shopseite.'
      );
      this.send(
        this.envelope({
          type: 'result',
          requestId: message.requestId,
          success,
          code: message.code
        })
      );
    }
  };
  private click = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    let url: URL;
    try {
      url = new URL(link.getAttribute('href') || '', this.win.location.href);
    } catch {
      return;
    }
    if (!url.hash.startsWith('#action/')) return;
    event.preventDefault();
    if (
      !event.isTrusted ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      link.classList.contains('hraizn-action-link-pending')
    )
      return;
    const root = this.rootPath
      .replace(/\/m\/widget\/?$/, '')
      .replace(/\/$/, '');
    if (
      url.origin !== this.win.location.origin ||
      url.username ||
      url.password ||
      ![this.win.location.pathname.replace(/\/$/, ''), root].includes(
        url.pathname.replace(/\/$/, '')
      )
    ) {
      this.announce(link, 'Dieser Aktionslink gehört nicht zu diesem Chat.');
      return;
    }
    const reference = url.hash.slice('#action/'.length);
    const split = reference.indexOf('?');
    const name = split < 0 ? reference : reference.slice(0, split);
    const params = new URLSearchParams(
      split < 0 ? '' : reference.slice(split + 1)
    );
    const action = this.actions.get(name);
    if (
      !this.ready ||
      !this.parentOrigin ||
      !action ||
      this.win.parent === this.win
    ) {
      this.announce(
        link,
        'Diese Aktion ist in dieser Einbettung nicht verfügbar.'
      );
      return;
    }
    const parameters: Record<string, string> = Object.create(null);
    if (Array.from(params).length > 16) return;
    for (const [key, value] of params) {
      if (
        !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) ||
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        value.length > 512 ||
        Object.prototype.hasOwnProperty.call(parameters, key)
      ) {
        this.announce(link, 'Dieser Aktionslink ist nicht gültig.');
        return;
      }
      parameters[key] = value;
    }
    if (
      action.mutating &&
      (this.uncertain ||
        Array.from(this.pending.values()).some((p) => p.mutating))
    ) {
      this.announce(
        link,
        'Bitte prüfen Sie zuerst die Shopseite, bevor Sie erneut ausführen.'
      );
      return;
    }
    const requestId = this.win.crypto.randomUUID();
    const issuedAt = Date.now(),
      expiresAt = issuedAt + HOST_TIMEOUT_MS;
    const timer = this.win.setTimeout(() => {
      if (action.mutating) this.uncertain = true;
      this.finish(
        requestId,
        false,
        action.mutating
          ? 'Bitte prüfen Sie die Shopseite, bevor Sie erneut ausführen.'
          : 'Die Aktion hat zu lange gedauert.'
      );
      this.send(
        this.envelope({
          type: 'result',
          requestId,
          success: false,
          code: 'TIMEOUT'
        })
      );
    }, HOST_TIMEOUT_MS);
    this.pending.set(requestId, {
      link,
      action: name,
      mutating: action.mutating,
      expiresAt,
      timer,
      forwarded: false
    });
    link.classList.remove(
      'hraizn-action-link-success',
      'hraizn-action-link-error'
    );
    link.classList.add('hraizn-action-link-pending');
    link.setAttribute('aria-busy', 'true');
    link.setAttribute('aria-disabled', 'true');
    if (
      !this.send(
        this.envelope({
          type: 'request',
          requestId,
          issuedAt,
          expiresAt,
          registration: {
            hostOrigin: this.parentOrigin,
            actions: Array.from(this.actions.values())
          },
          data: { type: name, parameters }
        })
      )
    ) {
      this.finish(
        requestId,
        false,
        'Die Verbindung ist gerade nicht bereit. Bitte versuchen Sie es erneut.'
      );
    }
  };

  relay(message: unknown) {
    if (
      !boundedHostMessage(message) ||
      message.version !== 1 ||
      message.handshakeId !== this.handshakeId
    )
      return;
    if (
      message.source === 'hraizn-relay' &&
      message.type === 'rejected' &&
      message.code === 'ACTION_REJECTED'
    ) {
      const entry = this.pending.get(message.requestId);
      if (entry && !entry.forwarded)
        this.finish(
          message.requestId,
          false,
          'Diese Aktion konnte nicht weitergeleitet werden. Bitte öffnen Sie den Chat erneut.'
        );
      return;
    }
    if (
      message.source !== 'hraizn-chat' ||
      message.version !== 1 ||
      message.handshakeId !== this.handshakeId ||
      message.type !== 'request' ||
      !this.parentOrigin ||
      !this.ready
    )
      return;
    const entry = this.pending.get(message.requestId);
    if (
      !entry ||
      entry.forwarded ||
      message.expiresAt !== entry.expiresAt ||
      Date.now() >= entry.expiresAt ||
      !record(message.data) ||
      message.data.type !== entry.action
    )
      return;
    entry.forwarded = true;
    this.win.parent.postMessage(message, this.parentOrigin);
  }
  transportDisconnected() {
    for (const [id, entry] of this.pending) {
      // A request emitted towards the server may already have reached the shop.
      if (entry.mutating) this.uncertain = true;
      this.finish(
        id,
        false,
        entry.mutating
          ? 'Bitte prüfen Sie die Shopseite, bevor Sie erneut ausführen.'
          : 'Die Verbindung wurde unterbrochen.'
      );
    }
  }
  dispose() {
    this.transportDisconnected();
    this.win.removeEventListener('message', this.receive);
    this.doc.removeEventListener('click', this.click);
  }
}

let activeBridge: HostActionBridge | undefined;
export function installHostActions(
  win: Window,
  doc: Document,
  origins: string[],
  rootPath: string,
  send: (data: any) => boolean
) {
  activeBridge?.dispose();
  activeBridge = new HostActionBridge(win, doc, origins, rootPath, send);
  const bridge = activeBridge;
  return () => {
    bridge.dispose();
    if (activeBridge === bridge) activeBridge = undefined;
  };
}
export function relayHostActionMessage(message: unknown) {
  if (!isHostMessage(message)) return false;
  activeBridge?.relay(message);
  return true; // Never leak protected messages through the legacy wildcard path.
}
export function hostActionTransportDisconnected() {
  activeBridge?.transportDisconnected();
}
