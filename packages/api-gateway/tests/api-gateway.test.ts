import { describe, test, expect, beforeEach } from 'bun:test';
import { Router } from '../src/router.ts';
import { MiddlewareChain, errorHandler, loggingMiddleware, timingMiddleware } from '../src/middleware-chain.ts';
import { RequestValidator } from '../src/request-validator.ts';
import { ResponseFormatter } from '../src/response-formatter.ts';
import { APIRateLimiter } from '../src/rate-limiter.ts';
import { AuthMiddleware } from '../src/auth-middleware.ts';
import { APICache } from '../src/api-cache.ts';
import { APIDocumentationGenerator } from '../src/api-documentation.ts';
import { CORSHandler } from '../src/cors-handler.ts';
import { WebSocketManager } from '../src/websocket-manager.ts';

// ============================================================
// Module 1: Router Tests
// ============================================================
describe('Router', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
  });

  test('should register and match a GET route', () => {
    router.get('/hello', (params, query, ctx) => ({ status: 200, body: 'hello' }));
    const match = router.match('GET', '/hello');
    expect(match).not.toBeNull();
    expect(match!.route.method).toBe('GET');
    expect(match!.route.path).toBe('/hello');
  });

  test('should register and match a POST route', () => {
    router.post('/users', (params, query, ctx) => ({ status: 201 }));
    const match = router.match('POST', '/users');
    expect(match).not.toBeNull();
    expect(match!.route.method).toBe('POST');
  });

  test('should register and match a PUT route', () => {
    router.put('/users/:id', (params) => ({ status: 200, body: params }));
    const match = router.match('PUT', '/users/42');
    expect(match).not.toBeNull();
    expect(match!.params.id).toBe('42');
  });

  test('should register and match a PATCH route', () => {
    router.patch('/items/:id', (params) => ({ status: 200 }));
    const match = router.match('PATCH', '/items/1');
    expect(match).not.toBeNull();
  });

  test('should register and match a DELETE route', () => {
    router.delete('/users/:id', (params) => ({ status: 204 }));
    const match = router.match('DELETE', '/users/5');
    expect(match).not.toBeNull();
    expect(match!.params.id).toBe('5');
  });

  test('should register and match an OPTIONS route', () => {
    router.options('/api', () => ({ status: 200 }));
    const match = router.match('OPTIONS', '/api');
    expect(match).not.toBeNull();
  });

  test('should register and match a HEAD route', () => {
    router.head('/health', () => ({ status: 200 }));
    const match = router.match('HEAD', '/health');
    expect(match).not.toBeNull();
  });

  test('should register all methods with all()', () => {
    router.all('/any', () => ({ status: 200 }));
    expect(router.match('GET', '/any')).not.toBeNull();
    expect(router.match('POST', '/any')).not.toBeNull();
    expect(router.match('PUT', '/any')).not.toBeNull();
    expect(router.match('DELETE', '/any')).not.toBeNull();
  });

  test('should extract path parameters', () => {
    router.get('/users/:id', (params) => ({ status: 200, body: params }));
    const match = router.match('GET', '/users/123');
    expect(match).not.toBeNull();
    expect(match!.params.id).toBe('123');
  });

  test('should extract multiple path parameters', () => {
    router.get('/files/:category/:name', (params) => ({ status: 200, body: params }));
    const match = router.match('GET', '/files/images/photo.png');
    expect(match).not.toBeNull();
    expect(match!.params.category).toBe('images');
    expect(match!.params.name).toBe('photo.png');
  });

  test('should parse query strings', () => {
    router.get('/search', (params, query) => ({ status: 200, body: query }));
    const match = router.match('GET', '/search?q=test&page=2');
    expect(match).not.toBeNull();
    expect(match!.query.q).toBe('test');
    expect(match!.query.page).toBe('2');
  });

  test('should return null for unmatched route', () => {
    router.get('/hello', () => ({ status: 200 }));
    const match = router.match('GET', '/notfound');
    expect(match).toBeNull();
  });

  test('should return null for wrong method', () => {
    router.get('/hello', () => ({ status: 200 }));
    const match = router.match('POST', '/hello');
    expect(match).toBeNull();
  });

  test('should list all routes', () => {
    router.get('/a', () => ({ status: 200 }));
    router.post('/b', () => ({ status: 201 }));
    const routes = router.listRoutes();
    expect(routes.length).toBe(2);
  });

  test('should support route grouping with prefix', () => {
    router.group('/api/v1', [], (sub) => {
      sub.get('/users', () => ({ status: 200 }));
    });
    const match = router.match('GET', '/api/v1/users');
    expect(match).not.toBeNull();
  });

  test('should support addRoute directly', () => {
    router.addRoute('GET', '/custom', () => ({ status: 200 }));
    const match = router.match('GET', '/custom');
    expect(match).not.toBeNull();
  });

  test('should remove routes', () => {
    router.get('/temp', () => ({ status: 200 }));
    expect(router.match('GET', '/temp')).not.toBeNull();
    router.removeRoute('GET', '/temp');
    expect(router.match('GET', '/temp')).toBeNull();
  });

  test('should clear all routes', () => {
    router.get('/a', () => ({ status: 200 }));
    router.post('/b', () => ({ status: 201 }));
    router.clear();
    expect(router.listRoutes().length).toBe(0);
  });

  test('should handle URL-encoded path parameters', () => {
    router.get('/users/:name', (params) => ({ status: 200 }));
    const match = router.match('GET', '/users/hello%20world');
    expect(match).not.toBeNull();
    expect(match!.params.name).toBe('hello world');
  });
});

// ============================================================
// Module 2: MiddlewareChain Tests
// ============================================================
describe('MiddlewareChain', () => {
  let chain: MiddlewareChain;

  beforeEach(() => {
    chain = new MiddlewareChain();
  });

  test('should execute middleware in order', async () => {
    const order: number[] = [];
    chain.use(async (ctx, next) => { order.push(1); await next(); order.push(4); });
    chain.use(async (ctx, next) => { order.push(2); await next(); order.push(3); });
    await chain.execute({ method: 'GET', path: '/', headers: {} });
    expect(order).toEqual([1, 2, 3, 4]);
  });

  test('should support short-circuit', async () => {
    const order: number[] = [];
    chain.use(async (ctx, next) => { order.push(1); /* don't call next */ });
    chain.use(async (ctx, next) => { order.push(2); await next(); });
    await chain.execute({ method: 'GET', path: '/', headers: {} });
    expect(order).toEqual([1]);
  });

  test('should return chain for use()', () => {
    const result = chain.use(async () => {});
    expect(result).toBe(chain);
  });

  test('should handle errors in middleware', async () => {
    const errors: string[] = [];
    chain.use(async () => { throw new Error('test error'); });
    chain.use(async () => {});
    const response = await chain.execute({ method: 'GET', path: '/', headers: {} });
    expect(response.status).toBe(500);
  });

  test('should support error handler option', async () => {
    let caughtError: Error | null = null;
    chain = new MiddlewareChain({
      onError: (err) => { caughtError = err; },
    });
    chain.use(async () => { throw new Error('caught'); });
    await chain.execute({ method: 'GET', path: '/', headers: {} });
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe('caught');
  });

  test('should support conditional middleware', async () => {
    const order: number[] = [];
    chain.useConditional(
      (ctx) => ctx.method === 'POST',
      async (ctx, next) => { order.push(1); await next(); }
    );
    chain.use(async (ctx, next) => { order.push(2); await next(); });
    await chain.execute({ method: 'GET', path: '/', headers: {} });
    expect(order).toEqual([2]);
  });

  test('conditional middleware should execute when condition is true', async () => {
    const order: number[] = [];
    chain.useConditional(
      (ctx) => ctx.method === 'POST',
      async (ctx, next) => { order.push(1); await next(); }
    );
    await chain.execute({ method: 'POST', path: '/', headers: {} });
    expect(order).toEqual([1]);
  });

  test('should return middleware list', () => {
    chain.use(async () => {});
    chain.use(async () => {});
    expect(chain.length).toBe(2);
  });

  test('should remove middleware by index', () => {
    chain.use(async () => {});
    chain.use(async () => {});
    chain.remove(0);
    expect(chain.length).toBe(1);
  });

  test('should clear all middleware', () => {
    chain.use(async () => {});
    chain.clear();
    expect(chain.length).toBe(0);
  });

  test('errorHandler factory should catch errors', async () => {
    const chain2 = new MiddlewareChain();
    chain2.use(errorHandler((err) => ({ status: 418, body: { error: err.message } })));
    chain2.use(async () => { throw new Error('teapot'); });
    const response = await chain2.execute({ method: 'GET', path: '/', headers: {} });
    expect(response.status).toBe(418);
  });

  test('loggingMiddleware should execute without error', async () => {
    const logs: string[] = [];
    const mw = loggingMiddleware((msg) => logs.push(msg));
    const chain2 = new MiddlewareChain();
    chain2.use(mw);
    await chain2.execute({ method: 'GET', path: '/test', headers: {} });
    expect(logs.length).toBe(2);
  });

  test('timingMiddleware should set timing on context', async () => {
    const chain2 = new MiddlewareChain();
    chain2.use(timingMiddleware());
    const ctx: any = { method: 'GET', path: '/', headers: {} };
    await chain2.execute(ctx);
    expect(ctx._timing).toBeDefined();
    expect(typeof ctx._timing).toBe('number');
  });
});

// ============================================================
// Module 3: RequestValidator Tests
// ============================================================
describe('RequestValidator', () => {
  let validator: RequestValidator;

  beforeEach(() => {
    validator = new RequestValidator();
  });

  test('should validate a valid request body', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: { name: 'test' } },
      { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }
    );
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('should fail on missing required body field', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: {} },
      { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('should validate string type', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: 123 },
      { body: { type: 'string' } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate string minLength', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: 'ab' },
      { body: { type: 'string', minLength: 5 } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate string maxLength', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: 'hello world' },
      { body: { type: 'string', maxLength: 5 } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate string pattern', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: 'abc' },
      { body: { type: 'string', pattern: '^[0-9]+$' } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate string enum', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: 'c' },
      { body: { type: 'string', enum: ['a', 'b'] } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate number type', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: 'not a number' },
      { body: { type: 'number' } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate number min', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: -5 },
      { body: { type: 'number', min: 0 } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate number max', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: 150 },
      { body: { type: 'number', max: 100 } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate number integer', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: 3.14 },
      { body: { type: 'number', integer: true } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate boolean type', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: 'true' },
      { body: { type: 'boolean' } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate array type', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: 'not array' },
      { body: { type: 'array' } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate array minItems', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: [1] },
      { body: { type: 'array', minItems: 3 } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate array maxItems', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: [1, 2, 3, 4] },
      { body: { type: 'array', maxItems: 2 } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate required header', () => {
    const result = validator.validateRequest(
      { method: 'GET', path: '/', headers: {} },
      { headers: { authorization: { required: true } } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate header pattern', () => {
    const result = validator.validateRequest(
      { method: 'GET', path: '/', headers: { 'x-custom': 'bad' } },
      { headers: { 'x-custom': { pattern: '^good' } } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate header values', () => {
    const result = validator.validateRequest(
      { method: 'GET', path: '/', headers: { 'accept': 'text/html' } },
      { headers: { accept: { values: ['application/json'] } } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate required query parameter', () => {
    const result = validator.validateRequest(
      { method: 'GET', path: '/', headers: {}, query: {} },
      { query: { page: { type: 'number', required: true } } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate query parameter type', () => {
    const result = validator.validateRequest(
      { method: 'GET', path: '/', headers: {}, query: { age: 'notnum' } },
      { query: { age: { type: 'number' } } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate content-type', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: { 'content-type': 'text/html' } },
      { contentType: ['application/json'] }
    );
    expect(result.valid).toBe(false);
  });

  test('should pass valid content-type', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: { 'content-type': 'application/json' } },
      { contentType: ['application/json'] }
    );
    expect(result.valid).toBe(true);
  });

  test('should validate file upload size', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, files: [{ name: 'big.txt', size: 2000000, type: 'text/plain' }] },
      { fileUpload: { maxSizeBytes: 1000000 } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate file upload type', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, files: [{ name: 'test.exe', size: 100, type: 'application/exe' }] },
      { fileUpload: { allowedTypes: ['image/png', 'image/jpeg'] } }
    );
    expect(result.valid).toBe(false);
  });

  test('should validate file upload count', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, files: [{ name: 'a', size: 10, type: 'text/plain' }, { name: 'b', size: 10, type: 'text/plain' }, { name: 'c', size: 10, type: 'text/plain' }] },
      { fileUpload: { maxCount: 2 } }
    );
    expect(result.valid).toBe(false);
  });

  test('should generate error response on failure', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: 123 },
      { body: { type: 'string' } }
    );
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(400);
  });

  test('should validate any type passes', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: { anything: true } },
      { body: { type: 'any' } }
    );
    expect(result.valid).toBe(true);
  });

  test('should validate nested object properties', () => {
    const result = validator.validateRequest(
      { method: 'POST', path: '/', headers: {}, body: { user: { age: 'notnum' } } },
      { body: { type: 'object', properties: { user: { type: 'object', properties: { age: { type: 'number' } } } } } }
    );
    expect(result.valid).toBe(false);
  });
});

// ============================================================
// Module 4: ResponseFormatter Tests
// ============================================================
describe('ResponseFormatter', () => {
  let formatter: ResponseFormatter;

  beforeEach(() => {
    formatter = new ResponseFormatter();
  });

  test('should create success response', () => {
    const response = formatter.success({ id: 1 });
    expect(response.success).toBe(true);
    expect(response.data).toEqual({ id: 1 });
    expect(response.timestamp).toBeDefined();
  });

  test('should create error response', () => {
    const response = formatter.error('TEST_ERROR', 'Something went wrong');
    expect(response.success).toBe(false);
    expect(response.error!.code).toBe('TEST_ERROR');
    expect(response.error!.message).toBe('Something went wrong');
  });

  test('should create paginated response', () => {
    const data = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const response = formatter.paginate(data, 1, 10);
    expect(response.success).toBe(true);
    expect(response.data.length).toBe(10);
    expect(response.pagination.page).toBe(1);
    expect(response.pagination.pageSize).toBe(10);
    expect(response.pagination.total).toBe(25);
    expect(response.pagination.totalPages).toBe(3);
  });

  test('should paginate to second page', () => {
    const data = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const response = formatter.paginate(data, 2, 10);
    expect(response.data.length).toBe(10);
    expect(response.pagination.page).toBe(2);
  });

  test('should paginate to last page', () => {
    const data = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const response = formatter.paginate(data, 3, 10);
    expect(response.data.length).toBe(5);
  });

  test('should create created response', () => {
    const response = formatter.created({ id: 1 }, '/users/1');
    expect(response.success).toBe(true);
    expect(response.meta!.location).toBe('/users/1');
  });

  test('should create noContent response', () => {
    const response = formatter.noContent();
    expect(response.success).toBe(true);
  });

  test('should create notFound response', () => {
    const response = formatter.notFound('User', '42');
    expect(response.success).toBe(false);
    expect(response.error!.code).toBe('NOT_FOUND');
  });

  test('should create unauthorized response', () => {
    const response = formatter.unauthorized();
    expect(response.success).toBe(false);
    expect(response.error!.code).toBe('UNAUTHORIZED');
  });

  test('should create forbidden response', () => {
    const response = formatter.forbidden();
    expect(response.success).toBe(false);
    expect(response.error!.code).toBe('FORBIDDEN');
  });

  test('should create badRequest response', () => {
    const response = formatter.badRequest('Invalid input');
    expect(response.success).toBe(false);
    expect(response.error!.code).toBe('BAD_REQUEST');
  });

  test('should create internalError response', () => {
    const response = formatter.internalError();
    expect(response.success).toBe(false);
    expect(response.error!.code).toBe('INTERNAL_ERROR');
  });

  test('should create tooManyRequests response', () => {
    const response = formatter.tooManyRequests(60);
    expect(response.success).toBe(false);
    expect(response.error!.code).toBe('TOO_MANY_REQUESTS');
  });

  test('should generate HATEOAS links', () => {
    const links = formatter.generateHATEOASLinks('/api/users', 2, 10, 50);
    const rels = links.map((l) => l.rel);
    expect(rels).toContain('self');
    expect(rels).toContain('prev');
    expect(rels).toContain('next');
    expect(rels).toContain('first');
    expect(rels).toContain('last');
  });

  test('should format as JSON', () => {
    const response = formatter.success({ test: true });
    const formatted = formatter.format(response, 'json');
    const parsed = JSON.parse(formatted);
    expect(parsed.success).toBe(true);
  });

  test('should format as XML', () => {
    const response = formatter.success({ test: true });
    const formatted = formatter.format(response, 'xml');
    expect(formatted).toContain('<?xml');
    expect(formatted).toContain('<success>true</success>');
  });

  test('should format as msgpack (simulated)', () => {
    const response = formatter.success({ test: true });
    const formatted = formatter.format(response, 'msgpack');
    const parsed = JSON.parse(formatted);
    expect(parsed.__msgpack).toBe(true);
  });

  test('should include meta in success response', () => {
    const response = formatter.success({ data: 1 }, { requestId: 'abc' });
    expect(response.meta!.requestId).toBe('abc');
  });

  test('should include details in error response', () => {
    const response = formatter.error('CODE', 'msg', { field: 'name' });
    expect(response.error!.details).toEqual({ field: 'name' });
  });

  test('paginateWithTotal should work correctly', () => {
    const response = formatter.paginateWithTotal([1, 2], 100, 1, 10);
    expect(response.pagination.total).toBe(100);
    expect(response.pagination.totalPages).toBe(10);
  });
});

// ============================================================
// Module 5: APIRateLimiter Tests
// ============================================================
describe('APIRateLimiter', () => {
  let limiter: APIRateLimiter;

  beforeEach(() => {
    limiter = new APIRateLimiter({ windowMs: 1000, maxRequests: 5 });
  });

  test('should allow requests under limit', () => {
    const result = limiter.checkLimit('client1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  test('should deny requests over limit', () => {
    for (let i = 0; i < 5; i++) {
      limiter.checkLimit('client1');
    }
    const result = limiter.checkLimit('client1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeDefined();
  });

  test('isAllowed should return correct value', () => {
    expect(limiter.isAllowed('client1')).toBe(true);
  });

  test('should track per-endpoint limits', () => {
    limiter.setEndpointConfig('/api/heavy', { windowMs: 1000, maxRequests: 2 });
    limiter.checkLimit('client1', '/api/heavy');
    limiter.checkLimit('client1', '/api/heavy');
    const result = limiter.checkLimit('client1', '/api/heavy');
    expect(result.allowed).toBe(false);
  });

  test('should generate rate limit headers', () => {
    limiter.checkLimit('client1');
    const headers = limiter.getRateLimitHeaders('client1');
    expect(headers['X-RateLimit-Limit']).toBe('5');
    expect(headers['X-RateLimit-Remaining']).toBeDefined();
    expect(headers['X-RateLimit-Reset']).toBeDefined();
  });

  test('should support client overrides', () => {
    limiter.setClientOverride('vip', { windowMs: 1000, maxRequests: 100 });
    for (let i = 0; i < 10; i++) {
      limiter.checkLimit('vip');
    }
    expect(limiter.isAllowed('vip')).toBe(true);
  });

  test('should reset client limits', () => {
    for (let i = 0; i < 5; i++) limiter.checkLimit('client1');
    expect(limiter.isAllowed('client1')).toBe(false);
    limiter.reset('client1');
    expect(limiter.isAllowed('client1')).toBe(true);
  });

  test('should reset all limits', () => {
    limiter.checkLimit('a');
    limiter.checkLimit('b');
    limiter.resetAll();
    const stats = limiter.getStats();
    expect(stats.totalClients).toBe(0);
  });

  test('should provide stats', () => {
    limiter.checkLimit('a');
    limiter.checkLimit('a');
    const stats = limiter.getStats();
    expect(stats.totalClients).toBe(1);
    expect(stats.hits + stats.misses).toBeGreaterThan(0);
  });

  test('should return correct limit in result', () => {
    const result = limiter.checkLimit('client1');
    expect(result.limit).toBe(5);
  });
});

// ============================================================
// Module 6: AuthMiddleware Tests
// ============================================================
describe('AuthMiddleware', () => {
  let auth: AuthMiddleware;

  beforeEach(() => {
    auth = new AuthMiddleware();
  });

  test('should create bearer authenticate middleware', () => {
    const mw = auth.authenticate('bearer');
    expect(typeof mw).toBe('function');
  });

  test('should fail without token', async () => {
    const mw = auth.authenticate('bearer');
    const ctx: any = { method: 'GET', path: '/', headers: {} };
    await mw(ctx, async () => {});
    expect(ctx._response).toBeDefined();
    expect(ctx._response.status).toBe(401);
  });

  test('should pass with valid bearer token', async () => {
    const mw = auth.authenticate('bearer');
    const ctx: any = { method: 'GET', path: '/', headers: { authorization: 'Bearer validtoken12345' } };
    let nextCalled = false;
    await mw(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(ctx._auth).toBeDefined();
    expect(ctx._auth.user.id).toBeDefined();
  });

  test('should fail with short bearer token', async () => {
    const mw = auth.authenticate('bearer');
    const ctx: any = { method: 'GET', path: '/', headers: { authorization: 'Bearer short' } };
    await mw(ctx, async () => {});
    expect(ctx._response.status).toBe(401);
  });

  test('should authenticate with API key', async () => {
    const mw = auth.authenticate('apikey');
    const ctx: any = { method: 'GET', path: '/', headers: { 'x-api-key': 'key_validkey123' } };
    let nextCalled = false;
    await mw(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  test('should fail with invalid API key', async () => {
    const mw = auth.authenticate('apikey');
    const ctx: any = { method: 'GET', path: '/', headers: { 'x-api-key': 'invalid' } };
    await mw(ctx, async () => {});
    expect(ctx._response.status).toBe(401);
  });

  test('should authorize with correct role', async () => {
    const mw = auth.authorize(['admin']);
    const ctx: any = { method: 'GET', path: '/', headers: {}, _auth: { user: { id: '1', roles: ['admin'], scopes: [] } } };
    let nextCalled = false;
    await mw(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  test('should fail authorization with wrong role', async () => {
    const mw = auth.authorize(['admin']);
    const ctx: any = { method: 'GET', path: '/', headers: {}, _auth: { user: { id: '1', roles: ['user'], scopes: [] } } };
    await mw(ctx, async () => {});
    expect(ctx._response.status).toBe(403);
  });

  test('should fail authorization without auth', async () => {
    const mw = auth.authorize(['admin']);
    const ctx: any = { method: 'GET', path: '/', headers: {} };
    await mw(ctx, async () => {});
    expect(ctx._response.status).toBe(401);
  });

  test('should authorize with correct scope', async () => {
    const mw = auth.authorize([], 'write');
    const ctx: any = { method: 'GET', path: '/', headers: {}, _auth: { user: { id: '1', roles: [], scopes: ['read', 'write'] } } };
    let nextCalled = false;
    await mw(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  test('should fail authorization with wrong scope', async () => {
    const mw = auth.authorize([], 'admin');
    const ctx: any = { method: 'GET', path: '/', headers: {}, _auth: { user: { id: '1', roles: [], scopes: ['read'] } } };
    await mw(ctx, async () => {});
    expect(ctx._response.status).toBe(403);
  });

  test('should create auth failure response', () => {
    const response = auth.createAuthFailureResponse(401, 'UNAUTHORIZED', 'No token', 'API');
    expect(response.status).toBe(401);
    expect(response.headers!['WWW-Authenticate']).toContain('Bearer');
  });

  test('should extract token from query param', async () => {
    const mw = auth.authenticate('bearer', { tokenLookup: ['query'] });
    const ctx: any = { method: 'GET', path: '/', headers: {}, query: { token: 'validtoken12345' } };
    let nextCalled = false;
    await mw(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  test('should extract token from cookie', async () => {
    const mw = auth.authenticate('bearer', { tokenLookup: ['cookie'] });
    const ctx: any = { method: 'GET', path: '/', headers: { cookie: 'token=validtoken12345' } };
    let nextCalled = false;
    await mw(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});

// ============================================================
// Module 7: APICache Tests
// ============================================================
describe('APICache', () => {
  let cache: APICache;

  beforeEach(() => {
    cache = new APICache({ defaultTTL: 5000 });
  });

  test('should store and retrieve cached response', () => {
    cache.set('key1', { body: { data: 'test' }, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 5000 });
    const result = cache.get('key1');
    expect(result).toBeDefined();
    expect(result!.body).toEqual({ data: 'test' });
  });

  test('should return undefined for missing key', () => {
    const result = cache.get('nonexistent');
    expect(result).toBeUndefined();
  });

  test('should check has()', () => {
    cache.set('key1', { body: 'val', status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 5000 });
    expect(cache.has('key1')).toBe(true);
    expect(cache.has('nonexistent')).toBe(false);
  });

  test('should invalidate by pattern', () => {
    cache.set('users:1', { body: 'a', status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 5000 });
    cache.set('users:2', { body: 'b', status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 5000 });
    cache.set('posts:1', { body: 'c', status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 5000 });
    const count = cache.invalidate('^users:');
    expect(count).toBe(2);
    expect(cache.get('users:1')).toBeUndefined();
    expect(cache.get('posts:1')).toBeDefined();
  });

  test('should invalidate by tag', () => {
    cache.set('k1', { body: 'a', status: 200, headers: {}, tags: ['users'], createdAt: Date.now(), ttl: 5000 });
    cache.set('k2', { body: 'b', status: 200, headers: {}, tags: ['posts'], createdAt: Date.now(), ttl: 5000 });
    const count = cache.invalidateByTag('users');
    expect(count).toBe(1);
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('k2')).toBeDefined();
  });

  test('should invalidate by multiple tags', () => {
    cache.set('k1', { body: 'a', status: 200, headers: {}, tags: ['users'], createdAt: Date.now(), ttl: 5000 });
    cache.set('k2', { body: 'b', status: 200, headers: {}, tags: ['posts'], createdAt: Date.now(), ttl: 5000 });
    cache.set('k3', { body: 'c', status: 200, headers: {}, tags: ['admin'], createdAt: Date.now(), ttl: 5000 });
    const count = cache.invalidateByTags(['users', 'admin']);
    expect(count).toBe(2);
  });

  test('should return cache stats', () => {
    cache.set('k1', { body: 'a', status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 5000 });
    cache.get('k1'); // hit
    cache.get('miss'); // miss
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  test('should clear cache', () => {
    cache.set('k1', { body: 'a', status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 5000 });
    cache.clear();
    expect(cache.getSize()).toBe(0);
  });

  test('should generate cache key', () => {
    const key = cache.generateKey('GET', '/users', { page: '1' });
    expect(key).toContain('GET:/users');
    expect(key).toContain('page=1');
  });

  test('should generate cache key with sorted query params', () => {
    const key1 = cache.generateKey('GET', '/test', { b: '2', a: '1' });
    const key2 = cache.generateKey('GET', '/test', { a: '1', b: '2' });
    expect(key1).toBe(key2);
  });

  test('should check ETag', () => {
    cache.set('k1', { body: 'data', status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 5000 });
    const entry = cache.get('k1');
    expect(cache.checkETag('k1', entry!.etag)).toBe(true);
  });

  test('should get cache headers', () => {
    cache.set('k1', { body: 'data', status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 5000 });
    const headers = cache.getCacheHeaders('k1');
    expect(headers['ETag']).toBeDefined();
    expect(headers['Cache-Control']).toBeDefined();
  });

  test('should set with tags option', () => {
    cache.set('k1', { body: 'data', status: 200, headers: {}, tags: [] }, { tags: ['custom'] });
    const count = cache.invalidateByTag('custom');
    expect(count).toBe(1);
  });

  test('should set with custom TTL', () => {
    cache.set('k1', { body: 'data', status: 200, headers: {}, tags: [] }, { ttl: 10000 });
    const entry = cache.get('k1');
    expect(entry!.ttl).toBe(10000);
  });
});

// ============================================================
// Module 8: APIDocumentationGenerator Tests
// ============================================================
describe('APIDocumentationGenerator', () => {
  let doc: APIDocumentationGenerator;

  beforeEach(() => {
    doc = new APIDocumentationGenerator({ title: 'Test API', version: '1.0.0' });
  });

  test('should register an endpoint', () => {
    doc.registerEndpoint('/users', 'GET', { summary: 'List users' });
    const endpoints = doc.getEndpoints();
    expect(endpoints.length).toBe(1);
  });

  test('should generate OpenAPI spec', () => {
    doc.registerEndpoint('/users', 'GET', { summary: 'List users', tags: ['Users'] });
    const spec = doc.generateOpenAPISpec();
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info.title).toBe('Test API');
    expect(spec.paths['/users']).toBeDefined();
    expect(spec.paths['/users'].get).toBeDefined();
  });

  test('should generate OpenAPI spec with multiple methods', () => {
    doc.registerEndpoint('/users', 'GET', { summary: 'List users' });
    doc.registerEndpoint('/users', 'POST', { summary: 'Create user' });
    const spec = doc.generateOpenAPISpec();
    expect(spec.paths['/users'].get).toBeDefined();
    expect(spec.paths['/users'].post).toBeDefined();
  });

  test('should generate OpenAPI spec with parameters', () => {
    doc.registerEndpoint('/users/:id', 'GET', {
      summary: 'Get user',
      parameters: [{ name: 'id', in: 'path', required: true, type: 'string' }],
    });
    const spec = doc.generateOpenAPISpec();
    expect(spec.paths['/users/:id'].get!.parameters).toBeDefined();
    expect(spec.paths['/users/:id'].get!.parameters!.length).toBe(1);
  });

  test('should generate OpenAPI spec with request body', () => {
    doc.registerEndpoint('/users', 'POST', {
      summary: 'Create user',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object' } } },
      },
    });
    const spec = doc.generateOpenAPISpec();
    expect(spec.paths['/users'].post!.requestBody).toBeDefined();
  });

  test('should generate OpenAPI spec with security schemes', () => {
    doc.addSecurityScheme('bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    const spec = doc.generateOpenAPISpec();
    expect(spec.components!.securitySchemes!.bearerAuth).toBeDefined();
  });

  test('should generate OpenAPI spec with tags', () => {
    doc.registerEndpoint('/users', 'GET', { tags: ['Users'] });
    doc.registerEndpoint('/posts', 'GET', { tags: ['Posts'] });
    const spec = doc.generateOpenAPISpec();
    expect(spec.tags!.length).toBe(2);
  });

  test('should generate Markdown documentation', () => {
    doc.registerEndpoint('/users', 'GET', { summary: 'List users', tags: ['Users'] });
    const md = doc.generateMarkdown();
    expect(md).toContain('# Test API');
    expect(md).toContain('GET /users');
    expect(md).toContain('List users');
  });

  test('should generate Markdown with parameters table', () => {
    doc.registerEndpoint('/users/:id', 'GET', {
      summary: 'Get user',
      parameters: [{ name: 'id', in: 'path', required: true, type: 'string', description: 'User ID' }],
    });
    const md = doc.generateMarkdown();
    expect(md).toContain('Parameters');
    expect(md).toContain('| id |');
  });

  test('should generate explorer data', () => {
    doc.registerEndpoint('/users', 'GET', { summary: 'List users', tags: ['Users'] });
    doc.registerEndpoint('/users', 'POST', { summary: 'Create user', tags: ['Users'] });
    const data = doc.generateExplorerData();
    expect(data.routes.length).toBe(2);
  });

  test('should add custom tag', () => {
    doc.addTag('Custom', 'Custom tag description');
    const spec = doc.generateOpenAPISpec();
    const tag = spec.tags!.find((t) => t.name === 'Custom');
    expect(tag).toBeDefined();
    expect(tag!.description).toBe('Custom tag description');
  });

  test('should mark deprecated endpoints', () => {
    doc.registerEndpoint('/old', 'GET', { deprecated: true });
    const spec = doc.generateOpenAPISpec();
    expect(spec.paths['/old'].get!.deprecated).toBe(true);
  });

  test('should generate operationId', () => {
    doc.registerEndpoint('/users/:id', 'GET', { summary: 'Get user' });
    const spec = doc.generateOpenAPISpec();
    expect(spec.paths['/users/:id'].get!.operationId).toBe('getUsersById');
  });
});

// ============================================================
// Module 9: CORSHandler Tests
// ============================================================
describe('CORSHandler', () => {
  let cors: CORSHandler;

  beforeEach(() => {
    cors = new CORSHandler();
  });

  test('should generate CORS headers for default config', () => {
    const request = { method: 'GET', path: '/', headers: { origin: 'http://example.com' } };
    const headers = cors.handle(request);
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('should identify preflight requests', () => {
    const request = {
      method: 'OPTIONS',
      path: '/',
      headers: { origin: 'http://example.com', 'access-control-request-method': 'POST' },
    };
    expect(cors.isPreflight(request)).toBe(true);
  });

  test('should not identify non-preflight OPTIONS', () => {
    const request = {
      method: 'OPTIONS',
      path: '/',
      headers: {},
    };
    expect(cors.isPreflight(request)).toBe(false);
  });

  test('should identify CORS requests', () => {
    const request = { method: 'GET', path: '/', headers: { origin: 'http://other.com', host: 'example.com' } };
    expect(cors.isCORSRequest(request)).toBe(true);
  });

  test('should not identify same-origin as CORS', () => {
    const request = { method: 'GET', path: '/', headers: { origin: 'http://example.com', host: 'http://example.com' } };
    expect(cors.isCORSRequest(request)).toBe(false);
  });

  test('should support array of origins', () => {
    cors.updateDefaultConfig({ origin: ['http://allowed.com', 'http://other.com'] });
    const request = { method: 'GET', path: '/', headers: { origin: 'http://allowed.com' } };
    const headers = cors.handle(request);
    expect(headers['Access-Control-Allow-Origin']).toBe('http://allowed.com');
  });

  test('should support function origin validation', () => {
    cors.updateDefaultConfig({ origin: (origin) => origin.endsWith('.example.com') });
    const request = { method: 'GET', path: '/', headers: { origin: 'http://api.example.com' } };
    const headers = cors.handle(request);
    expect(headers['Access-Control-Allow-Origin']).toBe('http://api.example.com');
  });

  test('should set per-route CORS config', () => {
    cors.setRouteConfig('/admin', { origin: 'http://admin.example.com', methods: ['GET'], allowedHeaders: [], exposedHeaders: [], maxAge: 0 });
    const request = { method: 'GET', path: '/admin', headers: { origin: 'http://admin.example.com' } };
    const headers = cors.handle(request, '/admin');
    expect(headers['Access-Control-Allow-Origin']).toBe('http://admin.example.com');
  });

  test('should remove per-route CORS config', () => {
    cors.setRouteConfig('/test', { origin: '*', methods: ['GET'], allowedHeaders: [], exposedHeaders: [], maxAge: 0 });
    expect(cors.removeRouteConfig('/test')).toBe(true);
    expect(cors.getRouteConfig('/test')).toBeUndefined();
  });

  test('should include credentials header', () => {
    cors.updateDefaultConfig({ credentials: true });
    const request = { method: 'GET', path: '/', headers: { origin: 'http://example.com' } };
    const headers = cors.handle(request);
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });

  test('should include max-age header', () => {
    const request = { method: 'GET', path: '/', headers: { origin: 'http://example.com' } };
    const headers = cors.handle(request);
    expect(headers['Access-Control-Max-Age']).toBeDefined();
  });

  test('createDefault should return a CORSHandler', () => {
    const handler = CORSHandler.createDefault();
    expect(handler).toBeInstanceOf(CORSHandler);
  });

  test('createStrict should restrict origins', () => {
    const handler = CORSHandler.createStrict(['http://only.com']);
    const request = { method: 'GET', path: '/', headers: { origin: 'http://only.com' } };
    const headers = handler.handle(request);
    expect(headers['Access-Control-Allow-Origin']).toBe('http://only.com');
  });

  test('createPermissive should allow all', () => {
    const handler = CORSHandler.createPermissive();
    const request = { method: 'GET', path: '/', headers: { origin: 'http://any.com' } };
    const headers = handler.handle(request);
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('should include allowed methods', () => {
    const request = { method: 'GET', path: '/', headers: { origin: 'http://example.com' } };
    const headers = cors.handle(request);
    expect(headers['Access-Control-Allow-Methods']).toBeDefined();
    expect(headers['Access-Control-Allow-Methods']!.includes('GET')).toBe(true);
  });
});

// ============================================================
// Module 10: WebSocketManager Tests
// ============================================================
describe('WebSocketManager', () => {
  let ws: WebSocketManager;

  beforeEach(() => {
    ws = new WebSocketManager();
  });

  test('should handle connection', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    expect(ws.getConnection('conn1')).toBeDefined();
  });

  test('should disconnect a connection', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    expect(ws.disconnect('conn1')).toBe(true);
    expect(ws.getConnection('conn1')).toBeUndefined();
  });

  test('should return false for disconnecting non-existent connection', () => {
    expect(ws.disconnect('nonexistent')).toBe(false);
  });

  test('should join a channel', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    expect(ws.joinChannel('conn1', 'room1')).toBe(true);
    expect(ws.getChannelMembers('room1')).toContain('conn1');
  });

  test('should leave a channel', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    ws.joinChannel('conn1', 'room1');
    expect(ws.leaveChannel('conn1', 'room1')).toBe(true);
    expect(ws.getChannelMembers('room1')).not.toContain('conn1');
  });

  test('should broadcast to channel', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    ws.handleConnection({ id: 'conn2', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    ws.joinChannel('conn1', 'room1');
    ws.joinChannel('conn2', 'room1');
    const count = ws.broadcast('room1', { text: 'hello' });
    expect(count).toBe(2);
  });

  test('should broadcast to all connections', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    ws.handleConnection({ id: 'conn2', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    const count = ws.broadcastAll({ text: 'hello all' });
    expect(count).toBe(2);
  });

  test('should send to specific connection', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    expect(ws.send('conn1', { text: 'private' })).toBe(true);
  });

  test('should fail to send to non-existent connection', () => {
    expect(ws.send('nonexistent', {})).toBe(false);
  });

  test('should handle messages', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    let received = false;
    ws.onMessage('message', (conn, msg) => { received = true; });
    ws.handleMessage('conn1', { type: 'message', data: 'hello' });
    expect(received).toBe(true);
  });

  test('should handle join via message', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    ws.handleMessage('conn1', { type: 'join', channel: 'room1' });
    expect(ws.getChannelMembers('room1')).toContain('conn1');
  });

  test('should handle leave via message', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    ws.joinChannel('conn1', 'room1');
    ws.handleMessage('conn1', { type: 'leave', channel: 'room1' });
    expect(ws.getChannelMembers('room1')).not.toContain('conn1');
  });

  test('should handle wildcard message handler', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    let received = false;
    ws.onMessage('*', (conn, msg) => { received = true; });
    ws.handleMessage('conn1', { type: 'custom', data: 'test' });
    expect(received).toBe(true);
  });

  test('should authenticate connection', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    expect(ws.authenticate('conn1', 'user1')).toBe(true);
    const conn = ws.getConnection('conn1');
    expect(conn!.authenticated).toBe(true);
    expect(conn!.userId).toBe('user1');
  });

  test('should track connection stats', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    ws.joinChannel('conn1', 'room1');
    ws.send('conn1', { text: 'test' });
    const stats = ws.getStats();
    expect(stats.totalConnections).toBe(1);
    expect(stats.totalMessagesSent).toBe(1);
    expect(stats.channelsCount).toBe(1);
  });

  test('should get all connections', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    ws.handleConnection({ id: 'conn2', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    expect(ws.getConnections().length).toBe(2);
  });

  test('should get all channels', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    ws.joinChannel('conn1', 'room1');
    ws.joinChannel('conn1', 'room2');
    expect(ws.getChannels().length).toBe(2);
  });

  test('should fire onConnect handler', () => {
    let connected = false;
    ws.onConnect(() => { connected = true; });
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    expect(connected).toBe(true);
  });

  test('should fire onDisconnect handler', () => {
    let disconnected = false;
    ws.onDisconnect(() => { disconnected = true; });
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    ws.disconnect('conn1');
    expect(disconnected).toBe(true);
  });

  test('should clear all state', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    ws.clear();
    expect(ws.getConnections().length).toBe(0);
    expect(ws.getChannels().length).toBe(0);
  });

  test('should handle pong messages', () => {
    ws.handleConnection({ id: 'conn1', socket: null, channels: new Set(), authenticated: false, metadata: {}, connectedAt: 0, lastPing: 0, lastPong: 0 });
    // Should not throw
    ws.handleMessage('conn1', { type: 'pong' });
  });

  test('should return empty channel members for non-existent channel', () => {
    expect(ws.getChannelMembers('nonexistent')).toEqual([]);
  });

  test('should return empty members for non-existent channel in broadcast', () => {
    expect(ws.broadcast('nonexistent', {})).toBe(0);
  });
});
