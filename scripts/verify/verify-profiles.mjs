import { runWithServerAndBrowser, check, saveScreenshot } from './harness.mjs';

await runWithServerAndBrowser(async ({ baseUrl, page }) => {
  const email = `profile_test_${Date.now()}@test.dev`;
  const password = 'pw123456';

  // Sign up
  await page.goto(`${baseUrl}/signin`);
  await page.fill('#in-email', email);
  await page.fill('#in-password', password);
  await page.click('#btn-signup');
  await page.waitForURL('**/profiles');

  // 1. Initial state
  await page.waitForSelector('#add-profile');
  const initialTiles = await page.locator('.avatar-tile[data-id]').count();
  check('fresh account has 0 initial profiles', initialTiles === 0);
  await saveScreenshot(page, 'profiles-initial-empty');

  // 2. Open Add Profile dialog
  await page.click('#add-profile');
  await page.waitForSelector('#dlg-add[open], #dlg-add:not([hidden])');
  check('clicking #add-profile opens dialog', true);

  // 3. Validation: empty name
  await page.click('#dlg-create');
  const dlgError = await page.textContent('#dlg-error');
  check('empty name shows dialog error', dlgError.trim().length > 0);

  // 4. Create child profile
  await page.fill('#dlg-name', 'Kiddo');
  await page.click('#dlg-maturity button[data-m="child"]');
  await page.click('#dlg-create');

  await page.waitForFunction(
    () => document.querySelectorAll('.avatar-tile[data-id]').length === 1,
  );
  check('first profile created and visible in list', true);

  // 5. Create adult profile
  await page.click('#add-profile');
  await page.fill('#dlg-name', 'Adult');
  await page.click('#dlg-maturity button[data-m="adult"]');
  await page.click('#dlg-create');

  await page.waitForFunction(
    () => document.querySelectorAll('.avatar-tile[data-id]').length === 2,
  );
  check('two profiles now listed', true);
  await saveScreenshot(page, 'profiles-created-two');

  // 6. Select profile and navigate to /home
  const adultTile = page.locator('.avatar-tile[data-id]').last();
  await adultTile.click();

  await page.waitForURL('**/home', { timeout: 5000 });
  check('selecting profile redirects to /home', page.url().includes('/home'));

  const savedProfile = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('cflix_profile') || '{}'),
  );
  check(
    'selected profile stored in sessionStorage',
    savedProfile.name === 'Adult',
  );
  await saveScreenshot(page, 'profiles-selected-home');
});
