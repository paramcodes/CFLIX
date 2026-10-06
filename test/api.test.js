import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { handleRequest } from '../server/index.js';

/**
 * In-memory HTTP request dispatcher.
 * Simulates Node's IncomingMessage and ServerResponse streams in memory
 * to achieve sub-millisecond execution without binding OS network sockets.
 */
function createDispatcher(handler) {
  return async function dispatch({
    method = 'GET',
    path = '/',
    headers = {},
    body = null,
  } = {}) {
    const req = new Readable({
      read() {
        if (body != null) {
          const payload =
            typeof body === 'string' ? body : JSON.stringify(body);
          this.push(payload);
        }
        this.push(null);
      },
    });

    req.method = method;
    req.url = path;
    req.headers = { host: 'localhost:3000', ...headers };

    let statusCode = 200;
    const responseHeaders = {};
    let responseBody = '';

    const res = new EventEmitter();
    res.writeHead = (status, hdrs) => {
      statusCode = status;
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
      } catch {
        // Body is not JSON (HTML/CSS)
      }
      resolve({
        status: statusCode,
        headers: responseHeaders,
        body: responseBody,
        json,
      });
    };

    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });

    await handler(req, res);
    return promise;
  };
}

const api = createDispatcher(handleRequest);

test('Fast In-Memory Test Suite (node:test)', async (t) => {
  const testEmail = `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.dev`;
  let token = null;
  let kidProfileId = null;
  let adultProfileId = null;

  await t.test('Static assets and security barriers', async () => {
    const home = await api({ path: '/' });
    assert.equal(home.status, 200);
    assert.ok(home.headers.etag, 'carries ETag');

    const notFound = await api({ path: '/non-existent-file.xyz' });
    assert.equal(notFound.status, 404);

    const oldRoute = await api({ path: '/prototype-index.html' });
    assert.equal(oldRoute.status, 404);
  });

  await t.test('ACL / Parse Boundary: input validation guards', async () => {
    // Malformed email
    const badEmail = await api({
      method: 'POST',
      path: '/api/auth/signup',
      body: { email: 'not-an-email', password: 'password123' },
    });
    assert.equal(badEmail.status, 400);
    assert.equal(badEmail.json?.error?.code, 'VALIDATION');

    // Missing password
    const noPassword = await api({
      method: 'POST',
      path: '/api/auth/signup',
      body: { email: 'valid@test.dev', password: '' },
    });
    assert.equal(noPassword.status, 400);
    assert.equal(noPassword.json?.error?.code, 'VALIDATION');

    // Invalid maturity level
    const badMaturity = await api({
      method: 'POST',
      path: '/api/profiles',
      headers: { authorization: 'Bearer bogus' },
      body: { name: 'Test', maturity: 'super-adult' },
    });
    // Bogus token should fail 401 before profile creation
    assert.equal(badMaturity.status, 401);
  });

  await t.test('Auth lifecycle: signup and signin', async () => {
    const signup = await api({
      method: 'POST',
      path: '/api/auth/signup',
      body: { email: testEmail, password: 'pw123' },
    });
    assert.equal(signup.status, 200);
    assert.ok(signup.json?.session?.token);
    token = signup.json.session.token;

    // Duplicate email rejected
    const dup = await api({
      method: 'POST',
      path: '/api/auth/signup',
      body: { email: testEmail, password: 'pw123' },
    });
    assert.equal(dup.status, 400);
    assert.equal(dup.json?.error?.code, 'EMAIL_TAKEN');

    // Signin works
    const signin = await api({
      method: 'POST',
      path: '/api/auth/signin',
      body: { email: testEmail, password: 'pw123' },
    });
    assert.equal(signin.status, 200);

    // Bad password rejected
    const badPw = await api({
      method: 'POST',
      path: '/api/auth/signin',
      body: { email: testEmail, password: 'wrong-password' },
    });
    assert.equal(badPw.status, 400);
  });

  await t.test('Profile management & maturity levels', async () => {
    const kid = await api({
      method: 'POST',
      path: '/api/profiles',
      headers: { authorization: `Bearer ${token}` },
      body: { name: 'Junior', maturity: 'child' },
    });
    assert.equal(kid.status, 200);
    kidProfileId = kid.json.id;

    const adult = await api({
      method: 'POST',
      path: '/api/profiles',
      headers: { authorization: `Bearer ${token}` },
      body: { name: 'Senior', maturity: 'adult' },
    });
    assert.equal(adult.status, 200);
    adultProfileId = adult.json.id;

    const list = await api({
      method: 'GET',
      path: '/api/profiles',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(list.status, 200);
    assert.equal(list.json.items.length, 2);
  });

  await t.test('Profile without maturity defaults to adult', async () => {
    const res = await api({
      method: 'POST',
      path: '/api/profiles',
      headers: { authorization: `Bearer ${token}` },
      body: { name: 'Unspecified' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.maturity, 'adult');
  });

  await t.test('Catalog maturity invariant enforcement', async () => {
    // Child profile must never see adult content
    const childSearch = await api({
      method: 'POST',
      path: '/api/catalog/search',
      headers: {
        authorization: `Bearer ${token}`,
        'x-cflix-profile': kidProfileId,
      },
      body: { text: '' },
    });
    assert.equal(childSearch.status, 200);
    assert.ok(
      childSearch.json.items.every((item) => item.maturity !== 'adult'),
      'Child profile received adult item',
    );

    // Adult profile sees adult content
    const adultSearch = await api({
      method: 'POST',
      path: '/api/catalog/search',
      headers: {
        authorization: `Bearer ${token}`,
        'x-cflix-profile': adultProfileId,
      },
      body: { text: '' },
    });
    assert.equal(adultSearch.status, 200);
    assert.ok(
      adultSearch.json.items.some((item) => item.maturity === 'adult'),
      'Adult profile did not receive adult items',
    );
  });

  await t.test('Playback resolution, progress, and history', async () => {
    // Play series ref resolves next episode
    const play = await api({
      method: 'POST',
      path: '/api/play',
      headers: {
        authorization: `Bearer ${token}`,
        'x-cflix-profile': adultProfileId,
      },
      body: { ref: { kind: 'series', id: 'seed:s1' } },
    });
    assert.equal(play.status, 200);
    assert.equal(play.json?.item?.id, 'seed:s1:1:1');

    // Record progress
    const progress = await api({
      method: 'POST',
      path: '/api/progress',
      headers: {
        authorization: `Bearer ${token}`,
        'x-cflix-profile': adultProfileId,
      },
      body: { itemId: 'seed:s1:1:1', seconds: 150 },
    });
    assert.equal(progress.status, 200);

    // History reflects progress
    const history = await api({
      method: 'GET',
      path: '/api/history',
      headers: {
        authorization: `Bearer ${token}`,
        'x-cflix-profile': adultProfileId,
      },
    });
    assert.equal(history.status, 200);
    assert.equal(history.json.items.length, 1);
    assert.equal(history.json.items[0].seconds, 150);

    // Next play resolves second episode
    const nextPlay = await api({
      method: 'POST',
      path: '/api/play',
      headers: {
        authorization: `Bearer ${token}`,
        'x-cflix-profile': adultProfileId,
      },
      body: { ref: { kind: 'series', id: 'seed:s1' } },
    });
    assert.equal(nextPlay.status, 200);
    assert.equal(nextPlay.json?.item?.id, 'seed:s1:1:2');
  });
});
