// Run with node --experimental-transform-types --test tests/host-actions.test.cjs.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {HostActionBridge, parseHostActions, relayHostActionMessage, isOwnWindowMessage, sendHostSocketMessage} = require('../src/hostActions.ts');
const shop = 'https://shop.example';
global.Element = class {};

function fixture({origin = shop, href = '#action/cart.add?productNumber=3356-221', connected = true, standalone = false} = {}) {
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
        setTimeout: fn => {timers.set(++timerId, fn); return timerId;}, clearTimeout: id => timers.delete(id)};
    if (standalone) win.parent = win;
    const doc = {referrer: '', addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name),
        createElement: () => ({setAttribute() {}})};
    const bridge = new HostActionBridge(win, doc, [shop], '/example/m/widget', data => {
        if (!connected) return false; socket.push(data); return true;
    });
    const receive = (data, changes = {}) => handlers.get('message')({source: parent, origin: shop,
        data: {source: 'hraizn-host', channel: 'hraizn-host', version: 1, handshakeId: bridge.handshakeId, ...data}, ...changes});
    const ready = (actions = [{name: 'cart.add', mutating: true}, {name: 'navigation.goto', mutating: false}]) => receive({type: 'ready', actions});
    const click = (changes = {}) => handlers.get('click')({target: link, isTrusted: true, button: 0, preventDefault() {}, ...changes});
    const request = () => socket.findLast(m => m.type === 'request');
    const relay = () => bridge.relay(request());
    const respond = (data = {}, changes = {}) => receive({type: 'response', requestId: request()?.requestId, success: true, code: 'DONE', ...data}, changes);
    return {bridge, win, doc, messages, socket, ready, click, relay, request, receive, respond, timers, names, status: () => status?.textContent, disconnect: () => {connected = false; bridge.transportDisconnected();}, reconnect: () => {connected = true;}};
}

test('handshake is side-effect free; request uses socket relay and exact parent origin', () => {
    const f = fixture(); assert.equal(f.messages.length, 1); f.ready(); f.click();
    assert.equal(f.messages.length, 1); assert.deepEqual(f.socket.map(m => m.type), ['request']);
    assert.equal(f.request().registration.hostOrigin, shop);
    f.relay(); assert.equal(f.messages[1].destination, shop); assert.equal(f.messages[1].data.type, 'request');
    assert.equal(f.request().expiresAt - f.request().issuedAt, 35000);
    f.respond(); assert.ok(f.names.has('hraizn-action-link-success')); assert.equal(f.timers.size, 0);
});
test('same-chat absolute action URL works', () => {
    const f = fixture({href: 'https://chat.example/example#action/navigation.goto?productNumber=3356-221'});
    f.ready(); f.click(); assert.equal(f.request().data.type, 'navigation.goto'); f.bridge.dispose();
});
test('any registered action works without hardcoded product or shop semantics', () => {
    const f = fixture({href: '#action/room.show?roomId=suite'}); f.ready([{name: 'room.show', mutating: false}]);
    f.click(); assert.equal(f.request().data.parameters.roomId, 'suite'); f.bridge.dispose();
});
for (const options of [{origin: 'https://evil.example'}, {standalone: true}]) {
    test('non-allowlisted and standalone hosts never execute: ' + JSON.stringify(options), () => {
        const f = fixture(options); f.ready(); f.click(); assert.equal(f.socket.length, 0); f.bridge.dispose();
    });
}
test('wrong window, origin, nonce or protocol cannot activate', () => {
    for (const changes of [{source: {}}, {origin: 'https://evil.example'},
        {data: {source: 'hraizn-host', channel: 'hraizn-host', version: 1, handshakeId: 'bad', type: 'ready', actions: [{name: 'cart.add', mutating: true}]}}]) {
        const f = fixture(); f.receive({type: 'ready', actions: [{name: 'cart.add', mutating: true}]}, changes);
        f.click(); assert.equal(f.socket.length, 0); f.bridge.dispose();
    }
});
test('programmatic, modifier and repeated pending clicks do not execute twice', () => {
    const f = fixture(); f.ready(); f.click({isTrusted: false}); f.click({ctrlKey: true}); assert.equal(f.socket.length, 0);
    f.click(); f.click(); assert.equal(f.socket.filter(m => m.type === 'request').length, 1); f.bridge.dispose();
});
for (const href of ['https://evil.example/example#action/cart.add?productNumber=x', '#action/admin.execute',
    '#action/cart.add?productNumber=x&productNumber=y', '#action/cart.add?constructor=x']) {
    test('unsafe or unregistered action rejected: ' + href, () => {
        const f = fixture({href}); f.ready(); f.click(); assert.equal(f.socket.length, 0); f.bridge.dispose();
    });
}
test('strict false/missing success, foreign response and unrelated ID cannot fabricate success', () => {
    const f = fixture(); f.ready(); f.click(); f.relay();
    f.respond({}, {origin: 'https://evil.example'}); f.respond({requestId: 'unknown'});
    f.respond({success: undefined}); assert.ok(f.names.has('hraizn-action-link-pending'));
    f.respond({success: false}); assert.ok(f.names.has('hraizn-action-link-error')); f.bridge.dispose();
});
test('offline click never buffers and reconnect does not replay', () => {
    const f = fixture({connected: false}); f.ready(); f.click(); assert.equal(f.socket.length, 0);
    f.reconnect(); assert.equal(f.socket.length, 0); f.click(); assert.equal(f.socket.filter(m => m.type === 'request').length, 1); f.bridge.dispose();
});
test('mid-flight disconnect blocks another mutation and late relay, without losing read-only guidance', () => {
    const f = fixture(); f.ready(); f.click(); f.disconnect(); f.reconnect();
    f.relay(); assert.equal(f.messages.length, 1); f.click(); assert.equal(f.socket.filter(m => m.type === 'request').length, 1);
    assert.match(f.status(), /prüfen/); f.bridge.dispose();
});
test('timeout is exactly 35 seconds, never retries and late success cannot change outcome', () => {
    const f = fixture(); f.ready(); f.click(); f.relay(); [...f.timers.values()][0]();
    f.respond(); f.click(); assert.equal(f.socket.filter(m => m.type === 'request').length, 1);
    assert.ok(f.names.has('hraizn-action-link-error')); f.bridge.dispose();
});
test('strict manifest validation; protected server messages never use wildcard fallback', () => {
    for (const actions of [[], [{name: 'bad', mutating: true}], [{name: 'cart.add', mutating: 'true'}],
        [{name: 'cart.add', mutating: true}, {name: 'cart.add', mutating: true}]]) assert.equal(parseHostActions(actions), null);
    assert.equal(relayHostActionMessage({channel: 'hraizn-host', type: 'request'}), true);
    assert.equal(relayHostActionMessage({type: 'profile', name: 'example'}), false);
});

test('existing own-window consent/login/voice messages survive; foreign host messages stay local', () => {
    const win = {location: {origin: 'https://chat.example'}};
    for (const data of [{type: 'consent_given'}, {type: 'user_login'}, {type: 'voice'}, '{"type":"consent_given"}']) {
        assert.equal(isOwnWindowMessage({source: win, origin: win.location.origin, data}, win), true);
        assert.equal(isOwnWindowMessage({source: {}, origin: win.location.origin, data}, win), false);
    }
    assert.equal(isOwnWindowMessage({source: win, origin: win.location.origin, data: {channel: 'hraizn-host'}}, win), false);
});

test('explicit server rejection releases pending UI without pretending a mutation happened', () => {
    const f = fixture(); f.ready(); f.click();
    f.bridge.relay({source: 'hraizn-relay', channel: 'hraizn-host', version: 1,
        handshakeId: f.bridge.handshakeId, type: 'rejected', code: 'ACTION_REJECTED', requestId: f.request().requestId});
    assert.equal(f.timers.size, 0); assert.ok(f.names.has('hraizn-action-link-error')); f.bridge.dispose();
});

test('one atomic dispatch survives volatile transport; busy/offline packets never queue', () => {
    const packets = [], transport = {writable: true};
    const socket = {connected: true, io: {engine: {transport}}, volatile: {emit: (name, data) => {
        packets.push({name, data}); transport.writable = false;
    }}};
    const data = {channel: 'hraizn-host', type: 'request', registration: {hostOrigin: shop}};
    assert.equal(sendHostSocketMessage(socket, data), true); assert.equal(packets.length, 1);
    assert.equal(sendHostSocketMessage(socket, data), false); assert.equal(packets.length, 1);
    socket.connected = false; transport.writable = true;
    assert.equal(sendHostSocketMessage(socket, data), false); assert.equal(packets.length, 1);
});

test('client and real Shopware host share handshake, cart and navigation contract (mock API/relay)', async () => {
    const {HraiznDivinoChat} = require('../../../../hraizn-saas-commons/shopware/HraiznDivinoChat/src/Resources/public/storefront/js/hraizn-divino-chat.js');
    for (const action of ['cart.add', 'navigation.goto']) {
        const f = fixture({href: '#action/' + action + '?productNumber=3356-221'});
        const calls = [], pages = [], host = Object.create(HraiznDivinoChat.prototype);
        Object.assign(host, {
            chatUrl: new URL('https://chat.example/example/m/widget'), base: new URL(shop + '/weine'), basePath: '/weine/',
            win: {location: {origin: shop}, setTimeout, clearTimeout},
            iframe: {contentWindow: f.win}, requests: new Map(), handshakeId: null, cartBusy: false, token: null,
            routes: {session: shop + '/weine/session', cartAdd: shop + '/weine/cart/add', product: shop + '/weine/product'},
            actions: new Map([['cart.add', {mutating: true, execute: (...args) => host.addToCart(...args)}],
                ['navigation.goto', {mutating: false, execute: (...args) => host.navigateProduct(...args)}]]),
            storefront: {navigate: async url => {pages.push(url); return true;}}, showCart: async () => pages.push('cart'),
            json: async (url, options) => {
                calls.push({url, options});
                if (url.endsWith('/session')) return {ok: true, body: {success: true, token: 'a'.repeat(64)}};
                if (options?.method === 'POST') return {ok: true, body: {success: true, productNumber: '3356-221', acceptedQuantity: 1}};
                return {ok: true, body: {success: true, product: {id: 'a'.repeat(32), productNumber: '3356-221', detailUrl: shop + '/weine/bacchus/3356-221'}}};
            }
        });
        f.win.postMessage = data => f.receive(data);
        const hello = f.messages[0].data;
        await host.onMessage({origin: f.win.location.origin, source: f.win, data: hello});
        assert.equal(calls.length, 0); f.click();
        // The backend relay's validation is separately exercised by Python tests.
        f.relay();
        await host.onMessage({origin: f.win.location.origin, source: f.win, data: f.messages.at(-1).data});
        assert.ok(f.names.has('hraizn-action-link-success'));
        assert.equal(calls.filter(c => c.options?.method === 'POST').length, action === 'cart.add' ? 1 : 0);
        assert.equal(pages[0], action === 'cart.add' ? 'cart' : shop + '/weine/bacchus/3356-221');
        f.bridge.dispose();
    }
});
