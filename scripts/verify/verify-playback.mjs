import { runWithServerAndBrowser, check, saveScreenshot } from './harness.mjs';

await runWithServerAndBrowser(async ({ baseUrl, page }) => {
  const email = `play_test_${Date.now()}@test.dev`;
  const password = 'pw123456';

  // 1. Setup session
  await page.goto(`${baseUrl}/signin`);
  const setup = await page.evaluate(
    async ({ email, password }) => {
      const post = (p, b, token) =>
        fetch(p, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(b),
        }).then((r) => r.json());

      const auth = await post('/api/auth/signup', { email, password });
      const token = auth.session.token;
      const profile = await post(
        '/api/profiles',
        { name: 'Viewer', maturity: 'adult' },
        token,
      );
      return { token, profile };
    },
    { email, password },
  );

  await page.evaluate(({ token, profile }) => {
    sessionStorage.setItem('cflix_token', token);
    sessionStorage.setItem('cflix_profile', JSON.stringify(profile));
  }, setup);

  // 2. Open title detail for a series (s1)
  await page.goto(`${baseUrl}/title?id=s1`);
  await page.waitForSelector('.detail__artwork span, .detail__title', {
    timeout: 6000,
  });
  check('lands on /title detail page', page.url().includes('/title'));

  const detailTitle = await page.textContent(
    '.detail__artwork span, .detail__title',
  );
  check(
    'detail page renders title name',
    detailTitle.trim().length > 0,
    `(${detailTitle.trim()})`,
  );

  const epLinks = await page.locator('#episodes .episode-link').count();
  check('series detail lists episodes', epLinks > 0, `(${epLinks} episodes)`);
  await saveScreenshot(page, 'playback-title-detail');

  // 3. Click play
  await page.click('#btn-play');
  await page.waitForURL('**/watch', { timeout: 6000 });
  check('clicking play navigates to /watch', page.url().includes('/watch'));

  await page.waitForSelector('.player__title');
  const playerTitle = await page.textContent('.player__title');
  check(
    '.player__title is populated',
    playerTitle.trim().length > 0,
    `(${playerTitle.trim()})`,
  );
  await saveScreenshot(page, 'playback-player-view');

  // 4. Progress recording API verification
  const history = await page.evaluate(
    async ({ token, profileId }) => {
      await fetch('/api/progress', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-cflix-profile': profileId,
        },
        body: JSON.stringify({ itemId: 's1e1', seconds: 180 }),
      });

      const res = await fetch('/api/history', {
        headers: {
          authorization: `Bearer ${token}`,
          'x-cflix-profile': profileId,
        },
      }).then((r) => r.json());
      return res.items || [];
    },
    { token: setup.token, profileId: setup.profile.id },
  );

  check(
    'progress posts and reflects in /api/history',
    history.length > 0 && history[0].seconds === 180,
  );

  // 5. Finish button returns to /home
  await page.click('#btn-finish');
  await page.waitForURL('**/home', { timeout: 5000 });
  check('#btn-finish returns to /home', page.url().includes('/home'));
});
