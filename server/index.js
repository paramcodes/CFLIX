import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { AuthService, ProfileService, CatalogService } from './src/services.js';

const PAGE_MAP = {
  '/': '/index.html',
  '/signin': '/(auth)/signin.html',
  '/profiles': '/profiles.html',
  '/home': '/home.html',
  '/title': '/title.html',
  '/watch': '/watch.html',
  '/browse': '/browse.html',
};

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = new URL('../public/', import.meta.url).pathname;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webp': 'image/webp',
};

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  try {
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

const routes = {
  'POST /api/auth/signup': async (req, body) => AuthService.signUp(body),
  'POST /api/auth/signin': async (req, body) => AuthService.signIn(body),
  'POST /api/auth/google': async (req, body) =>
    AuthService.signInWithGoogle(body),
  'POST /api/auth/signout': async (req, body, token) => {
    await AuthService.signOut(token);
    return { ok: true };
  },

  'GET /api/profiles': async (req, body, token) => {
    const account = AuthService.accountForToken(token);
    return { items: ProfileService.list(account.id) };
  },
  'POST /api/profiles': async (req, body, token) => {
    const account = AuthService.accountForToken(token);
    return ProfileService.create(account.id, body);
  },

  'GET /api/catalog/browse': async (req, body, token, profileId, url) => {
    requireAccount(token);
    return CatalogService.browse(profileId, url.searchParams.get('kind'), {
      genre: url.searchParams.get('genre'),
    });
  },
  'GET /api/catalog/get': async (req, body, token, profileId, url) => {
    requireAccount(token);
    return CatalogService.get(profileId, url.searchParams.get('id'));
  },
  'GET /api/catalog/related': async (req, body, token, profileId, url) => {
    requireAccount(token);
    return CatalogService.related(profileId, url.searchParams.get('id'));
  },
  'POST /api/catalog/search': async (req, body, token, profileId) => {
    requireAccount(token);
    return CatalogService.search(profileId, body);
  },
  'POST /api/play': async (req, body, token, profileId) => {
    const account = AuthService.accountForToken(token);
    return CatalogService.play(account.id, profileId, body.ref);
  },
  'POST /api/progress': async (req, body, token, profileId) => {
    requireAccount(token);
    return CatalogService.recordProgress(profileId, body);
  },
  'GET /api/history': async (req, body, token, profileId) => {
    requireAccount(token);
    return { items: await CatalogService.history(profileId) };
  },
};

function requireAccount(token) {
  if (!token) {
    const err = new Error('unauthorized');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  return AuthService.accountForToken(token);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = `${req.method} ${url.pathname}`;

  if (routes[key]) {
    try {
      const body = await readBody(req);
      const token = bearer(req);
      const profileId = req.headers['x-cflix-profile'] || null;
      const result = await routes[key](req, body, token, profileId, url);
      json(res, 200, result);
    } catch (err) {
      const status =
        err.code === 'UNAUTHORIZED'
          ? 401
          : err.code === 'SESSION_EXPIRED'
            ? 401
            : err.code === 'NOT_FOUND'
              ? 404
              : 400;
      json(res, status, {
        error: { code: err.code || 'ERROR', message: err.message },
      });
    }
    return;
  }

  let path = normalize(PAGE_MAP[url.pathname] ?? url.pathname);
  if (path.includes('..')) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const file = join(PUBLIC_DIR, path);
    const info = await stat(file);
    const etag = `W/"${info.size}-${info.mtimeMs}"`;
    const candidates = (req.headers['if-none-match'] || '')
      .split(',')
      .map((s) => s.trim());
    if (candidates.includes(etag) || candidates.includes('*')) {
      res.writeHead(304);
      res.end();
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(path)] || 'application/octet-stream',
      etag,
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, () => console.log(`cflix on http://localhost:${PORT}`));
