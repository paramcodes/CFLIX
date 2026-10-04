import { runWithServerAndBrowser, check, saveScreenshot } from './harness.mjs';

await runWithServerAndBrowser(async ({ baseUrl, page }) => {
  const email = `browse_test_${Date.now()}@test.dev`;
  const password = 'pw123456';

  // 1. Setup session with Adult and Child profiles via API
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
      const adult = await post(
        '/api/profiles',
        { name: 'Adult', maturity: 'adult' },
        token,
      );
      const kid = await post(
        '/api/profiles',
        { name: 'Kid', maturity: 'child' },
        token,
      );
      return { token, adult, kid };
    },
    { email, password },
  );

  // 2. Open /home as Adult
  await page.evaluate(
    ({ token, adult }) => {
      sessionStorage.setItem('cflix_token', token);
      sessionStorage.setItem('cflix_profile', JSON.stringify(adult));
    },
    { token: setup.token, adult: setup.adult },
  );

  await page.goto(`${baseUrl}/home`);
  await page.waitForSelector('#row-trending .card', { timeout: 6000 });
  await page.waitForSelector('#row-movies .card', { timeout: 6000 });
  await page.waitForSelector('#row-series .card', { timeout: 6000 });

  const top10Count = await page.locator('#row-trending .card').count();
  check(
    'top 10 row renders cards',
    top10Count > 0 && top10Count <= 10,
    `(${top10Count} cards)`,
  );

  const firstRankNum = await page
    .locator('#row-trending .card__num')
    .first()
    .textContent();
  check('top 10 first card has rank #1', firstRankNum === '1');

  const rankedCount = await page.locator('#row-trending .card__num').count();
  check(
    'every top 10 card shows its rank',
    rankedCount === top10Count,
    `(${rankedCount}/${top10Count} ranked)`,
  );

  const movieCount = await page.locator('#row-movies .card').count();
  check('movie row renders cards', movieCount > 0, `(${movieCount} cards)`);

  const seriesCount = await page.locator('#row-series .card').count();
  check('series row renders cards', seriesCount > 0, `(${seriesCount} cards)`);

  const whoText = await page.textContent('#who');
  check('#who displays active profile name', whoText.includes('Adult'));
  await saveScreenshot(page, 'browse-home-rows');

  // 3. Search for 'dark'
  await page.fill('#search-input', 'dark');
  await page.click('#search-form button');

  await page.waitForFunction(() => {
    const wrap = document.querySelector('#row-results-wrap');
    return (
      wrap && !wrap.hasAttribute('hidden') && wrap.style.display !== 'none'
    );
  });
  check('search results wrapper becomes visible', true);

  const resultsCount = await page.locator('#row-results .card').count();
  check(
    'search for "dark" returns matching cards',
    resultsCount >= 1,
    `(${resultsCount} cards)`,
  );
  await saveScreenshot(page, 'browse-search-results');

  // 4. Maturity check on Child profile
  const childSearch = await page.evaluate(
    async ({ token, kidId }) => {
      const res = await fetch('/api/catalog/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-cflix-profile': kidId,
        },
        body: JSON.stringify({ text: '' }),
      }).then((r) => r.json());
      return res.items || [];
    },
    { token: setup.token, kidId: setup.kid.id },
  );

  check(
    'child profile receives zero adult-rated titles',
    childSearch.every((i) => i.maturity !== 'adult'),
    `(${childSearch.length} items checked)`,
  );
});
