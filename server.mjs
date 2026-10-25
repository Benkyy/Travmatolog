import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lightweight, dependency-free CMS API. Article data lives outside the public web root.
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, '..', 'TravmaVizV2-data'));
const storePath = path.join(dataDir, 'articles.json');
const port = Number(process.env.PORT || 8765);
const adminPassword = process.env.ADMIN_PASSWORD || '';
const production = process.env.NODE_ENV === 'production';
const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
let writeQueue = Promise.resolve();

if (adminPassword.length < 16) {
  throw new Error('Set ADMIN_PASSWORD to a private passphrase with at least 16 characters before starting the server.');
}
const relativeDataPath = path.relative(root, dataDir);
const dataPathIsParent = relativeDataPath === '..' || relativeDataPath.startsWith('..' + path.sep);
const dataPathIsPublic = !relativeDataPath || (!dataPathIsParent && !path.isAbsolute(relativeDataPath));
if (dataPathIsPublic) {
  throw new Error('DATA_DIR must be outside the public website folder.');
}

const passwordDigest = createHash('sha256').update(adminPassword).digest();
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.pdf': 'application/pdf'
};
const disallowedPublicFiles = new Set(['server.mjs']);

await fs.mkdir(dataDir, { recursive: true });
try {
  await fs.access(storePath);
} catch {
  await fs.writeFile(storePath, '[]\n', { encoding: 'utf8', flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
}

function json(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

function sessionFor(request) {
  const token = readCookie(request, 'travmaviz_admin');
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, session };
}

function requireAdmin(request, response) {
  if (sessionFor(request)) return true;
  json(response, 401, { error: 'Требуется вход в редактор.' });
  return false;
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function requireSameOrigin(request, response) {
  if (sameOrigin(request)) return true;
  json(response, 403, { error: 'Запрос отклонён.' });
  return false;
}

async function readBody(request, maxBytes = 100000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Слишком большой запрос.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Некорректный JSON.'), { statusCode: 400 });
  }
}

async function readArticles() {
  const content = await fs.readFile(storePath, 'utf8');
  const data = JSON.parse(content);
  if (!Array.isArray(data)) throw new Error('Article store must contain a JSON array.');
  return data;
}

async function mutateArticles(mutator) {
  let result;
  const operation = writeQueue.then(async () => {
    const articles = await readArticles();
    result = mutator(articles);
    const temporaryPath = path.join(dataDir, 'articles-' + randomUUID() + '.tmp');
    await fs.writeFile(temporaryPath, JSON.stringify(articles, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryPath, storePath);
  });
  writeQueue = operation.catch(() => {});
  await operation;
  return result;
}

function cleanText(value, min, max, label) {
  if (typeof value !== 'string') throw Object.assign(new Error('Проверьте поле «' + label + '».'), { statusCode: 400 });
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw Object.assign(new Error('Поле «' + label + '» должно содержать от ' + min + ' до ' + max + ' символов.'), { statusCode: 400 });
  }
  return text;
}

function validateArticle(body) {
  if (!body || typeof body !== 'object') throw Object.assign(new Error('Некорректные данные статьи.'), { statusCode: 400 });
  const status = body.status === 'draft' ? 'draft' : body.status === 'published' ? 'published' : '';
  if (!status) throw Object.assign(new Error('Выберите статус статьи.'), { statusCode: 400 });
  return {
    title: cleanText(body.title, 5, 140, 'заголовок'),
    summary: cleanText(body.summary, 20, 260, 'краткое описание'),
    category: cleanText(body.category, 2, 48, 'тема'),
    body: cleanText(body.body, 50, 30000, 'текст статьи'),
    status
  };
}

const transliteration = {
  а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'yo', ж:'zh', з:'z', и:'i', й:'y', к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f', х:'h', ц:'ts', ч:'ch', ш:'sh', щ:'shch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya'
};
function makeSlug(title, id) {
  const base = Array.from(title.toLocaleLowerCase('ru')).map((character) => transliteration[character] ?? character).join('')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
  return (base || 'material') + '-' + id.slice(0, 8);
}

function isRateLimited(request) {
  const key = request.socket.remoteAddress || 'unknown';
  const current = Date.now();
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= current) {
    loginAttempts.set(key, { count: 0, resetAt: current + 15 * 60 * 1000 });
    return false;
  }
  return attempt.count >= 10;
}

function countLoginAttempt(request) {
  const key = request.socket.remoteAddress || 'unknown';
  const attempt = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  attempt.count += 1;
  loginAttempts.set(key, attempt);
}

async function handleApi(request, response, url) {
  const method = request.method || 'GET';
  const pathname = url.pathname;

  if (pathname === '/api/articles' && method === 'GET') {
    const articles = await readArticles();
    const published = articles.filter((article) => article.status === 'published')
      .sort((left, right) => String(right.publishedAt || '').localeCompare(String(left.publishedAt || '')))
      .map(({ id, slug, title, summary, category, body, publishedAt, updatedAt }) => ({ id, slug, title, summary, category, body, publishedAt, updatedAt }));
    return json(response, 200, { articles: published });
  }

  if (pathname === '/api/admin/session' && method === 'GET') {
    return json(response, 200, { authenticated: Boolean(sessionFor(request)) });
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    if (!requireSameOrigin(request, response)) return;
    if (isRateLimited(request)) return json(response, 429, { error: 'Слишком много попыток. Попробуйте через 15 минут.' });
    countLoginAttempt(request);
    const payload = await readBody(request, 2000);
    const supplied = createHash('sha256').update(typeof payload.password === 'string' ? payload.password : '').digest();
    if (!timingSafeEqual(supplied, passwordDigest)) return json(response, 401, { error: 'Неверный пароль.' });
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { expiresAt: Date.now() + sessionLifetimeMs });
    loginAttempts.delete(request.socket.remoteAddress || 'unknown');
    const cookie = 'travmaviz_admin=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + (sessionLifetimeMs / 1000) + (production ? '; Secure' : '');
    return json(response, 200, { authenticated: true }, { 'Set-Cookie': cookie });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    if (!requireSameOrigin(request, response) || !requireAdmin(request, response)) return;
    const current = sessionFor(request);
    if (current) sessions.delete(current.token);
    const cookie = 'travmaviz_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + (production ? '; Secure' : '');
    return json(response, 200, { authenticated: false }, { 'Set-Cookie': cookie });
  }

  if (pathname === '/api/admin/articles' && method === 'GET') {
    if (!requireAdmin(request, response)) return;
    const articles = await readArticles();
    articles.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    return json(response, 200, { articles });
  }

  if (pathname === '/api/admin/articles' && method === 'POST') {
    if (!requireSameOrigin(request, response) || !requireAdmin(request, response)) return;
    const fields = validateArticle(await readBody(request));
    const now = new Date().toISOString();
    const article = await mutateArticles((articles) => {
      const id = randomUUID();
      const item = { id, slug: makeSlug(fields.title, id), ...fields, createdAt: now, updatedAt: now, publishedAt: fields.status === 'published' ? now : null };
      articles.push(item);
      return item;
    });
    return json(response, 201, { article });
  }

  const articleMatch = pathname.match(/^\/api\/admin\/articles\/([0-9a-f-]{36})$/i);
  if (articleMatch && method === 'PUT') {
    if (!requireSameOrigin(request, response) || !requireAdmin(request, response)) return;
    const fields = validateArticle(await readBody(request));
    const now = new Date().toISOString();
    const result = await mutateArticles((articles) => {
      const index = articles.findIndex((article) => article.id === articleMatch[1]);
      if (index < 0) return null;
      const previous = articles[index];
      const publishedAt = fields.status === 'published' ? (previous.publishedAt || now) : null;
      articles[index] = { ...previous, ...fields, publishedAt, updatedAt: now };
      return articles[index];
    });
    if (!result) return json(response, 404, { error: 'Статья не найдена.' });
    return json(response, 200, { article: result });
  }

  if (articleMatch && method === 'DELETE') {
    if (!requireSameOrigin(request, response) || !requireAdmin(request, response)) return;
    const deleted = await mutateArticles((articles) => {
      const index = articles.findIndex((article) => article.id === articleMatch[1]);
      return index < 0 ? false : articles.splice(index, 1).length > 0;
    });
    if (!deleted) return json(response, 404, { error: 'Статья не найдена.' });
    return json(response, 200, { deleted: true });
  }

  return json(response, 404, { error: 'Маршрут API не найден.' });
}

async function serveStatic(request, response, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    return response.end('Method not allowed');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400);
    return response.end('Bad request');
  }
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(root, '.' + pathname);
  if (!filePath.startsWith(root + path.sep) || disallowedPublicFiles.has(path.basename(filePath).toLowerCase()) || filePath.includes(path.sep + 'TravmaVizV2-data' + path.sep)) {
    response.writeHead(404);
    return response.end('Not found');
  }
  let fileInfo;
  try {
    fileInfo = await fs.stat(filePath);
  } catch {
    response.writeHead(404);
    return response.end('Not found');
  }
  if (!fileInfo.isFile()) {
    response.writeHead(404);
    return response.end('Not found');
  }
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    'Content-Length': fileInfo.size,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600'
  });
  if (request.method === 'HEAD') return response.end();
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://' + (request.headers.host || 'localhost'));
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url);
    else await serveStatic(request, response, url);
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('Request failed:', error.message);
    if (!response.headersSent) json(response, status, { error: status >= 500 ? 'Внутренняя ошибка сервера.' : error.message });
    else response.destroy();
  }
});

server.listen(port, host, () => {
  console.log('TraumaViz site and article admin are running at http://' + host + ':' + port + '.');
  console.log('Open / for the site and /admin for article management.');
  console.log('Article storage is outside the public folder: ' + storePath);
});
