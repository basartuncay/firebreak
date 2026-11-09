/** Counts write/destructive calls that were actually forwarded, for rule F5. */
export class BudgetCounter {
  private times: number[] = [];
  private total = 0;

  constructor(private readonly now: () => number = Date.now) {}

  recordWrite(): void {
    this.total += 1;
    this.times.push(this.now());
  }

  sessionCount(): number {
    return this.total;
  }

  lastMinuteCount(): number {
    const cutoff = this.now() - 60_000;
    this.times = this.times.filter((t) => t > cutoff);
    return this.times.length;
  }
}
