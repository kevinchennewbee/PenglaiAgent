import { PenglaiError } from "./errors.js";

/** Read a live official Session log. Missing replay capability is a contract failure. */
export function snapshotOfficialSession<Event>(
  session: { snapshotEvents?: () => readonly Event[] } | undefined,
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
