// src/index.ts - 导出所有模块

// Router
export {
  Router,
  type RouteHandler,
  type RouteOptions,
  type RouteInfo,
  type RouteMatch,
  type RequestContext,
  type ResponseContext,
  type Middleware,
} from './router.ts';

// Middleware Chain
export {
  MiddlewareChain,
  errorHandler,
  loggingMiddleware,
  timingMiddleware,
} from './middleware-chain.ts';

// Request Validator
export {
  RequestValidator,
  type FieldValidationRule,
  type HeaderRule,
  type QueryParamRule,
  type PathParamRule,
  type FileUploadRule,
  type RequestSchema,
  type ValidationError,
  type ValidationResult,
  type IncomingRequest,
} from './request-validator.ts';

// Response Formatter
export {
  ResponseFormatter,
  type ResponseMeta,
  type ResponseEnvelope,
  type PaginationInfo,
  type PaginatedResponse,
  type HATEOASLink,
  type ContentType,
} from './response-formatter.ts';

// Rate Limiter
export {
  APIRateLimiter,
  type RateLimitConfig,
  type RateLimitResult,
} from './rate-limiter.ts';

// Auth Middleware
export {
  AuthMiddleware,
  type AuthScheme,
  type AuthConfig,
  type AuthUser,
  type TokenPayload,
  type AuthContext,
} from './auth-middleware.ts';

// API Cache
export {
  APICache,
  type CacheStrategy,
  type CacheOptions,
  type CachedResponse,
  type CacheStats,
} from './api-cache.ts';

// API Documentation
export {
  APIDocumentationGenerator,
  type EndpointMetadata,
  type ParameterSpec,
  type RequestBodySpec,
  type MediaSpec,
  type ResponseSpec,
  type SecuritySpec,
  type OpenAPISpec,
  type OperationObject,
  type TagObject,
} from './api-documentation.ts';

// CORS Handler
export {
  CORSHandler,
  type CORSConfig,
  type CORSHeaders,
  type IncomingRequest as CORSIncomingRequest,
} from './cors-handler.ts';

// WebSocket Manager
export {
  WebSocketManager,
  type WSConnection,
  type WSMessage,
  type ConnectionStats,
} from './websocket-manager.ts';
