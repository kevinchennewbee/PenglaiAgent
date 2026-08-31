function gate(value) {
  return value ? "PASS" : "FAIL";
}

export function credentialFreeInstalledChecks({ rec, first, identityOk }) {
  const walked = Array.isArray(first?.onboarding?.walked) ? first.onboarding.walked : [];
  const keyless = rec?.walk?.wizardKeyless ?? rec?.wizardKeyless ?? {};
  return {
    exactInstaller: gate(rec?.fromExactDmg === true),
    identity: gate(first?.identity?.ok === true || identityOk === true),
    proxyAuthenticationBoundary: gate(first?.nativeBoot?.authenticationBoundary === true),
    exactExecutableBoot: gate(first?.nativeBoot?.ok === true),
    ownedProcessTree: gate(first?.processTree?.ownedAbsolute === true && first.processTree?.dshPid > 0),
    requiredInventory: gate(first?.inventory?.ok === true),
    optionalImDefaultOff: gate(first?.inventory?.im === false),
    welcomePersisted: gate(first?.welcome?.clicked === true && first.welcome?.persisted === true),
    officialProviderCatalog: gate(Number(first?.onboarding?.providers?.rows ?? 0) > 0),
    keylessOnboarding: gate(
      walked.includes("privacy") &&
        walked.includes("models") &&
        walked.includes("keytest") &&
        keyless.ok === true &&
        keyless.honestStop === "keytest" &&
        keyless.skippedNonceTurn === true,
    ),
    resume: gate(first?.resume?.ok === true || rec?.resume?.ok === true || rec?.resume?.attempted === false),
  };
}

export function credentialFreeInstalledPass(input) {
  return Object.values(credentialFreeInstalledChecks(input)).every((value) => value === "PASS");
}
