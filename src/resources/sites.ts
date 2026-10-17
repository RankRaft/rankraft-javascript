import type { RankRaft } from "../client.js";
import type { ActionItem, Competitor, ListActionsParams, Site } from "../types.js";

export class SitesResource {
  readonly #client: RankRaft;
  constructor(client: RankRaft) {
    this.#client = client;
  }

  /** Every site (project) in the organization the key belongs to. */
  async list(options: { signal?: AbortSignal } = {}): Promise<Site[]> {
    const res = await this.#client.call<Site[]>("listSites", { ...(options.signal ? { signal: options.signal } : {}) });
    return res.data;
  }

  /**
   * One site.
   *
   * A site id belonging to another organization returns 404, never 403 - the
   * API refuses to confirm that an id exists. `NotFoundError` therefore means
   * "no such site in this organization", not necessarily "no such site".
   */
  async get(params: { site_id: string; signal?: AbortSignal }): Promise<Site> {
    const res = await this.#client.call<Site>("getSite", {
      pathParams: { site_id: params.site_id },
      ...(params.signal ? { signal: params.signal } : {}),
    });
    return res.data;
  }

  /** Brands the site is compared against. Only `confirmed` ones count in leaderboards. */
  async competitors(params: { site_id: string; signal?: AbortSignal }): Promise<Competitor[]> {
    const res = await this.#client.call<Competitor[]>("listCompetitors", {
      pathParams: { site_id: params.site_id },
      ...(params.signal ? { signal: params.signal } : {}),
    });
    return res.data;
  }

  /** Stored Action Center cards. Read-only: this never regenerates them. */
  async actions(params: ListActionsParams & { signal?: AbortSignal }): Promise<ActionItem[]> {
    const res = await this.#client.call<ActionItem[]>("listActions", {
      pathParams: { site_id: params.site_id },
      ...(params.status ? { query: { status: params.status } } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    return res.data;
  }
}
