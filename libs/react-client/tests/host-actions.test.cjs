// Run with node --experimental-transform-types tests/host-actions.test.cjs.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {HostActionBridge, HOST_ACTION_DEFAULT_MESSAGES, parseHostActions, isHostMessage, isOwnWindowMessage, sendHostSocketMessage} = require('../src/hostActions.ts');
const shop = 'https://shop.example';
global.Element = class {};
const flushTelemetry = async () => {await Promise.resolve(); await Promise.resolve();};

function fixture({origin = shop, href = '#action/cart.add?productNumber=3356-221', connected = true, standalone = false, translate, telemetryFailure} = {}) {
    const messages = [], socket = [], handlers = new Map(), timers = new Map(), names = new Set();
    let count = 0, timerId = 0, status;
    const parent = {postMessage: (data, destination) => messages.push({data, destination})};
    const link = new Element();
    const attributes = {};
    Object.assign(link, {closest: () => link, getAttribute: () => href,
        classList: {contains: k => names.has(k), add: (...keys) => keys.forEach(k => names.add(k)),
            remove: (...keys) => keys.forEach(k => names.delete(k)), toggle: (k, on) => on ? names.add(k) : names.delete(k)},
        setAttribute: (k, v) => {attributes[k] = v;}, removeAttribute: k => {delete attributes[k];},
        parentElement: {querySelector: () => status, appendChild: item => {status = item;}}});
    const win = {location: new URL('https://chat.example/example/m/widget?hraiznHostOrigin=' + encodeURIComponent(origin)), parent,
        crypto: {randomUUID: () => `3d8630c4-ece2-4f16-b4aa-${String(++count).padStart(12, '0')}`},
        addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name),
        setTimeout: (fn, delay) => {timers.set(++timerId, {fn, delay}); return timerId;}, clearTimeout: id => timers.delete(id)};
    if (standalone) win.parent = win;
    const doc = {referrer: '', addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name),
        createElement: () => ({setAttribute() {}})};
    const bridge = new HostActionBridge(win, doc, [shop], '/example/m/widget', data => {
        if (telemetryFailure === 'throw') throw new Error('telemetry unavailable');
        if (telemetryFailure === 'reject') return Promise.reject(new Error('telemetry unavailable'));
        if (!connected) return false;
        socket.push(data); return true;
    }, translate);
    const receive = (data, changes = {}) => handlers.get('message')({source: parent, origin: shop,
        data: {source: 'hraizn-host', channel: 'hraizn-host', version: 1, handshakeId: bridge.handshakeId, ...data}, ...changes});
    const ready = (actions = [{name: 'cart.add', mutating: true}, {name: 'navigation.goto', mutating: false}]) => receive({type: 'ready', actions});
    const click = (changes = {}) => handlers.get('click')({target: link, isTrusted: true, button: 0, preventDefault() {}, ...changes});
    const request = () => messages.findLast(m => m.data.type === 'request')?.data;
    const respond = (data = {}, changes = {}) => receive({type: 'response', requestId: request()?.requestId, success: true, code: 'DONE', ...data}, changes);
    const timeout = () => [...timers.values()][0].fn();
    const requests = () => messages.filter(m => m.data.type === 'request');
    return {bridge, win, doc, parent, messages, socket, ready, click, request, requests, receive, respond, timers, names, attributes,
        timeout, setHref: value => {href = value;}, status: () => status?.textContent, disconnect: () => {connected = false;}, reconnect: () => {connected = true;}};
}

test('handshake has no side effects; click dispatches directly and telemetry follows completion', async () => {
    const f = fixture();
    assert.equal(f.messages.length, 1); f.ready(); assert.equal(f.requests().length, 0);
    f.click();
    assert.equal(f.requests().length, 1); assert.equal(f.messages[1].destination, shop);
    assert.equal(f.socket.length, 0); assert.equal(f.request().registration, undefined);
    assert.equal(f.request().expiresAt - f.request().issuedAt, 35000);
    assert.equal([...f.timers.values()][0].delay, 35000);
    f.respond();
    assert.ok(f.names.has('hraizn-action-link-success')); assert.equal(f.timers.size, 0);
    assert.equal(f.socket.length, 0);
    await flushTelemetry();
    assert.equal(f.socket.length, 1);
    assert.deepEqual(Object.keys(f.socket[0]).sort(), ['source', 'channel', 'version', 'type', 'handshakeId', 'requestId', 'hostOrigin', 'action', 'durationMs', 'success', 'code'].sort());
    assert.equal(f.socket[0].type, 'telemetry'); assert.equal(f.socket[0].action, 'cart.add');
    assert.equal(f.socket[0].requestId, f.request().requestId); assert.ok(f.socket[0].durationMs >= 0);
    assert.ok(!JSON.stringify(f.socket[0]).includes('3356-221')); f.bridge.dispose();
});

test('same-chat absolute URL and generic registered actions still work', () => {
    for (const [href, actions, expected] of [
        ['https://chat.example/example#action/navigation.goto?productNumber=3356-221', undefined, 'navigation.goto'],
        ['#action/room.show?roomId=suite', [{name: 'room.show', mutating: false}], 'room.show']
    ]) {
        const f = fixture({href}); f.ready(actions); f.click();
        assert.equal(f.request().data.type, expected); f.bridge.dispose();
    }
});

for (const options of [{origin: 'https://evil.example'}, {standalone: true}]) {
    test('non-allowlisted and standalone hosts never execute: ' + JSON.stringify(options), () => {
        const f = fixture(options); f.ready(); f.click(); assert.equal(f.requests().length, 0); f.bridge.dispose();
    });
}

test('wrong window, origin, handshake, version or manifest cannot activate', () => {
    for (const [data, changes] of [[{}, {source: {}}], [{}, {origin: 'https://evil.example'}], ...[
        {handshakeId: 'bad'}, {version: 2}, {channel: 'other'}, {source: 'other'},
        {actions: [{name: 'cart.add', mutating: 'true'}]}
    ].map(update => [update, {}])]) {
        const f = fixture(); f.receive({type: 'ready', actions: [{name: 'cart.add', mutating: true}], ...data}, changes);
        f.click(); assert.equal(f.requests().length, 0); f.bridge.dispose();
    }
});

test('ready manifest cannot be replaced after the handshake', () => {
    const f = fixture({href: '#action/admin.execute'});
    f.ready(); f.ready([{name: 'admin.execute', mutating: false}]); f.click();
    assert.equal(f.requests().length, 0); f.bridge.dispose();
});

test('programmatic, modified and repeated pending clicks never duplicate an action', () => {
    const f = fixture(); f.ready();
    for (const changes of [{isTrusted: false}, {button: 1}, {ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {altKey: true}]) f.click(changes);
    assert.equal(f.requests().length, 0); f.click(); f.click(); assert.equal(f.requests().length, 1); f.bridge.dispose();
});

for (const href of ['https://evil.example/example#action/cart.add?productNumber=x', '#action/admin.execute',
    '#action/cart.add?productNumber=x&productNumber=y', '#action/cart.add?constructor=x',
    '#action/cart.add?__proto__=x', '#action/cart.add?prototype=x', '#action/cart.add?x=' + 'x'.repeat(513),
    '#action/cart.add?' + Array.from({length: 17}, (_, i) => 'x' + i + '=a').join('&'),
    '#action/cart.add?' + Array.from({length: 16}, (_, i) => 'x' + i + '=' + 'x'.repeat(512)).join('&')]) {
    test('unsafe, oversized or unregistered action rejected: ' + href.slice(0, 100), () => {
        const f = fixture({href}); f.ready(); f.click(); assert.equal(f.requests().length, 0); f.bridge.dispose();
    });
}

test('foreign, unrelated, oversized and malformed responses cannot fabricate success', () => {
    const f = fixture(); f.ready(); f.click();
    for (const changes of [{origin: 'https://evil.example'}, {source: {}}]) f.respond({}, changes);
    for (const data of [{requestId: 'unknown'}, {success: undefined}, {success: 'true'}, {code: 'bad\ncode'}, {padding: 'x'.repeat(8192)}, {handshakeId: 'bad'}]) f.respond(data);
    assert.ok(f.names.has('hraizn-action-link-pending'));
    f.respond({success: true, error: 'conflicting error'}); assert.ok(f.names.has('hraizn-action-link-error')); f.bridge.dispose();
});

for (const options of [{connected: false}, {telemetryFailure: 'throw'}, {telemetryFailure: 'reject'}]) {
    test('unavailable telemetry never prevents a successful shop action: ' + JSON.stringify(options), async () => {
        const f = fixture(options); f.ready(); f.click(); assert.equal(f.requests().length, 1);
        f.respond(); assert.ok(f.names.has('hraizn-action-link-success'));
        await flushTelemetry(); assert.equal(f.socket.length, 0); assert.equal(f.timers.size, 0);
        f.reconnect(); await flushTelemetry(); assert.equal(f.requests().length, 1); assert.equal(f.socket.length, 0);
        f.bridge.dispose();
    });
}

test('mid-flight socket disconnect does not cancel the host request or allow double mutation', async () => {
    const f = fixture(); f.ready(); f.click(); f.disconnect();
    assert.ok(f.names.has('hraizn-action-link-pending')); f.click(); assert.equal(f.requests().length, 1);
    f.respond(); assert.ok(f.names.has('hraizn-action-link-success')); await flushTelemetry();
    f.reconnect(); await flushTelemetry(); assert.equal(f.socket.length, 0);
    f.click(); assert.equal(f.requests().length, 2); f.respond(); await flushTelemetry();
    assert.equal(f.socket.length, 1); f.bridge.dispose();
});

test('timeout never retries; late success is ignored and further mutations stay blocked', async () => {
    const f = fixture(); f.ready(); f.click(); f.timeout(); f.respond(); f.click();
    await flushTelemetry(); assert.equal(f.requests().length, 1);
    assert.equal(f.socket.length, 1); assert.equal(f.socket[0].code, 'TIMEOUT');
    assert.ok(f.names.has('hraizn-action-link-error')); f.bridge.dispose();
});

test('CHECK_CART prevents another mutation and duplicate responses never duplicate telemetry', async () => {
    const f = fixture(); f.ready(); f.click(); f.respond({success: false, code: 'CHECK_CART'});
    f.respond(); f.click(); await flushTelemetry();
    assert.equal(f.requests().length, 1); assert.equal(f.socket.length, 1);
    assert.equal(f.status(), HOST_ACTION_DEFAULT_MESSAGES['hostActions.checkBeforeRetry']); f.bridge.dispose();
});

test('an uncertain cart does not block read-only product navigation', () => {
    const f = fixture(); f.ready(); f.click(); f.respond({success: false, code: 'CHECK_CART'});
    f.setHref('#action/navigation.goto?productNumber=3356-221'); f.click();
    assert.equal(f.requests().length, 2); assert.equal(f.request().data.type, 'navigation.goto');
    f.respond(); assert.ok(f.names.has('hraizn-action-link-success')); f.bridge.dispose();
});

test('request IDs are never reused, and the 128-request bound remains enforced locally', () => {
    const f = fixture({href: '#action/navigation.goto?productNumber=3356-221'}); f.ready(); f.click(); f.respond();
    const randomUUID = f.win.crypto.randomUUID;
    f.win.crypto.randomUUID = () => f.request().requestId;
    f.click(); assert.equal(f.requests().length, 1); f.win.crypto.randomUUID = randomUUID;
    for (let i = 1; i < 128; i++) {f.click(); f.respond();}
    f.click(); assert.equal(f.requests().length, 128);
    assert.equal(f.status(), HOST_ACTION_DEFAULT_MESSAGES['hostActions.tooManyActions']); f.bridge.dispose();
});

test('an expired request is not dispatched even if the clock advances during click processing', () => {
    const f = fixture(); f.ready(); const originalNow = Date.now; let calls = 0;
    try {
        Date.now = () => 1800000000000 + (calls++ === 0 ? 0 : 35000);
        f.click(); assert.equal(f.requests().length, 0); assert.equal(f.timers.size, 0);
    } finally {Date.now = originalNow; f.bridge.dispose();}
});

test('direct dispatch errors complete locally and preserve conservative mutation handling', async () => {
    const f = fixture(); f.ready(); f.parent.postMessage = () => {throw new Error('dispatch failed');};
    f.click(); assert.equal(f.timers.size, 0); assert.ok(f.names.has('hraizn-action-link-error'));
    await flushTelemetry(); assert.equal(f.socket[0].code, 'DISPATCH_FAILED');
    f.click(); assert.equal(f.requests().length, 0); f.bridge.dispose();
});

test('strict manifest bounds and stale server commands cannot use the legacy wildcard path', () => {
    for (const actions of [[], [{name: 'bad', mutating: true}], [{name: 'cart.add', mutating: 'true'}],
        [{name: 'cart.add', mutating: true}, {name: 'cart.add', mutating: true}], Array.from({length: 33}, (_, i) => ({name: 'room.show' + i, mutating: false}))]) assert.equal(parseHostActions(actions), null);
    assert.equal(isHostMessage({channel: 'hraizn-host', type: 'request'}), true);
    assert.equal(isHostMessage({type: 'profile'}), false);
    const sessionSource = readFileSync(require.resolve('../src/useChatSession.ts'), 'utf8');
    assert.ok(sessionSource.includes('if (isHostMessage(data)) return;'));
    assert.ok(!sessionSource.includes('hostActionTransportDisconnected'));
});

test('own-window consent/login/voice still work; host messages are not forwarded to the backend', () => {
    const win = {location: {origin: 'https://chat.example'}};
    for (const data of [{type: 'consent_given'}, {type: 'user_login'}, {type: 'voice'}, '{"type":"consent_given"}']) {
        assert.equal(isOwnWindowMessage({source: win, origin: win.location.origin, data}, win), true);
        assert.equal(isOwnWindowMessage({source: {}, origin: win.location.origin, data}, win), false);
    }
    assert.equal(isOwnWindowMessage({source: win, origin: win.location.origin, data: {channel: 'hraizn-host'}}, win), false);
});

test('telemetry transport is volatile, never queues and never sends execution requests', () => {
    const packets = [], transport = {writable: true};
    const socket = {connected: true, io: {engine: {transport}}, volatile: {emit: (name, data) => {packets.push({name, data}); transport.writable = false;}}};
    const data = {channel: 'hraizn-host', type: 'telemetry'};
    assert.equal(sendHostSocketMessage(socket, {...data, type: 'request'}), false);
    assert.equal(sendHostSocketMessage(socket, data), true); assert.equal(packets.length, 1);
    assert.equal(sendHostSocketMessage(socket, data), false); socket.connected = false; transport.writable = true;
    assert.equal(sendHostSocketMessage(socket, data), false); assert.equal(packets.length, 1);
});

test('direct client and real Shopware host preserve cart/navigation and replay protection without a chat socket', async () => {
    const {HraiznDivinoChat} = require('../../../../hraizn-saas-commons/shopware/HraiznDivinoChat/src/Resources/public/storefront/js/hraizn-divino-chat.js');
    for (const action of ['cart.add', 'navigation.goto']) {
        const f = fixture({connected: false, href: '#action/' + action + '?productNumber=3356-221'});
        const calls = [], pages = [], host = Object.create(HraiznDivinoChat.prototype);
        Object.assign(host, {
            chatUrl: new URL('https://chat.example/example/m/widget'), base: new URL(shop + '/weine'), basePath: '/weine/',
            win: {location: {origin: shop}, setTimeout, clearTimeout},
            iframe: {contentWindow: f.win}, requests: new Map(), handshakeId: null, cartBusy: false, token: null,
            routes: {session: shop + '/weine/session', cartAdd: shop + '/weine/cart/add', product: shop + '/weine/product'},
            actions: new Map([['cart.add', {mutating: true, execute: (...args) => host.addToCart(...args)}], ['navigation.goto', {mutating: false, execute: (...args) => host.navigateProduct(...args)}]]),
            storefront: {navigate: async url => {pages.push(url); return true;}}, showCart: async () => pages.push('cart'),
            json: async (url, options) => {
                calls.push({url, options});
                if (url.endsWith('/session')) return {ok: true, body: {success: true, token: 'a'.repeat(64)}};
                if (options?.method === 'POST') return {ok: true, body: {success: true, productNumber: '3356-221', acceptedQuantity: 1}};
                return {ok: true, body: {success: true, product: {id: 'a'.repeat(32), productNumber: '3356-221', detailUrl: shop + '/weine/bacchus/3356-221'}}};
            }
        });
        f.win.postMessage = data => f.receive(data);
        await host.onMessage({origin: f.win.location.origin, source: f.win, data: f.messages[0].data});
        assert.equal(calls.length, 0); f.click(); assert.equal(f.socket.length, 0);
        const event = {origin: f.win.location.origin, source: f.win, data: f.request()};
        await host.onMessage(event); await host.onMessage(event); await flushTelemetry();
        assert.ok(f.names.has('hraizn-action-link-success')); assert.equal(f.socket.length, 0);
        assert.equal(calls.filter(c => c.options?.method === 'POST').length, action === 'cart.add' ? 1 : 0);
        assert.equal(pages.length, 1); assert.equal(pages[0], action === 'cart.add' ? 'cart' : shop + '/weine/bacchus/3356-221');
        f.bridge.dispose();
    }
});

const statusScenarios = [
    {key: 'success', run: f => {f.ready(); f.click(); f.respond();}},
    {key: 'failed', run: f => {f.ready(); f.click(); f.respond({success: false});}},
    {key: 'checkBeforeRetry', run: f => {f.ready(); f.click(); f.respond({success: false, code: 'CHECK_CART'});}},
    {key: 'foreignLink', options: {href: 'https://evil.example/#action/cart.add'}, run: f => f.click()},
    {key: 'unavailable', run: f => f.click()},
    {key: 'invalidLink', options: {href: '#action/cart.add?productNumber=x&productNumber=y'}, run: f => {f.ready(); f.click();}},
    {key: 'timeout', options: {href: '#action/navigation.goto?productNumber=3356-221'}, run: f => {f.ready(); f.click(); f.timeout();}},
    {key: 'tooManyActions', options: {href: '#action/navigation.goto?productNumber=3356-221'}, run: f => {f.ready(); for (let i = 0; i < 128; i++) {f.click(); f.respond();} f.click();}},
    {key: 'connectionLost', options: {href: '#action/navigation.goto?productNumber=3356-221'}, run: f => {f.ready(); f.click(); f.bridge.dispose();}}
];

test('all direct-action status paths use injected translation keys and readable defaults', () => {
    const keys = new Set();
    for (const scenario of statusScenarios) {
        const f = fixture({...scenario.options, translate: (key, fallback) => {
            keys.add(key); assert.equal(fallback, HOST_ACTION_DEFAULT_MESSAGES[key]); return 'translated:' + key;
        }});
        scenario.run(f); assert.equal(f.status(), 'translated:hostActions.' + scenario.key); f.bridge.dispose();
    }
    assert.deepEqual([...keys].sort(), Object.keys(HOST_ACTION_DEFAULT_MESSAGES).sort());
});

test('German and English bundles cover all direct-action statuses', () => {
    for (const locale of ['de-DE', 'en-US']) {
        const {hostActions} = require('../../../backend/chainlit/translations/' + locale + '.json');
        assert.deepEqual(Object.keys(hostActions).map(key => 'hostActions.' + key).sort(), Object.keys(HOST_ACTION_DEFAULT_MESSAGES).sort());
        for (const scenario of statusScenarios) {
            const f = fixture({...scenario.options, translate: (key, fallback) => hostActions[key.slice('hostActions.'.length)] || fallback});
            scenario.run(f); assert.equal(f.status(), hostActions[scenario.key]); f.bridge.dispose();
        }
    }
});

test('language changes preserve the handshake and mutation guard while telemetry is offline', () => {
    let language = 'de-DE';
    const f = fixture({connected: false, translate: key => require('../../../backend/chainlit/translations/' + language + '.json').hostActions[key.slice('hostActions.'.length)]});
    f.ready(); f.click(); const handshakeId = f.bridge.handshakeId; language = 'en-US'; f.click();
    assert.equal(f.requests().length, 1); f.respond(); assert.equal(f.status(), 'The action was completed.');
    assert.equal(f.bridge.handshakeId, handshakeId); assert.equal(f.messages.filter(m => m.data.type === 'hello').length, 1); f.bridge.dispose();
});
