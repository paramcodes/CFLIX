const B = process.env.PORT
  ? `http://localhost:${process.env.PORT}`
  : 'http://localhost:3000';
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}
async function req(method, path, body, token, profileId) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (profileId) headers['x-cflix-profile'] = profileId;
  const res = await fetch(B + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const smokeEmail =
  process.env.SMOKE_EMAIL ||
  `smoke_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@test.dev`;

let r = await req('POST', '/api/auth/signup', {
  email: smokeEmail,
  password: 'pw123',
});
check('signup returns token', !!r.data.session?.token);
r = await req('POST', '/api/auth/signin', {
  email: smokeEmail,
  password: 'pw123',
});
check('signin works', r.status === 200);
const token = r.data.session.token;
r = await req('POST', '/api/auth/signin', {
  email: smokeEmail,
  password: 'wrong',
});
check('bad password rejected', r.status === 400);

r = await req('POST', '/api/auth/google', { idToken: `google:${smokeEmail}` });
check(
  'google merges same email',
  r.data.user?.email === smokeEmail && r.status === 200,
);

r = await req(
  'POST',
  '/api/profiles',
  { name: 'Kid', maturity: 'child' },
  token,
);
const kidId = r.data.id;
r = await req(
  'POST',
  '/api/profiles',
  { name: 'Grownup', maturity: 'adult' },
  token,
);
const adultId = r.data.id;
r = await req('GET', '/api/profiles', null, token);
check('two profiles listed', r.data.items.length === 2);

r = await req('POST', '/api/catalog/search', { text: '' }, token, kidId);
check(
  'child profile sees no adult titles',
  r.data.items.every((i) => i.maturity !== 'adult'),
);
r = await req('POST', '/api/catalog/search', { text: '' }, token, adultId);
check(
  'adult profile sees adult titles',
  r.data.items.some((i) => i.maturity === 'adult'),
);
r = await req(
  'POST',
  '/api/catalog/search',
  { text: 'dark', kind: 'series' },
  token,
  adultId,
);
check(
  'search filters series by title',
  r.data.items.length === 1 && r.data.items[0].title === 'Dark',
);

r = await req(
  'POST',
  '/api/play',
  { ref: { kind: 'series', id: 's1' } },
  token,
  adultId,
);
check('series play resolves to episode', r.data.item?.id === 's1e1');
await req(
  'POST',
  '/api/progress',
  { itemId: 's1e1', seconds: 120 },
  token,
  adultId,
);
r = await req(
  'POST',
  '/api/play',
  { ref: { kind: 'series', id: 's1' } },
  token,
  adultId,
);
check('second play picks next episode', r.data.item?.id === 's1e2');
r = await req('GET', '/api/history', null, token, adultId);
check(
  'history has the recorded item',
  r.data.items.length === 1 && r.data.items[0].seconds === 120,
);

r = await req(
  'POST',
  '/api/play',
  { ref: { kind: 'movie', id: 'm4' } },
  token,
  kidId,
);
check(
  'child blocked from adult movie',
  r.status === 400 && r.data.error.code === 'MATURITY_BLOCKED',
);

r = await req('GET', '/api/profiles', null, 'bogus');
check('bogus token rejected', r.status === 401);

for (const p of ['/', '/signin', '/profiles', '/home', '/title', '/watch']) {
  const res = await fetch(B + p);
  check(`route ${p} returns 200`, res.status === 200);
}
for (const p of [
  '/' + 'screens' + '/05-home-page.html',
  '/prototype-index.html',
]) {
  const res = await fetch(B + p);
  check(`old route ${p} returns 404`, res.status === 404);
}

{
  const res = await fetch(B + '/base.css');
  const etag = res.headers.get('etag');
  check('static 200 carries etag', !!etag);
  check(
    'static 200 carries no-cache',
    res.headers.get('cache-control') === 'no-cache',
  );
  const again = await fetch(B + '/base.css', {
    headers: { 'if-none-match': etag },
  });
  const againBody = await again.text();
  check(
    'matching If-None-Match returns 304 with empty body',
    again.status === 304 && againBody === '',
  );
}

{
  const res = await fetch(B + '/api/profiles', {
    headers: { authorization: 'Bearer bogus' },
  });
  check(
    'api response carries no-store',
    res.headers.get('cache-control') === 'no-store',
  );
}

{
  const res = await fetch(B + '/auth-bg.webp');
  check(
    'webp serves image/webp',
    res.status === 200 &&
      (res.headers.get('content-type') || '').startsWith('image/webp'),
  );
}

process.exit(failures ? 1 : 0);
