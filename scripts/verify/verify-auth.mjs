import { runWithServerAndBrowser, check, saveScreenshot } from './harness.mjs';

await runWithServerAndBrowser(async ({ baseUrl, page }) => {
  const testEmail = `auth_test_${Date.now()}@test.dev`;
  const password = 'pw123456';

  // 1. Sign up flow
  await page.goto(`${baseUrl}/signin`);
  check('lands on signin page', page.url().includes('/signin'));

  await page.fill('#in-email', testEmail);
  await page.fill('#in-password', password);
  await page.click('#btn-signup');

  await page.waitForURL('**/profiles', { timeout: 5000 });
  check('signup redirects to /profiles', page.url().includes('/profiles'));

  const token = await page.evaluate(() =>
    sessionStorage.getItem('cflix_token'),
  );
  check('cflix_token set in sessionStorage after signup', !!token);
  await saveScreenshot(page, 'auth-signup-profiles');

  // 2. Bad password flow
  await page.goto(`${baseUrl}/signin`);
  await page.fill('#in-email', testEmail);
  await page.fill('#in-password', 'wrongpassword');
  await page.click('#btn-signin');

  await page.waitForFunction(() => {
    const el = document.querySelector('#in-error');
    return el && el.textContent.trim().length > 0;
  });
  const errText = await page.textContent('#in-error');
  check('bad password shows inline error in #in-error', errText.length > 0);
  check('stays on /signin on error', page.url().includes('/signin'));
  await saveScreenshot(page, 'auth-signin-error');

  // 3. Valid sign-in flow
  await page.fill('#in-password', password);
  await page.click('#btn-signin');
  await page.waitForURL('**/profiles', { timeout: 5000 });
  check(
    'valid signin redirects to /profiles',
    page.url().includes('/profiles'),
  );

  // 4. The page offers no Google control
  await page.goto(`${baseUrl}/signin`);
  const googleControls = await page.locator('#btn-google').count();
  check(
    'signin offers no google control',
    googleControls === 0,
    `count=${googleControls}`,
  );
  await saveScreenshot(page, 'auth-signin-no-google');

  // 5. A fresh page load still signs in and stores a token
  await page.fill('#in-email', testEmail);
  await page.fill('#in-password', password);
  await page.click('#btn-signin');
  await page.waitForURL('**/profiles', { timeout: 5000 });
  check('signin redirects to /profiles', page.url().includes('/profiles'));
  check(
    'signin sets cflix_token',
    !!(await page.evaluate(() => sessionStorage.getItem('cflix_token'))),
  );
  await saveScreenshot(page, 'auth-signin-profiles');
});
