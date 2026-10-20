/*
 * Response shapes, from Graunt's OpenAPI document (https://api.graunt.com/openapi.json)
 * and the access-pass handlers. Fields the API marks required are required here;
 * everything else is optional, and each object keeps an index signature so a
 * field the API adds later is still readable.
 */

export type AssetClass = "DATASET" | "TEXT_ASSET" | "PACKET_BUNDLE";

export type AcquisitionMode =
  | "PAID_ENTITLED"
  | "AUTHENTICATED_FREE_ENTITLED"
  | "PUBLIC_TOKEN_GRANT_FREE";

export type ListingSort = "relevance" | "price_asc" | "price_desc" | "newest";

/** One listing as search returns it (`ListingSummary` in the OpenAPI document). */
export interface ListingSummary {
  id: string;
  dataset_name: string;
  category: string;
  /** Integer cents. 0 for a free listing. */
  price_cents: number;
  tags: string[];
  asset_class?: AssetClass;
  file_format?: string;
  currency?: "usd";
  is_free?: boolean;
  acquisition_mode?: AcquisitionMode;
  payment_required?: boolean;
  registration_required?: boolean;
  bundle_asset_count?: number | null;
  bundle_total_bytes?: number | null;
  created_at?: string;
  [field: string]: unknown;
}

/** A listing's full public detail, from `GET /v1/listings/{id}`. */
export interface ListingDetail extends ListingSummary {
  dataset_description?: string;
  dataset_row_count?: number | null;
  intended_uses?: string[];
  delivery_kind?: "SINGLE_FILE" | "PACKET_BUNDLE";
  content_excerpt?: {
    text?: string;
    is_truncated?: boolean;
    license_family?: string | null;
    [field: string]: unknown;
  };
  public_free_access?: {
    enabled?: boolean;
    grant_endpoint?: string;
    download_endpoint?: string;
    grant_ttl_seconds?: number;
    [field: string]: unknown;
  } | null;
  commercial_terms?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  rights_passport?: Record<string, unknown>;
  packet_bundle?: Record<string, unknown> | null;
  related_listings?: unknown[];
  /** When the seller last moved this listing to a newer revision (ISO 8601), or null. Holders get the update free. */
  revision_updated_at?: string | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}

export interface ListingSearchResult {
  listings: ListingSummary[];
  pagination: Pagination;
}

/** Filters for `listings.search`. Every field is optional. */
export interface ListingSearchParams {
  /** Free-text search over name, description and tags. */
  q?: string;
  category?: string;
  assetClass?: AssetClass;
  fileFormat?: string;
  dataPurpose?: string;
  /** Lowest price to include, in integer cents. */
  minPriceCents?: number;
  /** Highest price to include, in integer cents. */
  maxPriceCents?: number;
  freeOnly?: boolean;
  packetOnly?: boolean;
  tag?: string;
  industryTag?: string;
  sort?: ListingSort;
  /** 1-based page number. */
  page?: number;
  /** Results per page, 1 to 100. The API defaults to 20. */
  limit?: number;
  /** Any other query parameter the search endpoint accepts, passed as written. */
  extra?: Record<string, string | number | boolean>;
}

/** A packet manifest exactly as Graunt serves it. */
export interface PacketManifest {
  /** The parsed manifest. */
  manifest: Record<string, unknown>;
  /** The canonical JSON text, byte-for-byte as served. */
  canonicalJson: string;
  /** Lowercase hex SHA-256 of the canonical bytes, computed by this client. */
  sha256: string;
  /** The `X-Graunt-*` headers that accompany a signed manifest, lowercased. */
  signatureHeaders: Record<string, string>;
}

/** One item an access pass can read (an entry of the library manifest). */
export interface LibraryEntitlement {
  id: string;
  listing_id: string;
  listing_title: string;
  content_kind: string;
  packet_kind: string | null;
  packet_family: string | null;
  delivery_kind: "SINGLE_FILE" | "PACKET_BUNDLE";
  created_at: string;
  rights_summary: {
    license_family: string | null;
    citation_required: boolean | null;
    no_train: boolean | null;
    no_redistribute: boolean | null;
  };
  provenance_summary: { publisher_role: string | null; language: string | null } | null;
  packet_bundle: {
    revision_id: string;
    revision_number: number;
    manifest_sha256: string;
    asset_count: number;
  } | null;
  supported_access_modes: Array<"download" | "manifest_view">;
  access_pass_resource_url: string;
  [field: string]: unknown;
}

/** The access pass's view of its library, from `GET /v1/access-passes/manifest`. */
export interface LibraryManifest {
  pass: {
    pass_id: string;
    scope_kind: string;
    scope_label: string;
    status: "ACTIVE" | "REVOKED" | "EXPIRED";
    read_only: true;
    created_at: string;
    expires_at: string | null;
    display_prefix: string;
    [field: string]: unknown;
  };
  active_entitlements: LibraryEntitlement[];
  active_subscriptions: Array<{
    id: string;
    plan_id: string;
    status: "ACTIVE" | "TRIALING" | "PAST_DUE";
    current_period_end: string | null;
  }>;
  notice: string;
  [field: string]: unknown;
}
