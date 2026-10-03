import { Plugin } from "./node_modules/@opencode/plugin/dist/promise/index.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decide, emptyState, resolveThresholds, type GateState } from "./gates.js";

const REL_STATE = ".opencode/hooks/state/continual-learning.json";

function projectDir(ctx: { location: { directory: string; project: { directory: string } } }): string {
  return ctx.location.project.directory ?? ctx.location.directory;
}

function loadState(path: string): { state: GateState; trialStartedAtMs: number | null } {
  const fallback: GateState = emptyState();
  if (!existsSync(path)) return { state: fallback, trialStartedAtMs: null };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<GateState> & {
      trialStartedAtMs?: number | null;
    };
    if (raw.version !== 1) return { state: fallback, trialStartedAtMs: null };
    return {
      state: {
        version: 1,
        lastRunAtMs: typeof raw.lastRunAtMs === "number" ? raw.lastRunAtMs : 0,
        turnsSinceLastRun: typeof raw.turnsSinceLastRun === "number" ? raw.turnsSinceLastRun : 0,
        lastMessageCount: typeof raw.lastMessageCount === "number" ? raw.lastMessageCount : null,
        lastTriggerKey: typeof raw.lastTriggerKey === "string" ? raw.lastTriggerKey : null,
      },
      trialStartedAtMs: typeof raw.trialStartedAtMs === "number" ? raw.trialStartedAtMs : null,
    };
  } catch {
    return { state: fallback, trialStartedAtMs: null };
  }
}

function saveState(path: string, state: GateState, trialStartedAtMs: number | null): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...state, trialStartedAtMs }, null, 2)}\n`, "utf-8");
}

export default Plugin.define({
  id: "continual-learning-autotrigger",
  async setup(ctx) {
    await ctx.session.hook("http.response", async (event) => {
      // Counted turn: one completed primary model response. Upstream Cursor
      // counts loop iterations; here each primary response counts one unit.
      // Frequency stays bounded by the minutes gate either way.
      if (event.kind !== "primary") return;
      try {
        const dir = projectDir(ctx as never);
        const path = join(dir, REL_STATE);
        const { state, trialStartedAtMs } = loadState(path);
        const now = Date.now();
        const trialRaw =
          process.env.CONTINUAL_LEARNING_TRIAL_MODE ??
          process.env.CONTINUOUS_LEARNING_TRIAL_MODE;
        const trialOn =
          trialRaw !== undefined &&
          ["1", "true", "yes", "on"].includes(trialRaw.trim().toLowerCase());
        let trialStart = trialStartedAtMs;
        if (trialOn && trialStart === null) trialStart = now;
        const { t } = resolveThresholds(process.env as Record<string, string | undefined>, now, trialStart);

        // Cheap gates first; only read session context when they pass.
        const turns = state.turnsSinceLastRun + 1;
        const minutesSince =
          state.lastRunAtMs > 0 ? Math.floor((now - state.lastRunAtMs) / 60000) : Number.POSITIVE_INFINITY;
        if (turns < t.minTurns || minutesSince < t.minMinutes) {
          saveState(path, { ...state, turnsSinceLastRun: turns }, trialStart);
          return;
        }
        const messages = await ctx.session.context({ sessionID: event.sessionID });
        const key = `${event.sessionID}:${messages.length}`;
        const { fire, next } = decide(
          state,
          { countedTurn: true, messageCount: messages.length, now, triggerKey: key },
          t,
        );
        saveState(path, next, trialStart);
        if (!fire) return;
        await ctx.session.prompt({
          sessionID: event.sessionID,
          text: `Run the \`continual-learning\` skill now for this project (${dir}). Use the \`agents-memory-updater\` subagent for the full memory update flow against this project's AGENTS.md. If no meaningful updates exist, respond exactly: No high-signal memory updates.`,
        });
      } catch {
        // Never break the agent loop.
      }
    });
  },
});
