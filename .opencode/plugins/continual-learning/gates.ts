export interface GateState {
  version: 1;
  lastRunAtMs: number;
  turnsSinceLastRun: number;
  lastMessageCount: number | null;
  lastTriggerKey: string | null;
}

export interface GateThresholds {
  minTurns: number;
  minMinutes: number;
}

export interface GateInput {
  countedTurn: boolean;
  messageCount: number | null;
  now: number;
  triggerKey: string | null;
}

export function emptyState(): GateState {
  return {
    version: 1,
    lastRunAtMs: 0,
    turnsSinceLastRun: 0,
    lastMessageCount: null,
    lastTriggerKey: null,
  };
}

export function decide(
  state: GateState,
  input: GateInput,
  t: GateThresholds,
): { fire: boolean; next: GateState } {
  if (input.triggerKey !== null && input.triggerKey === state.lastTriggerKey) {
    return { fire: false, next: state };
  }
  const turns = state.turnsSinceLastRun + (input.countedTurn ? 1 : 0);
  const minutesSince =
    state.lastRunAtMs > 0 ? Math.floor((input.now - state.lastRunAtMs) / 60000) : Number.POSITIVE_INFINITY;
  const advanced =
    input.messageCount !== null &&
    (state.lastMessageCount === null || input.messageCount > state.lastMessageCount);
  const next: GateState = {
    ...state,
    turnsSinceLastRun: turns,
    lastMessageCount: input.messageCount ?? state.lastMessageCount,
    lastTriggerKey: input.triggerKey,
  };
  const fire =
    input.countedTurn && turns >= t.minTurns && minutesSince >= t.minMinutes && advanced;
  if (fire) {
    next.lastRunAtMs = input.now;
    next.turnsSinceLastRun = 0;
  }
  return { fire, next };
}

export function resolveThresholds(env: Record<string, string | undefined>, now: number, trialStartedAtMs: number | null): { t: GateThresholds; trialActive: boolean } {
  const num = (v: string | undefined, fb: number) => {
    const p = v === undefined ? NaN : Number.parseInt(v, 10);
    return Number.isFinite(p) && (p as number) > 0 ? (p as number) : fb;
  };
  const get = (k: string, legacy: string) => env[k] ?? env[legacy];
  const on = (v: string | undefined) =>
    v !== undefined && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
  const trialEnabled = on(get("CONTINUAL_LEARNING_TRIAL_MODE", "CONTINUOUS_LEARNING_TRIAL_MODE"));
  const trialMinutes = num(get("CONTINUAL_LEARNING_TRIAL_DURATION_MINUTES", "CONTINUOUS_LEARNING_TRIAL_DURATION_MINUTES"), 24 * 60);
  const inTrial =
    trialEnabled && trialStartedAtMs !== null && now - trialStartedAtMs < trialMinutes * 60000;
  if (inTrial) {
    return {
      trialActive: true,
      t: {
        minTurns: num(get("CONTINUAL_LEARNING_TRIAL_MIN_TURNS", "CONTINUOUS_LEARNING_TRIAL_MIN_TURNS"), 3),
        minMinutes: num(get("CONTINUAL_LEARNING_TRIAL_MIN_MINUTES", "CONTINUOUS_LEARNING_TRIAL_MIN_MINUTES"), 15),
      },
    };
  }
  return {
    trialActive: false,
    t: {
      minTurns: num(get("CONTINUAL_LEARNING_MIN_TURNS", "CONTINUOUS_LEARNING_MIN_TURNS"), 10),
      minMinutes: num(get("CONTINUAL_LEARNING_MIN_MINUTES", "CONTINUOUS_LEARNING_MIN_MINUTES"), 120),
    },
  };
}
