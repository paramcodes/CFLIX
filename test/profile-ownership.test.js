import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { handleRequest } from '../server/index.js';

function createDispatcher(handler) {
  return async function dispatch({
    method = 'GET',
    path = '/',
    headers = {},
    body = null,
  } = {}) {
    const req = new Readable({
      read() {
        if (body != null)
          this.push(typeof body === 'string' ? body : JSON.stringify(body));
        this.push(null);
      },
    });
    req.method = method;
    req.url = path;
    req.headers = { host: 'localhost:3000', ...headers };

    let statusCode = 200;
    const responseHeaders = {};
    let responseBody = '';
    let resolve;
    const res = new EventEmitter();
    res.writeHead = (status, hdrs) => {
      if (status != null) statusCode = status;
      if (hdrs) Object.assign(responseHeaders, hdrs);
      return res;
    };
    res.setHeader = (key, value) => {
      responseHeaders[key.toLowerCase()] = value;
      return res;
    };
    res.end = (chunk) => {
      if (chunk) responseBody += chunk;
      let json = null;
      try {
        json = JSON.parse(responseBody);
      } catch {}
      resolve({ status: statusCode, body: responseBody, json });
    };
    const promise = new Promise((r) => {
      resolve = r;
    });
    await handler(req, res);
    return promise;
  };
}

const api = createDispatcher(handleRequest);

const stamp = Date.now().toString(36);
const A = { email: `own_a_${stamp}@test.dev`, password: 'pw123' };
const B = { email: `own_b_${stamp}@test.dev`, password: 'pw123' };

const signup = (acct) => async () =>
  api({ method: 'POST', path: '/api/auth/signup', body: acct }).then(
    (r) => r.json.session.token,
  );

let tokenA;
let tokenB;
let profileA;
let profileB;

describe('a profile id is bound to the account that presents it', () => {
  it('sets up two accounts, each with its own profile', async () => {
    tokenA = await signup(A)();
    tokenB = await signup(B)();
    assert.ok(tokenA);
    assert.ok(tokenB);
    assert.notEqual(tokenA, tokenB);

    profileA = (
      await api({
        method: 'POST',
        path: '/api/profiles',
        headers: { authorization: `Bearer ${tokenA}` },
        body: { name: 'Alice', maturity: 'adult' },
      })
    ).json.id;
    profileB = (
      await api({
        method: 'POST',
        path: '/api/profiles',
        headers: { authorization: `Bearer ${tokenB}` },
        body: { name: 'BobChild', maturity: 'child' },
      })
    ).json.id;
    assert.ok(profileA);
    assert.ok(profileB);
    assert.notEqual(profileA, profileB);
  });

  it('rejects a write into another account profile with the unknown-profile 404', async () => {
    const res = await api({
      method: 'POST',
      path: '/api/progress',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'x-cflix-profile': profileA,
      },
      body: { itemId: 'seed:m1', seconds: 111 },
    });
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, {
      error: { code: 'NOT_FOUND', message: 'no such profile' },
    });
  });

  it('rejects a read of another account watch history with the same 404', async () => {
    const res = await api({
      method: 'GET',
      path: '/api/history',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'x-cflix-profile': profileA,
      },
    });
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, {
      error: { code: 'NOT_FOUND', message: 'no such profile' },
    });
  });

  it('rejects browsing as another account profile with the same 404', async () => {
    const res = await api({
      method: 'GET',
      path: '/api/catalog/browse?kind=movie',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'x-cflix-profile': profileA,
      },
    });
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, {
      error: { code: 'NOT_FOUND', message: 'no such profile' },
    });
  });

  it('rejects another account profile on search, get, related and play too', async () => {
    const calls = [
      {
        method: 'POST',
        path: '/api/catalog/search',
        body: { text: '' },
      },
      { method: 'GET', path: '/api/catalog/get?id=seed:m1' },
      { method: 'GET', path: '/api/catalog/related?id=seed:m1' },
      { method: 'POST', path: '/api/play', body: { ref: { id: 'seed:m1' } } },
    ];
    for (const call of calls) {
      const res = await api({
        ...call,
        headers: {
          authorization: `Bearer ${tokenB}`,
          'x-cflix-profile': profileA,
        },
      });
      assert.equal(
        res.status,
        404,
        `${call.path} must reject a foreign profile`,
      );
      assert.deepEqual(res.json, {
        error: { code: 'NOT_FOUND', message: 'no such profile' },
      });
    }
  });

  it('answers a foreign profile exactly like an id that does not exist', async () => {
    const foreign = await api({
      method: 'GET',
      path: '/api/history',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'x-cflix-profile': profileA,
      },
    });
    const absent = await api({
      method: 'GET',
      path: '/api/history',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'x-cflix-profile': 'p_does_not_exist_at_all',
      },
    });
    assert.equal(absent.status, 404);
    assert.equal(foreign.status, absent.status);
    assert.equal(foreign.body, absent.body);
  });

  it('leaves the owner able to use her own profile', async () => {
    const browse = await api({
      method: 'GET',
      path: '/api/catalog/browse?kind=movie',
      headers: {
        authorization: `Bearer ${tokenA}`,
        'x-cflix-profile': profileA,
      },
    });
    assert.equal(browse.status, 200);
    assert.ok(browse.json.items.length > 0, 'owner sees her own catalog');

    const write = await api({
      method: 'POST',
      path: '/api/progress',
      headers: {
        authorization: `Bearer ${tokenA}`,
        'x-cflix-profile': profileA,
      },
      body: { itemId: 'seed:m1', seconds: 42 },
    });
    assert.equal(write.status, 200);

    const history = await api({
      method: 'GET',
      path: '/api/history',
      headers: {
        authorization: `Bearer ${tokenA}`,
        'x-cflix-profile': profileA,
      },
    });
    assert.equal(history.status, 200);
    assert.equal(history.json.items.length, 1);
    assert.equal(history.json.items[0].seconds, 42);
  });

  it('still gates a child profile on the maturity of its own profile', async () => {
    const asChild = await api({
      method: 'GET',
      path: '/api/catalog/browse?kind=movie',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'x-cflix-profile': profileB,
      },
    });
    assert.equal(asChild.status, 200);
    assert.ok(
      asChild.json.items.every((item) => item.maturity !== 'adult'),
      'child profile received an adult title',
    );

    const asOwner = await api({
      method: 'GET',
      path: '/api/catalog/browse?kind=movie',
      headers: {
        authorization: `Bearer ${tokenA}`,
        'x-cflix-profile': profileA,
      },
    });
    assert.ok(
      asOwner.json.items.some((item) => item.maturity === 'adult'),
      'adult profile received no adult title, so the gate is over-blocking',
    );
    assert.ok(
      asOwner.json.items.length > asChild.json.items.length,
      'adult profile sees no more titles than the child profile',
    );
  });

  it('still answers 401 with no token at all', async () => {
    const res = await api({
      method: 'GET',
      path: '/api/catalog/browse',
      headers: { 'x-cflix-profile': profileA },
    });
    assert.equal(res.status, 401);
  });

  it('still lists and creates profiles without blocking on the header', async () => {
    const list = await api({
      method: 'GET',
      path: '/api/profiles',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'x-cflix-profile': profileA,
      },
    });
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.json.items.map((p) => p.id),
      [profileB],
    );

    const created = await api({
      method: 'POST',
      path: '/api/profiles',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'x-cflix-profile': profileB,
      },
      body: { name: 'BobSecond' },
    });
    assert.equal(created.status, 200);
    assert.ok(created.json.id);
    assert.notEqual(created.json.id, profileB);

    const after = await api({
      method: 'GET',
      path: '/api/profiles',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.deepEqual(
      after.json.items.map((p) => p.id).sort(),
      [created.json.id, profileB].sort(),
    );
  });
});
