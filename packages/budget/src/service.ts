import { PenglaiError } from "@penglai/contracts";

export interface BudgetLimit {
  hardTokens: number | null;
  warnRatio?: number;
}

export interface TokenMeterFact {
  tokens: number;
  priceTrusted: boolean;
  currency?: string;
}

export class BudgetGate {
  used = 0;
  lastDay: string;
  constructor(
    private readonly limit: BudgetLimit,
    private readonly now: () => number,
    private readonly ledger?: { reserve: (limit: BudgetLimit, meter: TokenMeterFact, now: number, source?: string) => { warn: boolean; used: number }; usedOn: (day: string) => number },
  ) {
    this.lastDay = dayKey(now());
    if (this.ledger) this.used = this.ledger.usedOn(this.lastDay);
  }

  private syncDay(): void {
    const today = dayKey(this.now());
    if (today < this.lastDay) return;
    if (today > this.lastDay) {
      this.used = this.ledger ? this.ledger.usedOn(today) : 0;
      this.lastDay = today;
    }
  }

  inspect(meter: TokenMeterFact): { tokens: number; money?: never } {
    if (!meter.priceTrusted) return { tokens: meter.tokens };
    return { tokens: meter.tokens };
  }

  reserve(meter: TokenMeterFact, source = "token-meter"): { warn: boolean } {
    this.syncDay();
    if (this.ledger) {
      const result = this.ledger.reserve(this.limit, meter, this.now(), source);
      this.used = result.used;
      return { warn: result.warn };
    }
    const next = this.used + meter.tokens;
    if (this.limit.hardTokens !== null && next > this.limit.hardTokens) {
      throw new PenglaiError("SECURITY_POLICY", "budget hard block before model");
    }
    this.used = next;
    const warnAt = this.limit.hardTokens === null ? Number.POSITIVE_INFINITY : this.limit.hardTokens * (this.limit.warnRatio ?? 0.8);
    return { warn: this.used >= warnAt };
  }
}

export function dayKey(ts: number): string {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
