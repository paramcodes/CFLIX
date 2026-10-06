import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { AuthService, ProfileService, CatalogService } from './src/services.js';
import { Boundary } from './src/boundary.js';
import { DomainError } from './src/errors.js';

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

const DOMAIN_STATUS = {
  UNAUTHORIZED: 401,
  SESSION_EXPIRED: 401,
  NOT_FOUND: 404,
};

function requestUrl(req) {
  try {
    return new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
  } catch {
    return null;
  }
}

function sendError(res, err) {
  if (err instanceof DomainError) {
    json(res, DOMAIN_STATUS[err.code] ?? 400, {
      error: { code: err.code, message: err.message },
    });
    return;
  }
  console.error('cflix: unexpected error handling request', err);
  json(res, 500, { error: { code: 'INTERNAL', message: 'internal error' } });
}

function sendMalformedRequest(res) {
  sendError(res, new DomainError('BAD_REQUEST', 'malformed request'));
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
  'GET /api/catalog/related': async (
    req,
    rawBody,
    token,
    rawProfileId,
    url,
  ) => {
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
    throw new DomainError('UNAUTHORIZED', 'unauthorized');
  }
  return AuthService.accountForToken(token);
}

export async function handleRequest(req, res) {
  const url = requestUrl(req);
  if (!url) {
    sendMalformedRequest(res);
    return;
  }
  const key = `${req.method} ${url.pathname}`;

  if (routes[key]) {
    try {
      const body = await readBody(req);
      const token = bearer(req);
      const profileId = req.headers['x-cflix-profile'] || null;
      const result = await routes[key](req, body, token, profileId, url);
      json(res, 200, result);
    } catch (err) {
      sendError(res, err);
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
}
let nextHandler = null;

export async function initNextApp(options = {}) {
  if (nextHandler) return nextHandler;
  const nextModule = await import('next');
  const nextFn = nextModule.default || nextModule;
  const app = nextFn({
    dev:
      options.dev ??
      (process.env.NODE_ENV !== 'production' && !process.env.PROD),
    dir: process.cwd(),
  });
  await app.prepare();
  nextHandler = app.getRequestHandler();
  return nextHandler;
}

export const server = createServer(async (req, res) => {
  try {
    const url = requestUrl(req);
    if (!url) {
      sendMalformedRequest(res);
      return;
    }
    const key = `${req.method} ${url.pathname}`;

    // 1. API routes are always handled by backend services & Boundary
    if (routes[key]) {
      return handleRequest(req, res);
    }

    // 2. Next.js App Router handles pages when FRONTEND=next or USE_NEXT=true
    if (
      nextHandler &&
      (process.env.FRONTEND === 'next' || process.env.USE_NEXT === 'true')
    ) {
      return nextHandler(req, res);
    }

    // 3. Fallback to static prototype
    return handleRequest(req, res);
  } catch (err) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendError(res, err);
  }
});

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('server/index.js') ||
    process.argv[1].endsWith('server/index'));

if (isDirectRun || process.env.LISTEN === 'true') {
  if (process.env.FRONTEND === 'next' || process.env.USE_NEXT === 'true') {
    initNextApp()
      .then(() => {
        server.listen(PORT, () =>
          console.log(`cflix (Next.js App Router) on http://localhost:${PORT}`),
        );
      })
      .catch((err) => {
        console.error('Failed to initialize Next.js server:', err);
        server.listen(PORT, () =>
          console.log(`cflix (fallback) on http://localhost:${PORT}`),
        );
      });
  } else {
    server.listen(PORT, () => console.log(`cflix on http://localhost:${PORT}`));
  }
}

export { routes, requireAccount, bearer, json };
