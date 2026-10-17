import type { RankRaft } from "../client.js";
import type { PlatformInfo } from "../types.js";

export class PlatformsResource {
  readonly #client: RankRaft;
  constructor(client: RankRaft) {
    this.#client = client;
  }

  /** Engine ids and their display labels. */
  async list(options: { signal?: AbortSignal } = {}): Promise<PlatformInfo[]> {
    const res = await this.#client.call<PlatformInfo[]>("listPlatforms", {
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return res.data;
  }
}
