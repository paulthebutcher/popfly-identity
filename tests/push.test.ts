import { describe, expect, it, vi } from "vitest";
import { prune } from "../lib/maintenance";

describe("retention maintenance", () => {
  it("submits rollup and both deletes in one transactional D1 batch", async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => {
      const statement = { sql };
      statements.push(statement);
      return {
        bind: (...values: unknown[]) => Object.assign(statement, { values }),
      };
    });
    const batch = vi.fn().mockResolvedValue([
      { meta: { changes: 2 } },
      { meta: { changes: 80 } },
      { meta: { changes: 12 } },
    ]);
    const db = { prepare, batch } as unknown as D1Database;

    await expect(prune(db, 300, 900)).resolves.toEqual({
      pageviews_pruned: 80,
      touches_pruned: 12,
    });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledWith(statements);
    expect(statements).toHaveLength(3);
    expect(statements[0].sql).toContain("INSERT INTO pageview_rollups");
    expect(statements[1].sql).toContain("DELETE FROM pageviews");
    expect(statements[2].sql).toContain("DELETE FROM touches");
  });
});
