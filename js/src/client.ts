import { GrauntConnectionError, GrauntError } from "./errors.js";
import type {
  LibraryEntitlement,
  LibraryManifest,
  ListingDetail,
  ListingSearchParams,
  ListingSearchResult,
  ListingSummary,
  PacketManifest,
} from "./types.js";
import { VERSION } from "./version.js";

const DEFAULT_BASE_URL = "https://api.graunt.com";
const DEFAULT_TIMEOUT_MS = 30_000;
/** The shape the API itself enforces before any lookup (HR-35). */
const ACCESS_PASS_PATTERN = /^gap_live_[0-9a-fA-F]{64}$/;

export interface GrauntOptions {
  /** API origin. Defaults to `https://api.graunt.com`. */
  baseUrl?: string;
  /**
   * A read-only access pass (`gap_live_` followed by 64 hex characters). Only
   * the `library` methods send it; catalog calls never do.
   */
  accessPass?: string;
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** A `fetch` implementation. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

type QueryValue = string | number | boolean | undefined;

interface SendOptions {
  query?: Record<string, QueryValue>;
  /** Attach the access pass as a Bearer token. */
  pass?: boolean;
}

/**
 * HTTP plumbing shared by the resource groups. Exported from this module only so
 * declarations can name it; the package entry point does not re-export it.
 */
export class Transport {
  readonly #baseUrl: string;
  readonly #accessPass: string | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: GrauntOptions) {
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new TypeError("baseUrl must be an absolute http(s) URL.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new TypeError("baseUrl must be an absolute http(s) URL.");
    }
    if (options.accessPass !== undefined && !ACCESS_PASS_PATTERN.test(options.accessPass)) {
      // The value is deliberately left out of the message: it is a credential.
      throw new TypeError("accessPass must be a Graunt access pass: gap_live_ followed by 64 hex characters.");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("timeoutMs must be a positive number.");
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new TypeError("No fetch implementation is available; pass options.fetch.");
    }
    this.#baseUrl = baseUrl;
    this.#accessPass = options.accessPass;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
  }

  /** GET and return the raw response; throws on any non-2xx status. */
  async send(path: string, options: SendOptions = {}): Promise<Response> {
    if (!path.startsWith("/")) throw new TypeError("path must start with /");
    const url = new URL(this.#baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": `graunt-js/${VERSION}`,
    };
    if (options.pass) {
      if (this.#accessPass === undefined) {
        throw new TypeError("This call needs an access pass: new Graunt({ accessPass: \"gap_live_...\" }).");
      }
      headers.authorization = `Bearer ${this.#accessPass}`;
    }
    // Errors name the origin and path only: a query can carry a search term.
    const where = `${url.origin}${url.pathname}`;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers,
        // A call carrying the pass refuses redirects, so the credential can only
        // ever reach the configured origin. Catalog calls carry nothing to leak.
        redirect: options.pass ? "error" : "follow",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      throw new GrauntConnectionError(`GET ${where} failed: ${describe(err)}`, { cause: err });
    }
    if (!response.ok) throw await toGrauntError(response);
    return response;
  }

  /** GET a JSON body. */
  async json(path: string, options: SendOptions = {}): Promise<unknown> {
    const response = await this.send(path, options);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new GrauntError({
        status: response.status,
        code: "UNEXPECTED_RESPONSE",
        message: `GET ${path} returned a body that is not JSON.`,
      });
    }
  }

  /** GET Graunt's success envelope `{ ok: true, data }` and return `data`. */
  async data<T>(path: string, options: SendOptions = {}): Promise<T> {
    const body = await this.json(path, options);
    if (isRecord(body) && body.ok === true && "data" in body) return body.data as T;
    throw new GrauntError({
      status: 200,
      code: "UNEXPECTED_RESPONSE",
      message: `GET ${path} did not return Graunt's { ok: true, data } envelope.`,
    });
  }
}

/** Public catalog: search, listing detail and packet manifests. No credential needed. */
export class ListingsResource {
  readonly #t: Transport;
  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Search active listings. Returns one page and its pagination. */
  async search(params: ListingSearchParams = {}): Promise<ListingSearchResult> {
    return this.#t.data<ListingSearchResult>("/v1/listings", { query: searchQuery(params) });
  }

  /** Every listing that matches, page after page, until the reported total is reached. */
  async *searchAll(params: Omit<ListingSearchParams, "page"> = {}): AsyncGenerator<ListingSummary> {
    let page = 1;
    let seen = 0;
    for (;;) {
      const { listings, pagination } = await this.search({ ...params, page });
      for (const listing of listings) yield listing;
      seen += listings.length;
      if (listings.length === 0 || seen >= pagination.total) return;
      page += 1;
    }
  }

  /** One listing's full public detail. */
  async get(id: string): Promise<ListingDetail> {
    return this.#t.data<ListingDetail>(`/v1/listings/${segment(id, "id")}`);
  }

  /**
   * A packet listing's canonical manifest, with the SHA-256 of the exact bytes
   * served. A listing without a packet manifest answers 404 `NO_MANIFEST`.
   */
  async manifest(id: string): Promise<PacketManifest> {
    const response = await this.#t.send(`/v1/listings/${segment(id, "id")}/manifest`);
    const buffer = await response.arrayBuffer();
    const canonicalJson = new TextDecoder().decode(buffer);
    let manifest: unknown;
    try {
      manifest = JSON.parse(canonicalJson);
    } catch {
      throw new GrauntError({ status: response.status, code: "UNEXPECTED_RESPONSE", message: "The manifest is not JSON." });
    }
    if (!isRecord(manifest)) {
      throw new GrauntError({ status: response.status, code: "UNEXPECTED_RESPONSE", message: "The manifest is not a JSON object." });
    }
    const signatureHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      if (name.toLowerCase().startsWith("x-graunt-")) signatureHeaders[name.toLowerCase()] = value;
    });
    return { manifest, canonicalJson, sha256: await sha256Hex(buffer), signatureHeaders };
  }
}

/** Machine-readable facts about the marketplace. No credential needed. */
export class MetaResource {
  readonly #t: Transport;
  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** The capabilities Graunt offers today. */
  capabilities(): Promise<Record<string, unknown>> {
    return this.#t.data<Record<string, unknown>>("/v1/meta/capabilities");
  }

  /** The platform pricing schedule. */
  pricing(): Promise<Record<string, unknown>> {
    return this.#t.data<Record<string, unknown>>("/v1/meta/pricing");
  }
}

/** What an access pass can read. Every call sends the pass; it never writes. */
export class LibraryResource {
  readonly #t: Transport;
  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** The pass, its scope, and every item it can read. */
  manifest(): Promise<LibraryManifest> {
    return this.#t.data<LibraryManifest>("/v1/access-passes/manifest", { pass: true });
  }

  /** The resource IDs the pass can read. */
  async list(): Promise<string[]> {
    const data = await this.#t.data<{ resource_ids: string[] }>("/v1/access-passes/resources", { pass: true });
    return data.resource_ids;
  }

  /** One readable item. An item outside the pass answers 404. */
  async get(resourceId: string): Promise<LibraryEntitlement> {
    return this.#t.data<LibraryEntitlement>(`/v1/access-passes/resources/${segment(resourceId, "resourceId")}`, {
      pass: true,
    });
  }
}

/**
 * Client for the Graunt API.
 *
 * ```ts
 * const graunt = new Graunt();
 * const { listings } = await graunt.listings.search({ q: "holidays", freeOnly: true });
 * ```
 */
export class Graunt {
  readonly listings: ListingsResource;
  readonly meta: MetaResource;
  readonly library: LibraryResource;
  readonly #t: Transport;

  constructor(options: GrauntOptions = {}) {
    this.#t = new Transport(options);
    this.listings = new ListingsResource(this.#t);
    this.meta = new MetaResource(this.#t);
    this.library = new LibraryResource(this.#t);
  }

  /** GET any public endpoint and return its parsed JSON body unchanged. */
  get(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
    return this.#t.json(path, { query });
  }
}

function searchQuery(params: ListingSearchParams): Record<string, QueryValue> {
  const query: Record<string, QueryValue> = { ...(params.extra ?? {}) };
  const typed: Record<string, QueryValue> = {
    q: params.q,
    category: params.category,
    asset_class: params.assetClass,
    file_format: params.fileFormat,
    data_purpose: params.dataPurpose,
    min_price: params.minPriceCents,
    max_price: params.maxPriceCents,
    free_only: params.freeOnly,
    packet_only: params.packetOnly,
    tag: params.tag,
    industry_tag: params.industryTag,
    sort: params.sort,
    page: params.page,
    limit: params.limit,
  };
  for (const [key, value] of Object.entries(typed)) {
    if (value !== undefined) query[key] = value;
  }
  return query;
}

function segment(value: string, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
  return encodeURIComponent(value);
}

async function toGrauntError(response: Response): Promise<GrauntError> {
  let code = `HTTP_${response.status}`;
  let message = response.statusText || `HTTP ${response.status}`;
  let details: Record<string, unknown> | undefined;
  const text = await response.text().catch(() => "");
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && isRecord(body.error)) {
      if (typeof body.error.code === "string") code = body.error.code;
      if (typeof body.error.message === "string") message = body.error.message;
      if (isRecord(body.error.details)) details = body.error.details;
    }
  } catch {
    // A body that is not JSON (a proxy's HTML page, say) keeps the HTTP_<status> code.
  }
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfter !== null && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter.trim()) : undefined;
  return new GrauntError({ status: response.status, code, message, details, retryAfterSeconds });
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "timed out";
    return err.message;
  }
  return String(err);
}
