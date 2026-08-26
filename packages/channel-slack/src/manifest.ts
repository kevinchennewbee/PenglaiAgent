/** Official Slack app scopes. Existing apps must re-authorize after this change. */

export const SLACK_BOT_SCOPES = [
  "chat:write",
  "im:history",
  "im:read",
  "im:write",
  "reactions:write",
] as const;

export function slackManifestRequiresReauth(granted: readonly string[]): boolean {
  return SLACK_BOT_SCOPES.some((scope) => !granted.includes(scope));
}
