// GET /e/healthz — uptime check: proves the worker runs and D1 answers.
import { cloudflare } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { env } = cloudflare();
    await env.DB.prepare("SELECT 1").first();
    return Response.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 503 }
    );
  }
}
