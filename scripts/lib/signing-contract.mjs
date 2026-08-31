const WINDOWS_UNSIGNED_STATUS = "NotSigned";

export const WINDOWS_AUTHENTICODE_COMMAND =
  "Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; [Console]::Out.Write((Get-AuthenticodeSignature -LiteralPath $env:PENGLAI_SIGNATURE_TARGET).Status.ToString())";

export function evaluateWindowsAuthenticode(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { verdict: "FAIL", reason: "no Windows Authenticode records" };
  }
  const malformed = records.find(
    (record) =>
      !record ||
      typeof record.path !== "string" ||
      typeof record.status !== "string",
  );
  if (malformed) {
    return { verdict: "FAIL", reason: "malformed Windows Authenticode record" };
  }
  const unexpected = records.find(
    (record) => record.status !== WINDOWS_UNSIGNED_STATUS,
  );
  if (unexpected) {
    return {
      verdict: "FAIL",
      reason: `unexpected Authenticode status ${unexpected.status} for ${unexpected.path}`,
    };
  }
  return { verdict: "PASS" };
}
