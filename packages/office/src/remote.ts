import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import type { createOfficeService } from "./service.js";

export class PenglaiOfficeRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly impl: ReturnType<typeof createOfficeService>,
  ) {
    super(ctx, "penglaiOffice");
  }

  @Remote
  health() {
    return { name: this.impl.name, version: this.impl.version, healthy: true };
  }
}
