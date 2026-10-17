import type { FilterNode } from "./filters.js";

/**
 * Request and response shapes, written from the API's own zod schemas
 * (apps/api/src/routes/*) and kept honest by test/conformance.test.ts, which
 * compares the operation table against the published OpenAPI document.
 *
 * Enums are open (`| (string & {})`) so a platform or metric the API ships
 * tomorrow cannot throw inside a customer's pinned install - that drift is
 * meant to surface in our CI, not theirs.
 *
 * Report rows carry every metric optionally because the row shape is chosen
 * at call time by `group_by` and `metrics`. A static type cannot know which
 * columns a given call asked for.
 */

/** Inclusive, `YYYY-MM-DD`, UTC. A Date is converted using its UTC calendar day. */
export type DateInput = string | Date;

export type Platform = "chatgpt" | "ai_overviews" | "ai_mode" | "gemini" | "copilot" | "claude" | "perplexity" | (string & {});
export type PromptCategory = "Discovery" | "Comparison" | "Alternatives" | "How-to" | "Pricing" | "Brand" | (string & {});
export type ApiKeyPermission = "read" | "write";
export type SortDir = "asc" | "desc";

/** `field` must be one of the metrics (or, for traffic reports, group_by fields) the call asked for. */
export interface Sort {
  field: string;
  dir?: SortDir;
}

/** A prompt as it appears inside a report row. */
export interface PromptRef {
  id: string;
  text: string;
}

// ---- Discovery -------------------------------------------------------------

export interface Me {
  key: { id: string; name: string; permission: ApiKeyPermission; expires_at: string };
  organization: { id: string; name: string; plan: string };
  rate_limits: { requests_per_minute: number; writes_per_minute: number };
}

export interface Site {
  id: string;
  name: string;
  domain: string;
  created_at: string;
  /** Engines this site is scanned on. */
  platforms: Platform[];
  /** The most recent daily answer scan, or null before the first. */
  last_answer_scan: { date: string; status: string } | null;
}

export interface Competitor {
  id: string;
  name: string;
  domains: string[];
  /** Confirmed competitors count in leaderboards and share of voice. */
  confirmed: boolean;
  source: string;
}

export interface PlatformInfo {
  id: Platform;
  name: string;
  /** Whether RankRaft collects answers from it today. */
  available: boolean;
}

export type ActionStatus = "open" | "done" | "dismissed";

export interface ActionItem {
  id: string;
  title: string;
  /** The evidence, in counts. */
  why: string;
  /** What to do. */
  detail: string;
  category: string;
  impact: "High" | "Medium" | "Low";
  effort: string;
  target_metric: "mention" | "citation" | "coverage";
  kind: "one_off" | "ongoing";
  cadence: string | null;
  period: string | null;
  status: ActionStatus;
  target_prompts: PromptRef[];
  target_platforms: Platform[];
  target_url: string | null;
  created_at: string;
  outcome: { marked_done_at: string; result_due: string; verdict: string | null; summary: string | null } | null;
}

export interface ListActionsParams {
  site_id: string;
  /** Default `open`. `all` includes dismissed cards. */
  status?: "open" | "done" | "all";
}

// ---- Prompts ---------------------------------------------------------------

export interface Prompt {
  id: string;
  text: string;
  category: PromptCategory;
  /** Location appended when the question is asked. Null uses the site's market. */
  market: string | null;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
}

export interface ListPromptsParams {
  site_id: string;
  status?: "active" | "disabled";
  category?: PromptCategory;
  limit?: number;
  cursor?: string;
}

export interface NewPrompt {
  text: string;
  /** Defaults to `Discovery` on the server. */
  category?: PromptCategory;
  market?: string | null;
  /** Defaults to true. Active prompts count against the plan's cap. */
  active?: boolean;
}

export interface CreatePromptsParams {
  site_id: string;
  /** 1–100 per call. */
  prompts: NewPrompt[];
  dry_run?: boolean;
}

/** In a dry run, the would-be-created prompts have no `id` or timestamps yet. */
export interface CreatePromptsResult {
  dry_run: boolean;
  created: number;
  existing: number;
  data: (Prompt | Pick<Prompt, "text" | "category" | "market" | "status">)[];
}

export interface PromptPatch {
  id: string;
  category?: PromptCategory;
  market?: string | null;
}

export interface UpdatePromptsParams {
  site_id: string;
  prompts: PromptPatch[];
  dry_run?: boolean;
}

export interface UpdatePromptsResult {
  dry_run: boolean;
  not_found: string[];
  data: Prompt[];
}

export interface SetPromptStatusParams {
  site_id: string;
  /** 1–500 per call. */
  prompt_ids: string[];
  status: "active" | "disabled";
  dry_run?: boolean;
}

export interface SetPromptStatusResult {
  dry_run: boolean;
  changed: string[];
  unchanged: string[];
  not_found: string[];
}

// ---- Reports ---------------------------------------------------------------

export interface ReportInfo {
  site_id: string;
  start_date: string;
  end_date: string;
  count: number;
  total_results: number;
  next_cursor: string | null;
}

interface RangeParams {
  site_id: string;
  start_date: DateInput;
  end_date: DateInput;
  limit?: number;
  cursor?: string;
}

export type VisibilityMetric =
  | "visibility_score"
  | "mention_rate"
  | "citation_rate"
  | "prompt_coverage"
  | "average_position"
  | "share_of_voice"
  | "answers";
export type AnswerDimension = "date" | "platform" | "prompt" | "category";

export interface VisibilityParams extends RangeParams {
  group_by?: AnswerDimension[];
  metrics?: VisibilityMetric[];
  /** `owned` (default): your brand. `all`: you plus confirmed competitors, ranked. Or a list of brand names. */
  brands?: "owned" | "all" | string[];
  /** Fields: platform, prompt (id or text), category. */
  filter?: FilterNode;
  sort?: { field: VisibilityMetric; dir?: SortDir };
}

export interface VisibilityRow {
  date?: string;
  platform?: Platform;
  prompt?: PromptRef;
  category?: PromptCategory;
  brand: { name: string; owned: boolean };
  /** Position by Visibility Score among you and your confirmed competitors, within this row's group. */
  rank: number;
  /** 0–100: 45% mention rate, 35% citation rate, 20% prompt coverage. */
  visibility_score?: number;
  mention_rate?: number;
  citation_rate?: number;
  prompt_coverage?: number;
  /** Null when never named. */
  average_position?: number | null;
  share_of_voice?: number;
  answers?: number;
}

export type CitationMetric = "answers" | "citations" | "citation_share";

export interface CitationsParams extends RangeParams {
  /** Default `domain`. */
  entity?: "domain" | "page";
  group_by?: ("date" | "platform" | "prompt")[];
  metrics?: CitationMetric[];
  /** Fields: platform, prompt, category, domain, owner, source_kind. */
  filter?: FilterNode;
}

export type CitationOwner = "own" | "competitor" | "third_party";

export interface CitationRow {
  date?: string;
  platform?: Platform;
  prompt?: PromptRef;
  domain: string;
  page?: string;
  owner: CitationOwner;
  /** forum, video, review, roundup, editorial, marketplace, reference, social, publishing, recipe, brand or unknown. */
  source_kind: string;
  rank: number;
  /** Distinct answers citing it. */
  answers?: number;
  citations?: number;
  /** 0–1: its share of all citations in the same group. */
  citation_share?: number;
}

export interface SentimentParams extends RangeParams {
  group_by?: AnswerDimension[];
  filter?: FilterNode;
}

export interface SentimentRow {
  date?: string;
  platform?: Platform;
  prompt?: PromptRef;
  category?: PromptCategory;
  /** 0–1 of answers naming you. */
  positive: number;
  neutral: number;
  negative: number;
  answers_mentioning: number;
  answers: number;
}

export type AnswerField = "prompt" | "platform" | "date" | "text" | "brand_mentioned" | "brand_position" | "sentiment" | "mentions" | "citations";

export interface AnswersParams extends RangeParams {
  /** Up to 10. */
  platforms?: Platform[];
  /** Up to 100. */
  prompt_ids?: string[];
  /** Which fields to return. Default: all of them. */
  include?: AnswerField[];
}

export interface AnswerCitation {
  url: string;
  domain: string;
  title: string | null;
  position: number;
  own_site: boolean;
}

export interface AnswerRow {
  id: string;
  date?: string;
  platform?: Platform;
  prompt?: PromptRef;
  /** The answer exactly as the engine returned it. */
  text?: string;
  brand_mentioned?: boolean;
  brand_position?: number | null;
  sentiment?: string | null;
  /** Brands named, in order of first appearance. */
  mentions?: string[];
  citations?: AnswerCitation[];
}

// ---- Agent Analytics (traffic) -------------------------------------------

export interface TrafficInfo extends ReportInfo {
  timezone: string;
}

interface TrafficParamsBase extends RangeParams {
  /** IANA zone for `date`/`hour` buckets and the day boundaries. Default UTC. */
  timezone?: string;
  /** Fields: bot_name, bot_provider, bot_type, verified, path, page_type, referral_source. */
  filter?: FilterNode;
  /** `field` must be one of the requested group_by fields or metrics. */
  sort?: Sort;
}

export type BotDimension = "date" | "hour" | "bot_name" | "bot_provider" | "bot_type" | "path" | "page_type";
export type BotMetric = "hits" | "pages" | "verified_share" | "error_hits" | "last_visit";

export interface BotsParams extends TrafficParamsBase {
  /** Up to 3. */
  group_by?: BotDimension[];
  /** Default: hits, pages, verified_share. */
  metrics?: BotMetric[];
}

export interface BotRow {
  date?: string;
  /** `YYYY-MM-DDTHH:00` in the requested time zone. */
  hour?: string;
  bot_name?: string | null;
  bot_provider?: string | null;
  bot_type?: "ai_assistant" | "ai_training" | "index" | "ai_agent" | (string & {}) | null;
  path?: string;
  page_type?: string;
  hits?: number;
  /** Distinct paths requested. */
  pages?: number;
  /** 0–1: share of hits from IP ranges the provider publishes. */
  verified_share?: number;
  /** Hits answered with a 4xx or 5xx. */
  error_hits?: number;
  last_visit?: string;
}

export type ReferralDimension = "date" | "hour" | "referral_source" | "path" | "page_type";
export type ReferralMetric = "visits" | "landing_pages" | "last_visit";

export interface ReferralsParams extends TrafficParamsBase {
  /** Up to 3. */
  group_by?: ReferralDimension[];
  /** Default: visits, landing_pages. */
  metrics?: ReferralMetric[];
}

export interface ReferralRow {
  date?: string;
  hour?: string;
  referral_source?: string | null;
  path?: string;
  page_type?: string;
  visits?: number;
  landing_pages?: number;
  last_visit?: string;
}
