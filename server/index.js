import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { AuthService, ProfileService, CatalogService } from './src/services.js';
import { Boundary } from './src/boundary.js';

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
  'POST /api/auth/signup': async (req, rawBody) => {
    const body = Boundary.parseSignUp(rawBody);
    return AuthService.signUp(body);
  },
  'POST /api/auth/signin': async (req, rawBody) => {
    const body = Boundary.parseSignIn(rawBody);
    return AuthService.signIn(body);
  },
  'POST /api/auth/google': async (req, rawBody) => {
    const body = Boundary.parseGoogleAuth(rawBody);
    return AuthService.signInWithGoogle(body);
  },
  'POST /api/auth/signout': async (req, rawBody, token) => {
    await AuthService.signOut(token);
    return { ok: true };
  },

  'GET /api/profiles': async (req, rawBody, token) => {
    const account = AuthService.accountForToken(token);
    return { items: ProfileService.list(account.id) };
  },
  'POST /api/profiles': async (req, rawBody, token) => {
    const account = AuthService.accountForToken(token);
    const body = Boundary.parseCreateProfile(rawBody);
    return ProfileService.create(account.id, body);
  },

  'GET /api/catalog/browse': async (req, rawBody, token, rawProfileId, url) => {
    requireAccount(token);
    const profileId = Boundary.parseProfileHeader(rawProfileId);
    const query = Boundary.parseBrowseQuery(url);
    return CatalogService.browse(profileId, query.kind, {
      genre: query.genre,
    });
  },
  'GET /api/catalog/get': async (req, rawBody, token, rawProfileId, url) => {
    requireAccount(token);
    const profileId = Boundary.parseProfileHeader(rawProfileId);
    const query = Boundary.parseGetQuery(url);
    return CatalogService.get(profileId, query.id);
  },
  'GET /api/catalog/related': async (req, rawBody, token, rawProfileId, url) => {
    requireAccount(token);
    const profileId = Boundary.parseProfileHeader(rawProfileId);
    const query = Boundary.parseGetQuery(url);
    return CatalogService.related(profileId, query.id);
  },
  'POST /api/catalog/search': async (req, rawBody, token, rawProfileId) => {
    requireAccount(token);
    const profileId = Boundary.parseProfileHeader(rawProfileId);
    const body = Boundary.parseSearchBody(rawBody);
    return CatalogService.search(profileId, body);
  },
  'POST /api/play': async (req, rawBody, token, rawProfileId) => {
    const account = AuthService.accountForToken(token);
    const profileId = Boundary.parseProfileHeader(rawProfileId);
    const body = Boundary.parsePlayBody(rawBody);
    return CatalogService.play(account.id, profileId, body.ref);
  },
  'POST /api/progress': async (req, rawBody, token, rawProfileId) => {
    requireAccount(token);
    const profileId = Boundary.parseProfileHeader(rawProfileId);
    const body = Boundary.parseProgressBody(rawBody);
    return CatalogService.recordProgress(profileId, body);
  },
  'GET /api/history': async (req, rawBody, token, rawProfileId) => {
    requireAccount(token);
    const profileId = Boundary.parseProfileHeader(rawProfileId);
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

  const path = normalize(PAGE_MAP[url.pathname] ?? url.pathname);
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
