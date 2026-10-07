#!/usr/bin/env node
/**
 * The request boundary, asserted against a real server over a real socket.
 *
 * PR #66 claimed the whole listener body sits in a try/catch so a hostile request cannot take the
 * process down. Two defects made that claim false, and nothing in the suite could see either one:
 * `test/api.test.js` drives `handleRequest` through a stubbed `res` whose `writeHead` never throws
 * and which carries no `headersSent`, so the server's real socket and header state are invisible to
 * it. So this script boots the exported `server` on a loopback socket and drives it the way a
 * client does.
 *
 *   - a malformed request answers 400 and the server keeps serving, before and after. `origin/main`
 *     had no guard at all, so `new URL(req.url, ...)` threw out of the listener and the process died.
 *   - a response body that cannot be serialized answers 500 `INTERNAL` with no Node error detail,
 *     and no rejection reaches the process. `json()` used to call `writeHead` before
 *     `JSON.stringify`, so a circular body left headers already sent and `sendError` died with
 *     ERR_HTTP_HEADERS_SENT from inside the catch.
 *
 * The circular probe is added to the exported `routes` object in this process only and deleted
 * before the run ends: no shipped request can return an unserializable body today, so the defect
 * needs an injected one to be observable. `server/index.js` itself declares no probe route.
 *
 * Hermetic by construction: an in-memory database, `PROVIDER=off`, and every request goes to
 * 127.0.0.1 on an ephemeral port.
 */
process.env.CFLIX_DB_PATH = process.env.CFLIX_DB_PATH || ':memory:';
process.env.PROVIDER = process.env.PROVIDER || 'off';

import { connect } from 'node:net';

const { server, routes } = await import('../server/index.js');

const PROBE_KEY = 'GET /__boundary-probe/circular';
/** Substrings of a Node failure that must never reach the client. */
const LEAKS = ['ERR_', 'TypeError', 'Converting', 'circular'];

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}\n        got      ${JSON.stringify(actual)}` +
      (ok ? '' : `\n        expected ${JSON.stringify(expected)}`),
  );
}

/**
 * An escaping rejection is a process death under Node's default, which is how both defects kill the
 * server. Observing it turns the crash into a named failure instead of an exit code.
 */
const escaped = [];
process.on('unhandledRejection', (reason) => escaped.push(reason));
// Monitor only: this reports a crash, it must never keep one alive.
process.on('uncaughtExceptionMonitor', (err) => escaped.push(err));

function listen() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close() {
  // A request left half-written keeps its socket open, and `close()` waits for open connections.
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

/**
 * A server that died mid-run must read as a FAIL, not as a rejected promise: these helpers resolve
 * with `status: null` so one dead server cannot mask the assertions after it.
 */
async function rawRequest(port, requestLine, hostHeader) {
  const dead = { status: null, body: '', error: 'no response' };
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    let raw = '';
    socket.setEncoding('utf8');
    const fail = (error) => {
      socket.destroy();
      resolve({ ...dead, error });
    };
    socket.setTimeout(4000, () => fail(`no response to ${requestLine}`));
    socket.once('error', (err) =>
      resolve({ ...dead, error: err.code || err.message }),
    );
    socket.once('connect', () => {
      socket.write(
        `${requestLine}\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`,
      );
    });
    socket.on('data', (chunk) => {
      raw += chunk;
    });
    socket.once('end', () => resolve(parseRaw(raw)));
  });
}

function parseRaw(raw) {
  const [head = '', body = ''] = raw.split('\r\n\r\n');
  return { status: Number(head.split(' ')[1]), body, error: null };
}

/** A parsed body, or `{}` when the server answered with something that is not JSON. */
function envelope(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const port = await listen();
const base = `http://127.0.0.1:${port}`;

async function call(method, path, body) {
  try {
    // A half-written response (headers sent, body never ended) hangs `fetch` forever, which is
    // exactly the state the circular-body probe produced before `json` was reordered.
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(4000),
    });
    return { status: res.status, raw: await res.text(), error: null };
  } catch (err) {
    return { status: null, raw: '', error: err.cause?.code ?? err.name };
  }
}

/** `[status, error.code]`, or `[status, error]` so a dead server is visibly not a 400. */
const codeOf = (res) => [
  res.status,
  envelope(res.body ?? res.raw).error?.code ?? res.error ?? null,
];

try {
  check('before: the server answers 200', (await call('GET', '/')).status, 200);

  // A protocol-relative target with no authority: `new URL('//', base)` throws ERR_INVALID_URL.
  check(
    'a malformed request target answers 400 BAD_REQUEST',
    codeOf(await rawRequest(port, 'GET //', 'localhost')),
    [400, 'BAD_REQUEST'],
  );

  // Same failure from the other side of `requestUrl`: a Host header no URL can be built from.
  check(
    'an unparseable Host header answers 400 BAD_REQUEST',
    codeOf(await rawRequest(port, 'GET /', 'bad host')),
    [400, 'BAD_REQUEST'],
  );

  check(
    'after: the server still answers 200',
    (await call('GET', '/')).status,
    200,
  );

  // A real route end to end, because a 200 on a static page can come from a server that is alive
  // but has already lost its API.
  const signup = await call('POST', '/api/auth/signup', {
    email: `boundary-${Date.now()}@test.dev`,
    password: 'pw123',
  });
  check(
    'after: the API still serves a live route',
    [signup.status, typeof envelope(signup.raw).session?.token],
    [200, 'string'],
  );

  routes[PROBE_KEY] = async () => {
    const circular = { note: 'unserializable body' };
    circular.self = circular;
    return circular;
  };
  const boom = await call('GET', '/__boundary-probe/circular');
  check('an unserializable body answers 500 INTERNAL', codeOf(boom), [
    500,
    'INTERNAL',
  ]);
  // Asserted against the whole literal body, not a scan: on `origin/main` the body never arrives at
  // all, and a substring scan over an empty string would pass on it.
  check(
    'the 500 body is the internal envelope, leaking no Node error code or message',
    [boom.raw, LEAKS.filter((leak) => boom.raw.includes(leak))],
    [
      JSON.stringify({
        error: { code: 'INTERNAL', message: 'internal error' },
      }),
      [],
    ],
  );
  check(
    'the server answers 200 again after the unserializable body',
    (await call('GET', '/')).status,
    200,
  );
} finally {
  delete routes[PROBE_KEY];
  await close();
}

check(
  'no rejection escaped the listener while serving those requests',
  escaped.map((reason) =>
    reason instanceof Error ? reason.code || reason.message : String(reason),
  ),
  [],
);

console.log(`\nBoundary Summary: ${checks - failures} PASS, ${failures} FAIL`);
process.exit(failures ? 1 : 0);
