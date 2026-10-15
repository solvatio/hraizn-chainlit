/** Generic host actions. Shop-specific handlers and parameters belong to the host. */
import type { Socket } from 'socket.io-client';

export const HOST_CHANNEL = 'hraizn-host';
export const HOST_TIMEOUT_MS = 35000;
const MAX_REQUESTS = 128;
const MAX_BYTES = 8192;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]{0,48}$/;
export const HOST_ACTION_DEFAULT_MESSAGES = {
  'hostActions.success': 'The action was completed.',
  'hostActions.checkBeforeRetry':
    'Please check the page before trying this action again.',
  'hostActions.failed':
    'The action could not be completed. Please check the page.',
  'hostActions.foreignLink': 'This action link does not belong to this chat.',
  'hostActions.unavailable': 'This action is not available in this embedding.',
  'hostActions.invalidLink': 'This action link is not valid.',
  'hostActions.timeout': 'The action took too long.',
  'hostActions.tooManyActions':
    'Please reopen the chat before using another action.',
  'hostActions.connectionLost': 'The connection was interrupted.'
} as const;
export type HostActionMessageKey = keyof typeof HOST_ACTION_DEFAULT_MESSAGES;
export type HostActionTranslate = (
  key: HostActionMessageKey,
  defaultValue: string
) => string;
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
  if (
    !boundedHostMessage(data) ||
    !isHostMessage(data) ||
    data.type !== 'telemetry' ||
    !socket?.connected ||
    socket.io.engine?.transport?.writable !== true
  )
    return false;
  socket.volatile.emit('window_message', data);
  return true;
}
type Action = { name: string; mutating: boolean };
type Pending = {
  link: HTMLAnchorElement;
  action: string;
  mutating: boolean;
  issuedAt: number;
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
  private requests = new Set<string>();
  private uncertain = false;
  private ready = false;

  constructor(
    private win: Window,
    private doc: Document,
    origins: string[],
    private rootPath: string,
    private sendTelemetry: (data: any) => boolean,
    private translate: HostActionTranslate = (_key, defaultValue) =>
      defaultValue
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
  private announce(link: HTMLAnchorElement, message: HostActionMessageKey) {
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
    status.textContent = this.translate(
      message,
      HOST_ACTION_DEFAULT_MESSAGES[message]
    );
  }
  private finish(
    id: string,
    success: boolean,
    message: HostActionMessageKey,
    code: string
  ) {
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
    // Report only after local completion. No delivery/acknowledgement is needed.
    const telemetry = this.envelope({
      type: 'telemetry',
      requestId: id,
      hostOrigin: this.parentOrigin,
      action: entry.action,
      durationMs: Math.max(0, Date.now() - entry.issuedAt),
      success,
      code
    });
    void Promise.resolve()
      .then(() => this.sendTelemetry(telemetry))
      .catch(() => {
        // Best effort: telemetry failures must never alter a host action.
      });
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
          ? 'hostActions.success'
          : this.uncertain
          ? 'hostActions.checkBeforeRetry'
          : 'hostActions.failed',
        message.code
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
      this.announce(link, 'hostActions.foreignLink');
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
      this.announce(link, 'hostActions.unavailable');
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
        this.announce(link, 'hostActions.invalidLink');
        return;
      }
      parameters[key] = value;
    }
    if (
      action.mutating &&
      (this.uncertain ||
        Array.from(this.pending.values()).some((p) => p.mutating))
    ) {
      this.announce(link, 'hostActions.checkBeforeRetry');
      return;
    }
    const requestId = this.win.crypto.randomUUID();
    const issuedAt = Date.now(),
      expiresAt = issuedAt + HOST_TIMEOUT_MS;
    const request = this.envelope({
      type: 'request',
      requestId,
      issuedAt,
      expiresAt,
      data: { type: name, parameters }
    });
    if (
      !UUID.test(requestId) ||
      this.requests.has(requestId) ||
      !boundedHostMessage(request)
    ) {
      this.announce(link, 'hostActions.invalidLink');
      return;
    }
    if (this.requests.size >= MAX_REQUESTS) {
      this.announce(link, 'hostActions.tooManyActions');
      return;
    }
    this.requests.add(requestId);
    const timer = this.win.setTimeout(() => {
      if (action.mutating) this.uncertain = true;
      this.finish(
        requestId,
        false,
        action.mutating
          ? 'hostActions.checkBeforeRetry'
          : 'hostActions.timeout',
        'TIMEOUT'
      );
    }, HOST_TIMEOUT_MS);
    this.pending.set(requestId, {
      link,
      action: name,
      mutating: action.mutating,
      issuedAt,
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
    const entry = this.pending.get(requestId)!;
    if (Date.now() >= expiresAt) {
      this.finish(requestId, false, 'hostActions.timeout', 'EXPIRED');
      return;
    }
    entry.forwarded = true;
    try {
      this.win.parent.postMessage(request, this.parentOrigin);
    } catch {
      if (action.mutating) this.uncertain = true;
      this.finish(
        requestId,
        false,
        action.mutating ? 'hostActions.checkBeforeRetry' : 'hostActions.failed',
        'DISPATCH_FAILED'
      );
    }
  };
  dispose() {
    for (const [id, entry] of this.pending) {
      // Disposing the controller does not undo an action already sent to the host.
      if (entry.mutating) this.uncertain = true;
      this.finish(
        id,
        false,
        entry.mutating
          ? 'hostActions.checkBeforeRetry'
          : 'hostActions.connectionLost',
        'CANCELLED'
      );
    }
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
  send: (data: any) => boolean,
  translate?: HostActionTranslate
) {
  activeBridge?.dispose();
  activeBridge = new HostActionBridge(
    win,
    doc,
    origins,
    rootPath,
    send,
    translate
  );
  const bridge = activeBridge;
  return () => {
    bridge.dispose();
    if (activeBridge === bridge) activeBridge = undefined;
  };
}
