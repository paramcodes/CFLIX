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

  // 4. Google stub flow
  await page.goto(`${baseUrl}/signin`);
  const googleEmail = `google_${Date.now()}@test.dev`;
  page.once('dialog', async (dialog) => {
    await dialog.accept(googleEmail);
  });
  await page.click('#btn-google');
  await page.waitForURL('**/profiles', { timeout: 5000 });
  check('google stub redirects to /profiles', page.url().includes('/profiles'));
  const googleToken = await page.evaluate(() =>
    sessionStorage.getItem('cflix_token'),
  );
  check('google login sets cflix_token', !!googleToken);
  await saveScreenshot(page, 'auth-google-profiles');
});
