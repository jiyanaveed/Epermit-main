import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const jsonResponse = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") {
      return jsonResponse({ code: 405, message: "Method not allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        { code: 500, message: "Missing Supabase config" },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => null);
    if (!body) {
      return jsonResponse(
        { code: 400, message: "Invalid or missing JSON body" },
        400,
      );
    }

    const projectId = body.projectId as string | undefined;
    const commentId = body.commentId as string | undefined;
    const expeditorId = body.expeditorId as string | undefined;
    const actionType = body.actionType as string | undefined;
    const humanValue = body.humanValue;
    const durationMinutes = body.durationMinutes as number | undefined;

    if (
      !projectId ||
      !commentId ||
      !expeditorId ||
      !actionType ||
      humanValue === undefined
    ) {
      return jsonResponse(
        {
          code: 400,
          message:
            "Missing required fields: projectId, commentId, expeditorId, actionType, humanValue",
        },
        400,
      );
    }

    const { error: baselineError } = await supabase
      .from("baseline_actions")
      .insert({
        project_id: projectId,
        comment_id: commentId,
        expeditor_id: expeditorId,
        action_type: actionType,
        duration_minutes: durationMinutes ?? 0,
      });

    if (baselineError) {
      console.error("shadow-evaluator: baseline insert error", baselineError);
      return jsonResponse(
        { code: 500, message: `Baseline insert failed: ${baselineError.message}` },
        500,
      );
    }

    const { data: pendingPredictions, error: fetchError } = await supabase
      .from("shadow_predictions")
      .select("id, prediction_data")
      .eq("comment_id", commentId)
      .eq("match_status", "pending");

    if (fetchError) {
      console.error(
        "shadow-evaluator: predictions fetch error",
        fetchError,
      );
      return jsonResponse(
        { code: 500, message: `Predictions fetch failed: ${fetchError.message}` },
        500,
      );
    }

    const evaluationResults: Array<{
      prediction_id: string;
      match_status: string;
    }> = [];

    for (const prediction of pendingPredictions ?? []) {
      const predictionValue = prediction.prediction_data;

      const normalise = (v: unknown): string => {
        if (v === null || v === undefined) return "";
        if (typeof v === "string") return v.trim().toLowerCase();
        return JSON.stringify(v);
      };

      const match_status =
        normalise(predictionValue) === normalise(humanValue)
          ? "match"
          : "mismatch";

      const { error: updateError } = await supabase
        .from("shadow_predictions")
        .update({ match_status })
        .eq("id", prediction.id);

      if (updateError) {
        console.error(
          `shadow-evaluator: update prediction ${prediction.id} error`,
          updateError,
        );
      }

      evaluationResults.push({
        prediction_id: prediction.id,
        match_status,
      });
    }

    const matchSummary =
      evaluationResults.length === 0
        ? "no_pending_predictions"
        : evaluationResults.every((r) => r.match_status === "match")
          ? "all_match"
          : evaluationResults.every((r) => r.match_status === "mismatch")
            ? "all_mismatch"
            : "mixed";

    const { error: auditError } = await supabase.from("audit_trail").insert({
      project_id: projectId,
      actor_id: expeditorId,
      action_type: "human_evaluation",
      routing_decision: matchSummary,
      input_hash: commentId,
    });

    if (auditError) {
      console.error("shadow-evaluator: audit insert error", auditError);
    }

    return jsonResponse({
      success: true,
      baseline_recorded: true,
      predictions_evaluated: evaluationResults.length,
      evaluation_results: evaluationResults,
      audit_logged: !auditError,
      match_summary: matchSummary,
    });
  } catch (error) {
    console.error("shadow-evaluator error:", error);
    return jsonResponse(
      {
        code: 500,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});
