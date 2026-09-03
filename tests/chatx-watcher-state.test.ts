import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_MS,
  MIN_STABLE_MS,
  RunState,
  acknowledgeRun,
  canEnterFinishCandidate,
  confirmDone,
  createEmptyWatcherState,
  markFinishCandidate,
  recordActivity,
  reduceIgnoredUiEvent,
  startRun,
} from "../extensions/chatx-watcher/src/state.js";

const baseMetadata = {
  conversationId: "conversation-a",
  tabId: 7,
  windowId: 2,
  url: "https://chatgpt.com/c/conversation-a",
  title: "Watcher test",
};

function doneSignals(extra = {}) {
  return {
    sawAssistantMutation: true,
    stableForMs: MIN_STABLE_MS,
    generationActive: false,
    generationBusy: false,
    composerIdle: true,
    ...extra,
  };
}

function completeRun(state, runId, startedAt = 1000) {
  const candidateAt = startedAt + MIN_STABLE_MS;
  const candidate = markFinishCandidate(
    state,
    runId,
    {
      ...baseMetadata,
      lastMutationAt: startedAt,
      signals: doneSignals(),
    },
    candidateAt
  );
  expect(candidate.accepted).toBe(true);

  return confirmDone(
    state,
    runId,
    {
      ...baseMetadata,
      lastMutationAt: startedAt,
      signals: doneSignals({ stableForMs: MIN_STABLE_MS + CONFIRMATION_MS }),
    },
    candidateAt + CONFIRMATION_MS
  );
}

describe("ChatX Watcher run state machine", () => {
  it("CASE 1: RUNNING -> stable -> DONE notifies exactly once", () => {
    const state = createEmptyWatcherState();
    const started = startRun(state, baseMetadata, 1000, "run-1");
    expect(started.run.state).toBe(RunState.RUNNING);

    const first = completeRun(state, "run-1");
    expect(first.completed).toBe(true);
    expect(first.shouldNotify).toBe(true);
    expect(first.run?.state).toBe(RunState.DONE);

    const second = confirmDone(
      state,
      "run-1",
      { ...baseMetadata, signals: doneSignals({ stableForMs: 9000 }) },
      9000
    );
    expect(second.completed).toBe(false);
    expect(second.shouldNotify).toBe(false);
  });

  it("CASE 2: DOM rerender after DONE cannot create a duplicate completion", () => {
    const state = createEmptyWatcherState();
    startRun(state, baseMetadata, 1000, "run-1");
    completeRun(state, "run-1");

    const afterRerender = recordActivity(state, "run-1", baseMetadata, 9000);
    expect(afterRerender?.state).toBe(RunState.DONE);

    const candidate = markFinishCandidate(
      state,
      "run-1",
      { ...baseMetadata, signals: doneSignals({ stableForMs: 10000 }) },
      10000
    );
    expect(candidate.accepted).toBe(false);
  });

  it("CASE 3: sidebar blue-dot/spinner events are ignored", () => {
    const state = createEmptyWatcherState();
    startRun(state, baseMetadata, 1000, "run-1");
    completeRun(state, "run-1");

    const same = reduceIgnoredUiEvent(state);
    expect(same).toBe(state);
    expect(same.runs[0].state).toBe(RunState.DONE);
    expect(same.runs).toHaveLength(1);
  });

  it("CASE 4: ACKNOWLEDGED stays acknowledged across tab switches", () => {
    const state = createEmptyWatcherState();
    startRun(state, baseMetadata, 1000, "run-1");
    completeRun(state, "run-1");

    const ack = acknowledgeRun(state, "conversation-a", 8000);
    expect(ack.acknowledged).toBe(true);
    expect(ack.run?.state).toBe(RunState.ACKNOWLEDGED);

    reduceIgnoredUiEvent(state);
    expect(state.runs[0].state).toBe(RunState.ACKNOWLEDGED);
    expect(acknowledgeRun(state, "conversation-a", 9000).acknowledged).toBe(false);
  });

  it("CASE 5: a genuine new generation creates a new run and can notify", () => {
    const state = createEmptyWatcherState();
    startRun(state, baseMetadata, 1000, "run-1");
    completeRun(state, "run-1");
    acknowledgeRun(state, "conversation-a", 8000);

    const next = startRun(state, baseMetadata, 9000, "run-2");
    expect(next.started).toBe(true);
    expect(next.run.runId).toBe("run-2");

    const completed = completeRun(state, "run-2", 9000);
    expect(completed.shouldNotify).toBe(true);
    expect(state.runs).toHaveLength(2);
  });

  it("CASE 6: a short streaming pause cannot enter FINISH_CANDIDATE", () => {
    expect(
      canEnterFinishCandidate(doneSignals({ stableForMs: MIN_STABLE_MS - 1 }))
    ).toBe(false);
    expect(
      canEnterFinishCandidate(doneSignals({ generationActive: true, stableForMs: 10000 }))
    ).toBe(false);
  });

  it("CASE 7: tool execution / busy state cannot finish during quiet text periods", () => {
    expect(
      canEnterFinishCandidate(
        doneSignals({ generationBusy: true, stableForMs: MIN_STABLE_MS + 5000 })
      )
    ).toBe(false);
    expect(
      canEnterFinishCandidate(
        doneSignals({ composerIdle: false, stableForMs: MIN_STABLE_MS + 5000 })
      )
    ).toBe(false);
  });

  it("CASE 8: refresh during RUNNING restores the existing run identity", () => {
    const state = createEmptyWatcherState();
    const first = startRun(state, baseMetadata, 1000, "run-1");
    const restored = startRun(
      state,
      { ...baseMetadata, tabId: 11, title: "After refresh" },
      2000,
      "run-should-not-be-used"
    );

    expect(first.started).toBe(true);
    expect(restored.started).toBe(false);
    expect(restored.run.runId).toBe("run-1");
    expect(restored.run.tabId).toBe(11);
    expect(state.runs).toHaveLength(1);
  });
});
