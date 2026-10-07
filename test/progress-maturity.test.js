import { describe, it, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { handleRequest } from '../server/index.js';

/**
 * `recordProgress` and `history` are the only two service methods that reach a profile without
 * passing the resolved item through `visibleTo`. Before the fix a child could POST the id of an
 * adult title, the row was written with no gate at all, and `GET /api/history` handed the adult
 * title back whole: title, synopsis, poster, backdrop, rendered into that child's own Continue
 * Watching rail. No second account was needed, which made it worse than a cross-account hole.
 */

const api = (() => {
  const dispatch = async ({
    method = 'GET',
    path = '/',
    headers = {},
    body = null,
  } = {}) => {
    const req = new Readable({
      read() {
        if (body != null) {
          this.push(typeof body === 'string' ? body : JSON.stringify(body));
        }
        this.push(null);
      },
    });
    req.method = method;
    req.url = path;
    req.headers = { host: 'localhost:3000', ...headers };

    let statusCode = 200;
    let responseBody = '';
    let settle;
    const done = new Promise((resolve) => {
      settle = resolve;
    });

    const res = new EventEmitter();
    res.writeHead = (status) => {
      statusCode = status;
      return res;
    };
    res.setHeader = () => res;
    res.end = (chunk) => {
      if (chunk) responseBody += chunk;
      let json = null;
      try {
        json = JSON.parse(responseBody);
      } catch {
        // non-JSON response
      }
      settle({ status: statusCode, body: responseBody, json });
    };

    await handleRequest(req, res);
    return done;
  };

  return async (method, path, { token, profileId, body } = {}) => {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (profileId) headers['x-cflix-profile'] = profileId;
    if (body != null) headers['content-type'] = 'application/json';
    return dispatch({ method, path, headers, body });
  };
})();

/** Fixture ratings, read from server/src/catalog-data.js: m3 child, m4 adult, s1 teen. */
const CHILD_TITLE = 'Kids Cartoon Movie';
const ADULT_TITLE = 'Red Harvest';

const post = (path, profileId, token, body) =>
  api('POST', path, { token, profileId, body });
const get = (path, profileId, token) => api('GET', path, { token, profileId });

describe('Progress and history obey the maturity gate', () => {
  const email = `s4-progress-${Date.now()}@test.dev`;
  let token;
  let child;
  let adult;

  beforeAll(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { email, password: 'pw123' },
    });
    assert.equal(signup.status, 200);
    token = signup.json.session.token;

    const kid = await post('/api/profiles', null, token, {
      name: 'Kid',
      maturity: 'child',
    });
    assert.equal(kid.status, 200);
    child = kid.json.id;

    const grown = await post('/api/profiles', null, token, {
      name: 'Adult',
      maturity: 'adult',
    });
    assert.equal(grown.status, 200);
    adult = grown.json.id;
  });

  it('refuses to record progress for a title the profile cannot see', async () => {
    const before = (await get('/api/history', child, token)).json.items;

    const res = await post('/api/progress', child, token, {
      itemId: 'seed:m4',
      seconds: 600,
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'MATURITY_BLOCKED');
    assert.equal(res.json.error.message, 'not available for this profile');

    const after = (await get('/api/history', child, token)).json.items;
    assert.equal(
      after.length,
      before.length,
      'the refused write must not create or update a row',
    );
    assert.ok(
      after.every((row) => row.item?.title !== ADULT_TITLE),
      'the refused write must not surface the adult title in history',
    );
  });

  it('answers an id that names nothing exactly as it answers a gated one', async () => {
    const gated = await post('/api/progress', child, token, {
      itemId: 'seed:m4',
      seconds: 1,
    });
    const absent = await post('/api/progress', child, token, {
      itemId: 'seed:no-such-title',
      seconds: 1,
    });

    // Two different ids, one answer: a caller cannot use this endpoint to learn which adult
    // titles exist. The status is pinned first so this reads as a leak on a tree where the gate
    // is missing, rather than as a byte difference between two echoed rows.
    assert.equal(gated.status, 400);
    assert.deepEqual(absent.json, gated.json);
  });

  it('never returns an adult item to a child, even from a row written before the gate', async () => {
    // The adult profile records the same title, which proves history has something to leak and
    // stops an empty child result from satisfying this check on its own.
    const recorded = await post('/api/progress', adult, token, {
      itemId: 'seed:m4',
      seconds: 600,
    });
    assert.equal(recorded.status, 200);

    const adultHistory = (await get('/api/history', adult, token)).json.items;
    assert.equal(adultHistory.length, 1);
    assert.equal(adultHistory[0].item.title, ADULT_TITLE);
    assert.equal(adultHistory[0].item.maturity, 'adult');
    assert.equal(adultHistory[0].item.id, 'seed:m4');

    const childHistory = (await get('/api/history', child, token)).json.items;
    assert.deepEqual(
      childHistory.map((row) => row.item?.title).filter(Boolean),
      [],
      'a child profile received an adult item from history',
    );
    for (const row of childHistory) {
      assert.notEqual(row.itemId, 'seed:m4');
      assert.ok(
        row.item === null || row.item.maturity !== 'adult',
        `history row ${row.itemId} carried an adult item to a child profile`,
      );
    }
  });

  it('still records and returns a title the profile is allowed to see', async () => {
    // The anti-over-blocking half: a child keeps a full Continue Watching entry, and an episode
    // inherits its series rating rather than vanishing for want of one of its own.
    const movie = await post('/api/progress', child, token, {
      itemId: 'seed:m3',
      seconds: 30,
    });
    assert.equal(movie.status, 200);
    assert.equal(movie.json.itemId, 'seed:m3');
    assert.equal(movie.json.seconds, 30);

    const teenEpisode = await post('/api/progress', child, token, {
      itemId: 'seed:s1:1:1',
      seconds: 45,
    });
    // seed:s1 is rated teen, so a child may not watch it and may not record it.
    assert.equal(teenEpisode.status, 400);
    assert.equal(teenEpisode.json.error.code, 'MATURITY_BLOCKED');

    const adultEpisode = await post('/api/progress', adult, token, {
      itemId: 'seed:s1:1:1',
      seconds: 45,
    });
    assert.equal(adultEpisode.status, 200);

    const childHistory = (await get('/api/history', child, token)).json.items;
    assert.equal(childHistory.length, 1);
    assert.equal(childHistory[0].item.title, CHILD_TITLE);
    assert.equal(childHistory[0].item.maturity, 'child');
    assert.equal(childHistory[0].item.source, 'seed');
    assert.equal(childHistory[0].seconds, 30);

    const adultHistory = (await get('/api/history', adult, token)).json.items;
    assert.equal(adultHistory.length, 2);
    const episodeRow = adultHistory.find((row) => row.itemId === 'seed:s1:1:1');
    assert.ok(episodeRow, 'the adult lost a legitimately watched episode');
    assert.equal(episodeRow.item.maturity, 'teen');
    assert.equal(episodeRow.item.source, 'seed');
  });

  it('still lets an adult profile record and read the adult title', async () => {
    const res = await post('/api/progress', adult, token, {
      itemId: 'seed:m4',
      seconds: 900,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.itemId, 'seed:m4');

    const rows = (await get('/api/history', adult, token)).json.items;
    const row = rows.find((r) => r.itemId === 'seed:m4');
    assert.ok(row, 'the adult profile lost the adult title from history');
    assert.equal(row.item.title, ADULT_TITLE);
    assert.equal(row.item.maturity, 'adult');
    assert.equal(row.seconds, 900);
  });
});
