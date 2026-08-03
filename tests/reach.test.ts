import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../lib/db";
import { deliverToReach, forwardToReach, replayDeadLetters } from "../lib/reach";

const env = {
  REACH_WEBHOOK_URL: "https://reach.example/events",
  REACH_WEBHOOK_KEY: "secret",
} as Env;

afterEach(() => vi.restoreAllMocks());

describe("Reach delivery", () => {
  it("does not retry a permanent 4xx response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 422 }));
    await expect(deliverToReach(env, { email: "lead@example.com" })).resolves.toEqual({
      ok: false,
      error: "HTTP 422",
      attempts: 1,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("dead-letters a terminal failure with the real attempt count", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn().mockReturnValue({ run });
    const db = { prepare: vi.fn().mockReturnValue({ bind }) } as unknown as D1Database;

    await expect(forwardToReach(env, db, { email: "lead@example.com" }, "evt-1")).resolves.toBe(false);
    expect(bind).toHaveBeenCalledWith(
      "evt-1",
      JSON.stringify({ email: "lead@example.com" }),
      "HTTP 400",
      1
    );
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("dead-letter replay", () => {
  it("marks a successfully replayed lead and does not create a duplicate dead letter", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const updateRun = vi.fn().mockResolvedValue({ success: true });
    const updateBind = vi.fn().mockReturnValue({ run: updateRun });
    const selectAll = vi.fn().mockResolvedValue({
      results: [{ id: 7, payload: JSON.stringify({ email: "replay@example.com" }) }],
    });
    const selectBind = vi.fn().mockReturnValue({ all: selectAll });
    const prepare = vi.fn((sql: string) =>
      sql.startsWith("SELECT") ? { bind: selectBind } : { bind: updateBind }
    );
    const db = { prepare } as unknown as D1Database;

    await expect(replayDeadLetters(env, db)).resolves.toEqual({ pending: 1, replayed: 1 });
    expect(updateBind).toHaveBeenCalledWith(1, 7);
    expect(prepare.mock.calls.some(([sql]) => String(sql).startsWith("INSERT"))).toBe(false);
  });
});
