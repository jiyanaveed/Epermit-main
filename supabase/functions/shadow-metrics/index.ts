import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const jsonResponse = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse({ code: 500, message: "Missing Supabase config" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ code: 401, message: "Missing or invalid Authorization" }, 401);
    }
    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ code: 401, message: "Invalid JWT" }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ code: 401, message: "Invalid JWT" }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const projectId = (body.project_id ?? body.projectId) as string | undefined;

    let predictionsQuery = supabase
      .from("shadow_predictions")
      .select("id, agent_name, match_status, confidence_score, project_id, created_at");
    if (projectId) predictionsQuery = predictionsQuery.eq("project_id", projectId);

    const { data: predictions, error: predErr } = await predictionsQuery;
    if (predErr) {
      console.error("shadow-metrics: predictions fetch error", predErr);
      return jsonResponse({ code: 500, message: predErr.message }, 500);
    }

    const allPredictions = predictions ?? [];

    const totalPredictions = allPredictions.length;
    const matchCount = allPredictions.filter((p) => p.match_status === "match").length;
    const partialCount = allPredictions.filter((p) => p.match_status === "partial").length;
    const mismatchCount = allPredictions.filter((p) => p.match_status === "mismatch").length;
    const pendingCount = allPredictions.filter((p) => p.match_status === "pending").length;

    const overallAccuracy = totalPredictions > 0
      ? Math.round(((matchCount + partialCount * 0.5) / totalPredictions) * 1000) / 10
      : 0;

    const avgConfidence = totalPredictions > 0
      ? Math.round(
          (allPredictions.reduce((sum, p) => sum + (Number(p.confidence_score) || 0), 0) / totalPredictions) * 1000
        ) / 1000
      : 0;

    const agentMap = new Map<string, { predictions: number; matches: number; partials: number; mismatches: number; pending: number; totalConfidence: number }>();
    for (const p of allPredictions) {
      const name = p.agent_name ?? "Unknown";
      const entry = agentMap.get(name) ?? { predictions: 0, matches: 0, partials: 0, mismatches: 0, pending: 0, totalConfidence: 0 };
      entry.predictions++;
      if (p.match_status === "match") entry.matches++;
      else if (p.match_status === "partial") entry.partials++;
      else if (p.match_status === "mismatch") entry.mismatches++;
      else entry.pending++;
      entry.totalConfidence += Number(p.confidence_score) || 0;
      agentMap.set(name, entry);
    }

    const agentPerformance = Array.from(agentMap.entries()).map(([agent_name, stats]) => ({
      agent_name,
      predictions: stats.predictions,
      matches: stats.matches,
      partials: stats.partials,
      mismatches: stats.mismatches,
      pending: stats.pending,
      accuracy: stats.predictions > 0
        ? Math.round(((stats.matches + stats.partials * 0.5) / stats.predictions) * 1000) / 10
        : 0,
      avg_confidence: stats.predictions > 0
        ? Math.round((stats.totalConfidence / stats.predictions) * 1000) / 1000
        : 0,
    }));

    let baselineQuery = supabase
      .from("baseline_actions")
      .select("id, duration_minutes, action_type, expeditor_id");
    if (projectId) baselineQuery = baselineQuery.eq("project_id", projectId);

    const { data: baselineRows, error: baseErr } = await baselineQuery;
    if (baseErr) {
      console.error("shadow-metrics: baseline fetch error", baseErr);
    }

    const allBaseline = baselineRows ?? [];
    const totalBaselineActions = allBaseline.length;
    const totalDuration = allBaseline.reduce((sum, b) => sum + (Number(b.duration_minutes) || 0), 0);
    const avgTimePerComment = totalBaselineActions > 0
      ? Math.round((totalDuration / totalBaselineActions) * 100) / 100
      : 0;
    const uniqueExpeditors = new Set(allBaseline.map((b) => b.expeditor_id)).size;

    let auditQuery = supabase
      .from("audit_trail")
      .select("id, action_type, routing_decision, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (projectId) auditQuery = auditQuery.eq("project_id", projectId);

    const { data: recentAudit } = await auditQuery;

    return jsonResponse({
      overall: {
        total_predictions: totalPredictions,
        matches: matchCount,
        partials: partialCount,
        mismatches: mismatchCount,
        pending: pendingCount,
        accuracy_percent: overallAccuracy,
        avg_confidence: avgConfidence,
      },
      agent_performance: agentPerformance,
      baseline: {
        total_actions: totalBaselineActions,
        avg_time_per_comment_minutes: avgTimePerComment,
        total_duration_minutes: Math.round(totalDuration * 100) / 100,
        unique_expeditors: uniqueExpeditors,
      },
      recent_audit: recentAudit ?? [],
    });
  } catch (error) {
    console.error("shadow-metrics error:", error);
    return jsonResponse(
      { code: 500, message: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});
