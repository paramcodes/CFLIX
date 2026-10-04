import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const B = process.env.PORT
  ? `http://localhost:${process.env.PORT}`
  : 'http://localhost:3000';
const SHOTS = new URL('../artifacts/verify-cflix/nav-signout/', import.meta.url)
  .pathname;

let failures = 0;
function check(name, cond, detail = '') {
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  [${detail}]`}`,
  );
  if (!cond) failures++;
}

async function req(method, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(B + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const stamp = Date.now();

let r = await req('POST', '/api/auth/signup', {
  email: `api-signout-${stamp}@test.dev`,
  password: 'pw123',
});
const token = r.data.session?.token;
check('signup returns token', !!token);
r = await req('POST', '/api/auth/signout', null, token);
check('signout returns 200', r.status === 200, `status ${r.status}`);
check('signout body is ok', r.data.ok === true, JSON.stringify(r.data));
r = await req('POST', '/api/auth/signout', null, token);
check(
  'signout is idempotent on the second call',
  r.status === 200,
  `status ${r.status}`,
);
r = await req('POST', '/api/auth/signout', null, token);
check(
  'signout is idempotent on the third call',
  r.status === 200,
  `status ${r.status}`,
);
r = await req('GET', '/api/profiles', null, token);
check(
  'signed-out token is rejected with 401',
  r.status === 401,
  `status ${r.status}`,
);
r = await req('POST', '/api/auth/signout', null, null);
check(
  'signout without a token still returns 200',
  r.status === 200,
  `status ${r.status}`,
);

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('dialog', (d) => d.accept('other@test.dev'));
const shot = (name, opts) =>
  page.screenshot({ path: `${SHOTS}${name}`, ...opts });
const navShot = (name) =>
  page
    .locator('.nav')
    .first()
    .screenshot({ path: `${SHOTS}${name}` });
const openNavMenu = async () => {
  await page.locator('.nav__avatar').click();
  await page.waitForFunction(() =>
    document.activeElement?.classList?.contains('nav__menu-item'),
  );
};

await page.goto(`${B}/signin`);
await page.fill('#in-email', `nav-check-${stamp}@test.dev`);
await page.fill('#in-password', 'pw123456');
await page.click('#btn-signup');
await page.waitForURL('**/profiles');
for (const name of ['Alpha', 'Beta']) {
  await page.click('#add-profile');
  await page.fill('#dlg-name', name);
  await page.click('#dlg-create');
  await page.waitForFunction(
    (n) =>
      [
        ...document.querySelectorAll('#profile-list .avatar-tile[data-id]'),
      ].some((t) => t.dataset.name === n),
    name,
  );
}
await page.click('#profile-list .avatar-tile[data-name="Beta"]');
await page.waitForFunction(
  () => document.querySelector('#who')?.textContent === 'Watching as Beta',
);
await page.waitForSelector('#nav-menu [role="menuitem"]', {
  state: 'attached',
});

const navStruct = await page.evaluate(() => {
  const nav = document.querySelector('.nav');
  const tools = document.querySelector('.nav__tools');
  const bell = document.querySelector('.nav__bell');
  const avatar = document.querySelector('.nav__avatar');
  const menu = document.querySelector('.nav__menu');
  return {
    nav: !!nav,
    directSvgInTools: tools
      ? tools.querySelectorAll(':scope > svg').length
      : -1,
    magnifiers: nav ? nav.querySelectorAll('circle[cx="11"]').length : -1,
    bell: !!bell,
    bellDisabled: bell?.getAttribute('aria-disabled'),
    bellTitle: bell?.getAttribute('title'),
    bellLabel: bell?.getAttribute('aria-label'),
    avatarIsButton: avatar?.tagName === 'BUTTON',
    haspopup: avatar?.getAttribute('aria-haspopup'),
    expanded: avatar?.getAttribute('aria-expanded'),
    menuHidden: menu?.hidden,
    menuRole: menu?.getAttribute('role'),
    menuHiddenAttr: menu?.hasAttribute('hidden'),
  };
});
check('home has a .nav', navStruct.nav);
check(
  'no search magnifier svg left in nav__tools',
  navStruct.directSvgInTools === 0,
  String(navStruct.directSvgInTools),
);
check(
  'no magnifier circle anywhere in the nav',
  navStruct.magnifiers === 0,
  String(navStruct.magnifiers),
);
check('bell present', navStruct.bell);
check(
  'bell is aria-disabled',
  navStruct.bellDisabled === 'true',
  String(navStruct.bellDisabled),
);
check(
  'bell title says notifications are not implemented',
  navStruct.bellTitle === 'Notifications are not implemented yet',
  String(navStruct.bellTitle),
);
check(
  'bell has an accessible label',
  /not implemented/.test(navStruct.bellLabel || ''),
  String(navStruct.bellLabel),
);
check('avatar is a real button', navStruct.avatarIsButton);
check(
  'avatar has aria-haspopup=menu',
  navStruct.haspopup === 'menu',
  String(navStruct.haspopup),
);
check(
  'avatar starts aria-expanded=false',
  navStruct.expanded === 'false',
  String(navStruct.expanded),
);
check('menu starts hidden', navStruct.menuHidden && navStruct.menuHiddenAttr);
check(
  'menu carries role=menu',
  navStruct.menuRole === 'menu',
  String(navStruct.menuRole),
);
await navShot('01-home-nav-beta.png');

const bellEnabled = await page.locator('.nav__bell').isEnabled();
check(
  'assistive tooling sees the bell as disabled',
  bellEnabled === false,
  String(bellEnabled),
);
const beforeBell = page.url();
await page.click('.nav__bell', { force: true });
const bellState = await page.evaluate(() => ({
  hidden: document.querySelector('.nav__menu').hidden,
  expanded: document
    .querySelector('.nav__avatar')
    .getAttribute('aria-expanded'),
}));
check(
  'clicking the bell does nothing',
  page.url() === beforeBell &&
    bellState.hidden &&
    bellState.expanded === 'false',
  JSON.stringify(bellState),
);

await page.evaluate(() =>
  document.querySelector('.nav').classList.add('is-solid'),
);
await page.waitForTimeout(400);
const solidOn = await page.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('.nav'));
  return { position: cs.position, background: cs.backgroundImage };
});
check(
  'is-solid keeps the nav fixed',
  solidOn.position === 'fixed',
  JSON.stringify(solidOn),
);
check(
  'is-solid paints an opaque bar',
  solidOn.background.includes('rgb(0, 0, 0)') &&
    !solidOn.background.includes('rgba'),
  JSON.stringify(solidOn),
);
await navShot('10-nav-is-solid.png');
await page.evaluate(() =>
  document.querySelector('.nav').classList.remove('is-solid'),
);
await page.waitForTimeout(400);
const solidOff = await page.evaluate(
  () => getComputedStyle(document.querySelector('.nav')).backgroundImage,
);
check(
  'dropping is-solid reverts the bar',
  solidOff !== solidOn.background,
  solidOff,
);

const titleId = await page.evaluate(
  () => document.querySelector('#row-movies .card')?.dataset.id || '',
);
check('home row exposes a catalog id for the sweep', !!titleId, titleId);
await page.evaluate((id) => {
  sessionStorage.setItem(
    'cflix_play_ref',
    JSON.stringify({ kind: 'movie', id }),
  );
}, titleId);

for (const [path, expectNav] of [
  ['/', false],
  ['/profiles', true],
  ['/home', true],
  [`/title?id=${titleId}`, true],
  ['/watch', false],
  ['/signin', true],
]) {
  await page.goto(B + path);
  await page.waitForTimeout(300);
  const landed = new URL(page.url());
  check(
    `${path} stays put`,
    `${landed.pathname}${landed.search}` === path,
    `${landed.pathname}${landed.search}`,
  );
  const found = await page.evaluate(() => {
    const nav = document.querySelector('.nav');
    if (!nav) return { nav: false };
    const tools = document.querySelector('.nav__tools');
    const bell = document.querySelector('.nav__bell');
    return {
      nav: true,
      magnifiers: nav.querySelectorAll('circle[cx="11"]').length,
      directSvg: tools ? tools.querySelectorAll(':scope > svg').length : -1,
      bell: !!bell,
      bellDisabled: bell?.getAttribute('aria-disabled'),
      bellTitle: bell?.getAttribute('title'),
    };
  });
  check(
    `${path} nav presence matches the plan`,
    found.nav === expectNav,
    JSON.stringify(found),
  );
  if (found.nav) {
    check(
      `${path} has no search magnifier`,
      found.magnifiers === 0 && found.directSvg === 0,
      JSON.stringify(found),
    );
    check(
      `${path} bell is disabled and labeled`,
      found.bell &&
        found.bellDisabled === 'true' &&
        found.bellTitle === 'Notifications are not implemented yet',
      JSON.stringify(found),
    );
  }
}
await page.goto(`${B}/home`);
await page.waitForFunction(
  () => document.querySelector('#who')?.textContent === 'Watching as Beta',
);
await page.waitForSelector('#nav-menu [role="menuitem"]', {
  state: 'attached',
});

const menuItems = await page.$$eval('#nav-menu [role="menuitem"]', (els) =>
  els.map((e) => ({ id: e.dataset.id || null, text: e.textContent.trim() })),
);
check(
  'menu lists two real profiles',
  menuItems.filter((i) => i.id).length === 2,
  JSON.stringify(menuItems),
);
check(
  'menu has Manage profiles and Sign out',
  menuItems.some((i) => i.text === 'Manage profiles') &&
    menuItems.some((i) => i.text === 'Sign out'),
  JSON.stringify(menuItems.map((i) => i.text)),
);
const ids = Object.fromEntries(
  menuItems.filter((i) => i.id).map((i) => [i.text, i.id]),
);

await openNavMenu();
let state = await page.evaluate(() => ({
  hidden: document.querySelector('.nav__menu').hidden,
  expanded: document
    .querySelector('.nav__avatar')
    .getAttribute('aria-expanded'),
  focus: document.activeElement?.textContent?.trim(),
}));
check('clicking the avatar opens the menu', !state.hidden);
check(
  'aria-expanded flips to true',
  state.expanded === 'true',
  String(state.expanded),
);
check(
  'focus moves to the first menu item',
  state.focus === 'Alpha',
  String(state.focus),
);
await shot('02-menu-open.png');

const focusTrail = [];
for (let i = 0; i < 5; i++) {
  await page.keyboard.press('ArrowDown');
  focusTrail.push(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
  );
}
check(
  'arrow keys walk and wrap the menu',
  JSON.stringify(focusTrail) ===
    JSON.stringify(['Beta', 'Manage profiles', 'Sign out', 'Alpha', 'Beta']),
  JSON.stringify(focusTrail),
);
await shot('03-menu-arrow-focus.png');
await page.keyboard.press('ArrowUp');
const up = await page.evaluate(() =>
  document.activeElement?.textContent?.trim(),
);
check('ArrowUp moves back one item', up === 'Alpha', String(up));
await page.keyboard.press('Escape');
state = await page.evaluate(() => ({
  hidden: document.querySelector('.nav__menu').hidden,
  expanded: document
    .querySelector('.nav__avatar')
    .getAttribute('aria-expanded'),
  focusIsAvatar:
    document.activeElement === document.querySelector('.nav__avatar'),
}));
check('Escape closes the menu', state.hidden);
check(
  'Escape resets aria-expanded',
  state.expanded === 'false',
  String(state.expanded),
);
check('Escape returns focus to the avatar', state.focusIsAvatar);

await openNavMenu();
// Viewport centre: blank hero artwork, below the bar and left of the menu box.
// .hero__title is clip-path hidden whenever a logo image renders, so it is not
// a click target on this page.
await page.mouse.click(720, 450);
state = await page.evaluate(() => ({
  hidden: document.querySelector('.nav__menu').hidden,
  expanded: document
    .querySelector('.nav__avatar')
    .getAttribute('aria-expanded'),
}));
check('click outside closes the menu', state.hidden);
check(
  'click outside resets aria-expanded',
  state.expanded === 'false',
  String(state.expanded),
);

await openNavMenu();
await page
  .getByRole('menuitem', { name: 'Manage profiles', exact: true })
  .click();
await page.waitForURL('**/profiles');
check(
  'Manage profiles navigates to /profiles',
  page.url().endsWith('/profiles'),
);
check('menu ids resolved', !!ids.Alpha && !!ids.Beta, JSON.stringify(ids));
await page.waitForSelector(`#profile-list .avatar-tile[data-id="${ids.Beta}"]`);
await page.waitForSelector(
  `#profile-list .avatar-tile[data-id="${ids.Alpha}"]`,
);

const picStyle = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      img: cs.backgroundImage,
      a: cs.getPropertyValue('--tint-a').trim(),
      b: cs.getPropertyValue('--tint-b').trim(),
    };
  }, sel);

const betaTile = await picStyle(
  `#profile-list .avatar-tile[data-id="${ids.Beta}"] .avatar-tile__pic`,
);
const alphaTile = await picStyle(
  `#profile-list .avatar-tile[data-id="${ids.Alpha}"] .avatar-tile__pic`,
);
const betaNav = await picStyle('.nav__avatar-pic');
check(
  'second profile tile is tinted',
  betaTile?.a !== '' && betaTile?.img.includes('linear-gradient'),
  JSON.stringify(betaTile),
);
check(
  'nav avatar tint matches the current profile tile',
  JSON.stringify(betaNav) === JSON.stringify(betaTile),
  JSON.stringify({ betaNav, betaTile }),
);
check(
  'first profile tile is untinted',
  alphaTile?.a === '' && !alphaTile?.img.includes('linear-gradient'),
  JSON.stringify(alphaTile),
);
await page
  .locator('#profile-list .avatar-tile[data-name="Beta"]')
  .screenshot({ path: `${SHOTS}04-tile-beta-tinted.png` });
await page
  .locator('#profile-list .avatar-tile[data-name="Alpha"]')
  .screenshot({ path: `${SHOTS}05-tile-alpha-plain.png` });
await navShot('06-nav-on-profiles.png');

await page.click('.nav__logo');
await page.waitForFunction(
  () => document.querySelector('#who')?.textContent === 'Watching as Beta',
);
check('logo links back to /home', page.url().endsWith('/home'));

await openNavMenu();
await page.getByRole('menuitem', { name: 'Alpha', exact: true }).click();
await page.waitForFunction(
  () => document.querySelector('#who')?.textContent === 'Watching as Alpha',
);
check('menu switch navigates to /home with the right #who', true);
const alphaNav = await picStyle('.nav__avatar-pic');
check(
  'nav avatar matches the untinted first profile tile',
  JSON.stringify(alphaNav) === JSON.stringify(alphaTile),
  JSON.stringify({ alphaNav, alphaTile }),
);
await navShot('07-nav-current-alpha.png');

const oldToken = await page.evaluate(() =>
  sessionStorage.getItem('cflix_token'),
);
await openNavMenu();
await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
await page.waitForURL('**/signin');
const cleared = await page.evaluate(() => ({
  token: sessionStorage.getItem('cflix_token'),
  profile: sessionStorage.getItem('cflix_profile'),
}));
check(
  'sign out clears cflix_token',
  cleared.token === null,
  String(cleared.token),
);
check(
  'sign out clears cflix_profile',
  cleared.profile === null,
  String(cleared.profile),
);
check('sign out lands on /signin', page.url().endsWith('/signin'), page.url());
const after = await page.evaluate(async (t) => {
  const auth = await fetch('/api/profiles', {
    headers: { authorization: `Bearer ${t}` },
  });
  const bare = await fetch('/api/profiles');
  const again = await fetch('/api/auth/signout', { method: 'POST' });
  return { auth: auth.status, bare: bare.status, again: again.status };
}, oldToken);
check(
  'a subsequent API call with the old token 401s',
  after.auth === 401,
  String(after.auth),
);
check(
  'a subsequent API call without a token 401s',
  after.bare === 401,
  String(after.bare),
);
check(
  'signing out again after signout returns 200',
  after.again === 200,
  String(after.again),
);
const signedOutNav = await page.evaluate(() => ({
  toolsHidden: document.querySelector('.nav__tools').hidden,
  logoHref: document.querySelector('.nav__logo').getAttribute('href'),
}));
check('signed-out nav hides the account tools', signedOutNav.toolsHidden);
check(
  'signed-out logo points at the landing page',
  signedOutNav.logoHref === '/',
  String(signedOutNav.logoHref),
);
await shot('08-signin-after-signout.png');

await page.goto(`${B}/signin`);
await page.fill('#in-email', `nav-check2-${stamp}@test.dev`);
await page.fill('#in-password', 'pw123456');
await page.click('#btn-signup');
await page.waitForURL('**/profiles');
await page.click('#add-profile');
await page.fill('#dlg-name', 'Kid');
await page.click('#dlg-create');
await page.waitForSelector('#profile-list .avatar-tile[data-id]');
await page.click('#profile-list .avatar-tile[data-id]');
await page.waitForFunction(
  () => document.querySelector('#who')?.textContent === 'Watching as Kid',
);
const beforeGoogle = await page.evaluate(() =>
  sessionStorage.getItem('cflix_profile'),
);
await page.goto(`${B}/signin`);
await page.click('#btn-google');
await page.waitForURL('**/profiles');
const afterGoogle = await page.evaluate(() =>
  sessionStorage.getItem('cflix_profile'),
);
check(
  'a profile exists before the google login',
  beforeGoogle !== null,
  String(beforeGoogle),
);
check(
  'google login does not leave a stale profile',
  afterGoogle === null,
  String(afterGoogle),
);
await shot('09-google-login-no-stale-profile.png');

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
