import { describe, it, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { handleRequest } from '../server/index.js';
import { db } from '../server/src/store.js';

/**
 * `recordProgress` and `history` are the only two service methods that reach a profile without
 * passing the resolved item through `visibleTo`. Before the fix a child could POST the id of an
 * adult title, the row was written with no gate at all, and `GET /api/history` handed the adult
 * title back whole: title, synopsis, poster, backdrop, rendered into that child's own Continue
 * Watching rail. No second account was needed, which made it worse than a cross-account hole.
 *
 * The two paths need separate proof. The write gate means a child can no longer create a gated
 * row through the API, which leaves the read gate unreachable that way, so the read filter is
 * exercised against rows injected straight into the store. An HTTP-only suite would report the
 * read gate as covered while nothing in it ever ran.
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

/**
 * Writes a progress row the way the store holds one, bypassing `recordProgress` so a gated row
 * exists for a profile that could never have created it through the API. This is how a row gets
 * there in production too: an older build, a restored database, a title re-rated after the fact,
 * or any future writer that has not been gated yet. The read path is what has to hold then.
 */
const injectRow = (profileId, itemId, seconds, ageMs = 0) => {
  db.progress.set(`${profileId}:${itemId}`, {
    profileId,
    itemId,
    seconds,
    updatedAt: new Date(Date.now() - ageMs).toISOString(),
  });
};

const post = (path, profileId, token, body) =>
  api('POST', path, { token, profileId, body });
const get = (path, profileId, token) => api('GET', path, { token, profileId });

describe('Progress and history obey the maturity gate', () => {
  const email = `s4-progress-${Date.now()}@test.dev`;
  let token;
  let child;
  let adult;

  const freshProfile = async (name, maturity) => {
    const res = await post('/api/profiles', null, token, { name, maturity });
    assert.equal(res.status, 200);
    return res.json.id;
  };

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

  it('drops an injected gated row from history, and the gate is what drops it', async () => {
    // The write gate above means a child can no longer create these rows through the API, so this
    // is the only way the read filter is reachable. Rows go in raw: an adult movie, a teen
    // episode with no rating of its own, and a child-rated movie the child is entitled to.
    //
    // Dedicated profiles, not the ones the other tests write through the API, so the row counts
    // asserted there are this test's business alone.
    const kid = await freshProfile('Injected Child', 'child');
    const gated = ['seed:m4', 'seed:s1:1:1'];
    for (const [index, itemId] of gated.entries()) {
      injectRow(kid, itemId, 120, index * 1000);
    }
    injectRow(kid, 'seed:m3', 30, 2000);

    const childHistory = (await get('/api/history', kid, token)).json.items;
    const childIds = childHistory.map((row) => row.itemId).sort();

    assert.deepEqual(
      childIds,
      ['seed:m3'],
      'history returned a row the child profile may not see',
    );
    for (const row of childHistory) {
      assert.ok(row.item, 'the entitled row must still carry its item');
      assert.equal(row.item.title, CHILD_TITLE);
      assert.equal(row.item.maturity, 'child');
      assert.equal(row.item.source, 'seed');
    }
    // Asserted on the row set, not only on the items, so a filter that nulled the item instead of
    // dropping the row could not pass.
    for (const itemId of gated) {
      assert.ok(
        !childIds.includes(itemId),
        `gated row ${itemId} was returned to a child profile`,
      );
    }
  });

  it('shows the adult profile the same injected rows the child is denied', async () => {
    // The anti-over-blocking half of the injected case: the read gate must not be so broad that
    // it strips legitimate history. Same rows, same store, one profile may see them and one may
    // not, which is what makes the denial above the gate acting rather than rows simply missing.
    const grown = await freshProfile('Injected Adult', 'adult');
    for (const [index, itemId] of ['seed:m4', 'seed:s1:1:1'].entries()) {
      injectRow(grown, itemId, 120, index * 1000);
    }
    injectRow(grown, 'seed:m3', 30, 2000);

    const rows = (await get('/api/history', grown, token)).json.items;
    const injected = rows.filter((row) =>
      ['seed:m3', 'seed:m4', 'seed:s1:1:1'].includes(row.itemId),
    );

    // Sorted against a literal, so an empty or short result cannot satisfy this.
    assert.deepEqual(
      injected.map((row) => row.itemId).sort(),
      ['seed:m3', 'seed:m4', 'seed:s1:1:1'],
      'an entitled adult row went missing',
    );

    const byId = Object.fromEntries(injected.map((row) => [row.itemId, row]));
    assert.equal(byId['seed:m4'].item.title, ADULT_TITLE);
    assert.equal(byId['seed:m4'].item.maturity, 'adult');
    assert.equal(byId['seed:s1:1:1'].item.maturity, 'teen');
    assert.equal(byId['seed:s1:1:1'].item.title, 'Secret');
    assert.equal(byId['seed:m3'].item.maturity, 'child');
    for (const row of injected) {
      assert.ok(row.item, `row ${row.itemId} lost its item`);
      assert.equal(row.item.source, 'seed');
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
