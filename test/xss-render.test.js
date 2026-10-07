import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const PUBLIC_ROOT = new URL('../public/', import.meta.url);

const NAME_PAYLOAD = '"><img src=x onerror=window.__pwned=1>';
const TITLE_PAYLOAD = '<img src=x onerror=window.__pwned=1>';
const POSTER_PAYLOAD =
  "x');background-image:url(javascript:window.__pwned=1)//";

const PROFILES_ITEMS = [
  { id: 'pf_1', name: NAME_PAYLOAD, maturity: 'adult' },
  { id: 'pf_2', name: 'Kiddo', maturity: 'child' },
];

const HARNESS_HTML = {
  '/fillrow.html': '<div id="row-related"></div>',
  '/profiles.html': `
    <ul id="profile-list"></ul>
    <div id="dlg-add" hidden>
      <input id="dlg-name" />
      <div id="dlg-maturity">
        <button data-m="adult">adult</button>
        <button data-m="child">child</button>
      </div>
      <p id="dlg-error"></p>
      <button id="dlg-cancel"></button>
      <button id="dlg-create"></button>
    </div>
  `,
};

let server;
let base;
let browser;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    if (HARNESS_HTML[pathname]) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(HARNESS_HTML[pathname]);
      return;
    }
    if (pathname.startsWith('/js/')) {
      readFile(new URL(`.${pathname}`, PUBLIC_ROOT))
        .then((body) => {
          res.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8',
          });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(404);
          res.end('not found');
        });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>no page</title>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
}, 120000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

describe('stored XSS sinks: real Chromium, real HTML parser, real module graph', () => {
  it('fillRow keeps posterUrl, title and id out of every HTML context', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/fillrow.html`);
      const result = await page.evaluate(
        async ([poster, title]) => {
          // new Function keeps Vite's SSR import transform out of page code.
          const load = new Function('p', 'return import(p)');
          const { fillRow } = await load('/js/core.js');
          fillRow('row-related', [
            { id: 'seed:m1', title, posterUrl: poster },
            { id: 'seed:m2', title: 'Plain Title', posterUrl: null },
          ]);
          const rail = document.getElementById('row-related');
          const cards = rail.querySelectorAll('article.card');
          return {
            cards: cards.length,
            titleText: cards[0].querySelector('.card__title').textContent,
            secondTitle: cards[1].querySelector('.card__title').textContent,
            injected: rail.querySelectorAll('img').length,
            executed: window.__pwned,
            artStyle: cards[0]
              .querySelector('.card__art')
              .getAttribute('style'),
            artProperties: [
              ...cards[0].querySelector('.card__art').style,
            ].sort(),
            // Reparse the serialized attribute the way an HTML parser would.
            reparsedStyleProperties: (() => {
              const probe = document.createElement('div');
              probe.setAttribute(
                'style',
                cards[0].querySelector('.card__art').getAttribute('style'),
              );
              return [...probe.style].sort();
            })(),
            computedBackground: getComputedStyle(
              cards[0].querySelector('.card__art'),
            ).backgroundImage,
            artClasses: cards[0].querySelector('.card__art').className,
            placeholderClasses: cards[1].querySelector('.card__art').className,
            dataId: cards[0].dataset.id,
            cardClass: cards[0].className,
            cursor: cards[0].style.cursor,
            artBackground:
              cards[0].querySelector('.card__art').style.backgroundImage,
          };
        },
        [POSTER_PAYLOAD, TITLE_PAYLOAD],
      );

      assert.equal(result.cards, 2, 'both items rendered as cards');
      assert.equal(
        result.titleText,
        TITLE_PAYLOAD,
        'title renders as literal text',
      );
      assert.equal(
        result.secondTitle,
        'Plain Title',
        'legitimate title unchanged',
      );
      assert.equal(
        result.injected,
        0,
        'no element was injected through the title',
      );
      assert.equal(result.executed, undefined, 'no payload executed');
      assert.equal(result.dataId, 'seed:m1', 'data-id survives');
      assert.equal(
        result.cardClass,
        'card card--landscape',
        'shape classes unchanged',
      );
      assert.equal(result.cursor, 'pointer', 'cursor style preserved');
      assert.equal(
        result.artClasses,
        'card__art',
        'a posterUrl suppresses the placeholder classes',
      );
      assert.match(
        result.placeholderClasses,
        /^card__art ph ph--[a-h]$/,
        'a null posterUrl keeps the placeholder class',
      );
      // encodeURI leaves ' alone, so the value is set through the CSSOM instead:
      // one declaration, parsed as a single url() token, never as new markup.
      assert.deepEqual(
        result.artProperties,
        ['background-image'],
        'the poster payload adds no second declaration',
      );
      assert.deepEqual(
        result.reparsedStyleProperties,
        ['background-image'],
        `the serialized style attribute reparses to one declaration: ${result.artStyle}`,
      );
      assert.ok(
        result.computedBackground.startsWith('url("'),
        `the value stays one url() token: ${result.computedBackground}`,
      );
      assert.ok(
        !/onerror|onload|<img/i.test(result.artStyle ?? ''),
        `poster payload cannot reach markup: ${result.artStyle}`,
      );
    } finally {
      await page.close();
    }
  }, 60000);

  it('fillRow sends a real card to /title with an encoded id', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/fillrow.html`);
      await page.evaluate(async () => {
        const load = new Function('p', 'return import(p)');
        const { fillRow } = await load('/js/core.js');
        fillRow('row-related', [
          { id: "seed:x?a=1&b='2'", title: 'query', posterUrl: null },
        ]);
      });
      await page.click('#row-related article.card');
      await page.waitForURL(/title/);
      assert.equal(
        page.url(),
        `${base}/title?id=seed%3Ax%3Fa%3D1%26b%3D%272%27`,
      );
    } finally {
      await page.close();
    }
  }, 60000);

  it('profiles renders a payload profile name as text, in the tile and the label', async () => {
    const page = await browser.newPage();
    try {
      await page.route('**/api/profiles', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: PROFILES_ITEMS }),
        }),
      );
      await page.goto(`${base}/profiles.html`);
      const result = await page.evaluate(async () => {
        const load = new Function('p', 'return import(p)');
        const { default: profiles } = await load('/js/pages/profiles.js');
        await profiles();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const list = document.querySelector('#profile-list');
        const tiles = list.querySelectorAll('.avatar-tile[data-id]');
        const first = tiles[0];
        const second = tiles[1];
        return {
          tiles: tiles.length,
          addTile: !!list.querySelector('#add-profile'),
          injected: list.querySelectorAll('img').length,
          executed: window.__pwned,
          label: first.querySelectorAll('span')[1].textContent,
          secondLabel: second.querySelectorAll('span')[1].textContent,
          dataName: first.dataset.name,
          dataId: first.dataset.id,
          secondDataName: second.dataset.name,
          firstPic: first.querySelector('.avatar-tile__pic').className,
          secondPic: second.querySelector('.avatar-tile__pic').className,
          secondTint: second
            .querySelector('.avatar-tile__pic')
            .getAttribute('style'),
          // Round-trip the serialized markup through the HTML parser: what a
          // parser builds from it is what an attacker would get.
          reparsed: (() => {
            const doc = new DOMParser().parseFromString(
              `<div id="probe">${first.outerHTML}</div>`,
              'text/html',
            );
            const els = [...doc.querySelectorAll('*')];
            return {
              imgs: doc.querySelectorAll('img').length,
              handlerAttrs: els.flatMap((e) =>
                [...e.attributes]
                  .map((a) => a.name)
                  .filter((n) => /^on/i.test(n)),
              ),
              dataName: doc.querySelector('button').getAttribute('data-name'),
              label: doc.querySelectorAll('button > span')[1].textContent,
            };
          })(),
        };
      });

      assert.equal(result.tiles, 2, 'both profile tiles rendered');
      assert.equal(result.addTile, true, 'the add-profile tile is still there');
      assert.equal(result.injected, 0, 'no element injected through the name');
      assert.equal(result.executed, undefined, 'no payload executed');
      assert.equal(
        result.label,
        `${NAME_PAYLOAD} · adult`,
        'payload name renders as literal text with the maturity suffix',
      );
      assert.equal(
        result.secondLabel,
        'Kiddo · child',
        'legitimate tile unchanged',
      );
      assert.equal(
        result.dataName,
        NAME_PAYLOAD,
        'data-name keeps the raw name',
      );
      assert.equal(result.dataId, 'pf_1', 'data-id unchanged');
      assert.equal(
        result.firstPic,
        'avatar-tile__pic',
        'first tile stays untinted',
      );
      assert.equal(
        result.secondPic,
        'avatar-tile__pic avatar-tile__pic--tint',
        'later tiles stay tinted',
      );
      assert.match(
        result.secondTint ?? '',
        /^--tint-a: \d+; --tint-b: \d+;$/,
        `tint custom properties preserved: ${result.secondTint}`,
      );
      assert.equal(result.reparsed.imgs, 0, 'reparsing the tile yields no img');
      assert.deepEqual(
        result.reparsed.handlerAttrs,
        [],
        'reparsing the tile yields no event-handler attribute',
      );
      assert.equal(
        result.reparsed.dataName,
        NAME_PAYLOAD,
        'data-name round-trips to the raw name, not a truncated one',
      );
      assert.equal(
        result.reparsed.label,
        `${NAME_PAYLOAD} · adult`,
        'the reparsed label still shows the payload as text',
      );
    } finally {
      await page.close();
    }
  }, 60000);
});
