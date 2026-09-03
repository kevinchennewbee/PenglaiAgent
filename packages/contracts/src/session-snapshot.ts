import { PenglaiError } from "./errors.js";

/** The read-only log boundary provided by the fixed official DSH Session. */
export interface OfficialSessionLog<Event = unknown> {
  snapshotEvents(): readonly Event[];
}

/** Missing replay capability is a contract failure, never an empty history. */
export function snapshotOfficialSession<Event>(
  session: Partial<OfficialSessionLog<Event>> | undefined,
): readonly Event[] {
  if (typeof session?.snapshotEvents !== "function") {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "official Session.snapshotEvents is unavailable");
  }
  const events = session.snapshotEvents();
  if (!Array.isArray(events)) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "official Session.snapshotEvents returned an invalid log");
  }
  return events;
}
