/**
 * InfoLang — official TypeScript SDK for InfoLang semantic memory.
 *
 * @example
 * ```ts
 * import { InfoLang } from "@infolang/sdk";
 *
 * const il = InfoLang.fromApiKey("il_live_...");
 * const result = await il.investigate("How does auth middleware work?");
 * for (const chunk of result.chunks) console.log(chunk.score, chunk.text);
 * ```
 */

export {
  CLOUD_BASE_URL,
  DIRECT_BASE_URL,
  InfoLang,
  type InfoLangOptions,
} from "./client.js";
export {
  ApiKeyAuth,
  type AuthProvider,
  DevKeyAuth,
  DEFAULT_SESSION_PATH,
  OriginAuth,
  SessionFileAuth,
} from "./auth.js";
export {
  AuthenticationError,
  InfoLangAPIError,
  InfoLangConfigError,
  InfoLangConnectionError,
  InfoLangError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "./errors.js";
export type {
  Bank,
  Chunk,
  ContextPack,
  ContextPackOptions,
  InvestigateOptions,
  ListRecentOptions,
  MeteringMeta,
  RecallOptions,
  RecallResult,
  RememberOptions,
  RememberResult,
} from "./types.js";
export { version } from "./version.js";
