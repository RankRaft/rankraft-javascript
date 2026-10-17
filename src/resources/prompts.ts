import type { RankRaft } from "../client.js";
import type { PagePromise } from "../core/pagination.js";
import type {
  CreatePromptsParams,
  CreatePromptsResult,
  ListPromptsParams,
  Prompt,
  SetPromptStatusParams,
  SetPromptStatusResult,
  UpdatePromptsParams,
  UpdatePromptsResult,
} from "../types.js";

/**
 * Prompts are the only thing this API can write, and it cannot delete them.
 *
 * Deleting a prompt cascades away its answer history and any Action Center
 * baseline that targeted it, so the API offers `setStatus(..., "disabled")`
 * instead. Prompt text is immutable for the same reason: changing it would
 * make the history before and after incomparable while looking like one
 * continuous series.
 *
 * The write endpoints answer `{ dry_run, created, …, data }` rather than the
 * usual `{ info, data }`, and the fields beside `data` are the point - so
 * these methods return the whole body, not the unwrapped `data`.
 */
export class PromptsResource {
  readonly #client: RankRaft;
  constructor(client: RankRaft) {
    this.#client = client;
  }

  /** Oldest first. Awaitable for the first page, async-iterable for every prompt. */
  list(params: ListPromptsParams & { signal?: AbortSignal }): PagePromise<Prompt> {
    const { site_id, signal, ...query } = params;
    return this.#client.paginateQuery<Prompt>("listPrompts", { site_id }, query as Record<string, string | number | undefined>, signal);
  }

  /**
   * Up to 100 per call. Text that already exists (ignoring case and spacing)
   * comes back as the existing prompt rather than a duplicate, which is also
   * why this call is safe to retry. A request that would exceed the plan's
   * active-prompt cap is refused whole with `PromptLimitError`.
   */
  async create(params: CreatePromptsParams & { signal?: AbortSignal }): Promise<CreatePromptsResult> {
    const { site_id, signal, ...body } = params;
    const res = await this.#client.call<unknown>("createPrompts", {
      pathParams: { site_id },
      bodyText: JSON.stringify({ dry_run: false, ...body }),
      ...(signal ? { signal } : {}),
    });
    return res.body as CreatePromptsResult;
  }

  /** Category and market only. Text is immutable. */
  async update(params: UpdatePromptsParams & { signal?: AbortSignal }): Promise<UpdatePromptsResult> {
    const { site_id, signal, ...body } = params;
    const res = await this.#client.call<unknown>("updatePrompts", {
      pathParams: { site_id },
      bodyText: JSON.stringify({ dry_run: false, ...body }),
      ...(signal ? { signal } : {}),
    });
    return res.body as UpdatePromptsResult;
  }

  /**
   * Disabled prompts stop being asked but keep their history. Activating past
   * the plan's cap raises `PromptLimitError` with how many slots remain; this
   * client does not keep its own copy of that cap.
   */
  async setStatus(params: SetPromptStatusParams & { signal?: AbortSignal }): Promise<SetPromptStatusResult> {
    const { site_id, signal, ...body } = params;
    const res = await this.#client.call<unknown>("setPromptStatus", {
      pathParams: { site_id },
      bodyText: JSON.stringify({ dry_run: false, ...body }),
      ...(signal ? { signal } : {}),
    });
    return res.body as SetPromptStatusResult;
  }
}
