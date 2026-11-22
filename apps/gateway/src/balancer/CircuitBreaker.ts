export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const WINDOW_SIZE = 20;
const ERROR_THRESHOLD_RATE = 0.5;
const CONSECUTIVE_FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 10_000;
const EWMA_ALPHA = 0.2;

export class CircuitBreaker {
  public state: BreakerState = 'CLOSED';
  public ewmaMs = 200;
  public inflight = 0;
  private window: boolean[] = []; // true = success
  private consecutiveFailures = 0;
  private openAt: number | null = null;
  private halfOpenProbeAllowed = false;

  constructor(public readonly name: string) {}

  get errorRate(): number {
    if (this.window.length === 0) return 0;
    const errors = this.window.filter((s) => !s).length;
    return errors / this.window.length;
  }

  canAttempt(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() - (this.openAt ?? 0) >= OPEN_DURATION_MS) {
        this.state = 'HALF_OPEN';
        this.halfOpenProbeAllowed = false;
        return true;
      }
      return false;
    }
    // HALF_OPEN: allow exactly one probe
    if (this.halfOpenProbeAllowed) {
      this.halfOpenProbeAllowed = false;
      return true;
    }
    return false;
  }

  recordSuccess(latencyMs: number): void {
    this.inflight = Math.max(0, this.inflight - 1);
    this.consecutiveFailures = 0;
    this.addToWindow(true);
    this.ewmaMs = EWMA_ALPHA * latencyMs + (1 - EWMA_ALPHA) * this.ewmaMs;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
    }
  }

  recordFailure(): void {
    this.inflight = Math.max(0, this.inflight - 1);
    this.consecutiveFailures++;
    this.addToWindow(false);
    if (
      this.state === 'HALF_OPEN' ||
      this.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD ||
      (this.window.length >= WINDOW_SIZE && this.errorRate > ERROR_THRESHOLD_RATE)
    ) {
      this.trip();
    }
  }

  incrementInflight(): void {
    this.inflight++;
  }

  decrementInflight(): void {
    this.inflight = Math.max(0, this.inflight - 1);
  }

  private trip(): void {
    this.state = 'OPEN';
    this.openAt = Date.now();
  }

  private addToWindow(success: boolean): void {
    this.window.push(success);
    if (this.window.length > WINDOW_SIZE) {
      this.window.shift();
    }
  }
}
