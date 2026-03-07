import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Professional {
  professional_name: string;
  license_type: string;
  license_number: string;
  role_on_project: string;
}

interface ValidationResult {
  professional_name: string;
  license_type: string;
  license_number: string;
  role_on_project: string;
  validation_status: "active" | "expired" | "not_found" | "pending";
  expiration_date: string | null;
  scope_of_license: string | null;
  error?: string;
}

const DLCP_BASE_URL = "https://verify.dcra.dc.gov";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function validateLicenseWithDLCP(
  professional: Professional
): Promise<ValidationResult> {
  const result: ValidationResult = {
    professional_name: professional.professional_name,
    license_type: professional.license_type,
    license_number: professional.license_number,
    role_on_project: professional.role_on_project,
    validation_status: "pending",
    expiration_date: null,
    scope_of_license: null,
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const searchUrl = `${DLCP_BASE_URL}/api/license/search?number=${encodeURIComponent(professional.license_number)}&type=${encodeURIComponent(professional.license_type)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      let response: Response;
      try {
        response = await fetch(searchUrl, {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.status === 404) {
        result.validation_status = "not_found";
        console.log(
          `[license-validation] License not found: ${professional.license_number} (${professional.license_type})`
        );
        return result;
      }

      if (!response.ok) {
        const statusText = response.statusText;
        console.warn(
          `[license-validation] DLCP returned ${response.status} ${statusText} for ${professional.license_number}, attempt ${attempt + 1}/${MAX_RETRIES}`
        );
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        result.validation_status = "not_found";
        result.error = `DLCP unavailable after ${MAX_RETRIES} attempts: ${response.status} ${statusText}`;
        return result;
      }

      let data: Record<string, unknown>;
      try {
        data = await response.json();
      } catch {
        console.warn(`[license-validation] Non-JSON response for ${professional.license_number}`);
        result.validation_status = "not_found";
        result.error = "DLCP returned non-JSON response";
        return result;
      }

      const status = (data.status as string || "").toLowerCase();
      const expirationDate = data.expiration_date as string | null;
      const scope = data.scope as string | null;

      result.scope_of_license = scope || null;
      result.expiration_date = expirationDate || null;

      if (status === "active" || status === "valid" || status === "current") {
        if (expirationDate) {
          const expDate = new Date(expirationDate);
          const now = new Date();
          if (expDate < now) {
            result.validation_status = "expired";
          } else {
            result.validation_status = "active";
          }
        } else {
          result.validation_status = "active";
        }
      } else if (status === "expired" || status === "inactive" || status === "lapsed") {
        result.validation_status = "expired";
      } else {
        result.validation_status = "not_found";
      }

      console.log(
        `[license-validation] ${professional.license_number} (${professional.license_type}): ${result.validation_status}`
      );
      return result;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      console.warn(
        `[license-validation] Error validating ${professional.license_number}, attempt ${attempt + 1}/${MAX_RETRIES}:`,
        isAbort ? "timeout" : err
      );
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      result.validation_status = "not_found";
      result.error = isAbort
        ? "DLCP request timed out"
        : err instanceof Error
          ? err.message
          : "Unknown error";
      return result;
    }
  }

  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[license-validation] start");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !anonKey) {
      return new Response(
        JSON.stringify({ code: 500, message: "SUPABASE_URL or SUPABASE_ANON_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ code: 401, message: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      console.warn("[license-validation] JWT validation failed:", userError?.message ?? "No user");
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const filingId = body.filing_id as string | undefined;
    const professionals = body.professionals as Professional[] | undefined;

    console.log("[license-validation] filing_id:", filingId ?? "(missing)", "user.id:", user.id);

    if (!filingId) {
      return new Response(
        JSON.stringify({ code: 400, message: "filing_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!professionals || !Array.isArray(professionals) || professionals.length === 0) {
      return new Response(
        JSON.stringify({ code: 400, message: "professionals array is required and must not be empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dbClient = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : userClient;

    const { data: filing, error: filingError } = await dbClient
      .from("permit_filings")
      .select("id, user_id, filing_status")
      .eq("id", filingId)
      .single();

    if (filingError || !filing) {
      return new Response(
        JSON.stringify({ code: 404, message: "Filing not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agentRunPayload = {
      filing_id: filingId,
      agent_name: "license_validation",
      layer: 1,
      status: "running",
      input_data: { professionals },
      started_at: new Date().toISOString(),
    };

    const { data: agentRun, error: agentRunError } = await dbClient
      .from("agent_runs")
      .insert(agentRunPayload)
      .select("id")
      .single();

    if (agentRunError) {
      console.error("[license-validation] Failed to create agent_run:", agentRunError.message);
    }

    const agentRunId = agentRun?.id;

    const validationResults: ValidationResult[] = [];
    let hasExpediterHardStop = false;
    let expediterError = "";

    for (const professional of professionals) {
      const result = await validateLicenseWithDLCP(professional);
      validationResults.push(result);

      const insertPayload = {
        filing_id: filingId,
        professional_name: result.professional_name,
        license_type: result.license_type,
        license_number: result.license_number,
        role_on_project: result.role_on_project,
        validation_status: result.validation_status,
        expiration_date: result.expiration_date,
        scope_of_license: result.scope_of_license,
      };

      const { error: insertError } = await dbClient
        .from("license_validations")
        .insert(insertPayload);

      if (insertError) {
        console.error(
          `[license-validation] Failed to insert validation for ${result.professional_name}:`,
          insertError.message
        );
      }

      if (
        (result.role_on_project?.toLowerCase() === "expediter" || result.role_on_project?.toLowerCase() === "permit_expediter" || result.role_on_project?.toLowerCase() === "permit expediter") &&
        result.validation_status !== "active"
      ) {
        hasExpediterHardStop = true;
        expediterError = `Commun-ET expediter license ${result.license_number} is ${result.validation_status}. Filing cannot proceed without an active expediter registration.`;
        console.error("[license-validation] HARD STOP:", expediterError);
      }
    }

    const allActive = validationResults.every((r) => r.validation_status === "active");
    const warnings = validationResults.filter(
      (r) => r.validation_status !== "active" && !["expediter", "permit_expediter", "permit expediter"].includes(r.role_on_project?.toLowerCase() || "")
    );

    const outputData = {
      total_checked: validationResults.length,
      all_active: allActive,
      hard_stop: hasExpediterHardStop,
      hard_stop_reason: hasExpediterHardStop ? expediterError : null,
      warnings: warnings.map((w) => ({
        professional_name: w.professional_name,
        license_type: w.license_type,
        license_number: w.license_number,
        role_on_project: w.role_on_project,
        status: w.validation_status,
        issue: w.error || `License is ${w.validation_status}`,
      })),
      results: validationResults,
    };

    const agentStatus = hasExpediterHardStop ? "escalated" : "completed";

    if (agentRunId) {
      const { error: updateError } = await dbClient
        .from("agent_runs")
        .update({
          status: agentStatus,
          output_data: outputData,
          error_message: hasExpediterHardStop ? expediterError : null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", agentRunId);

      if (updateError) {
        console.error("[license-validation] Failed to update agent_run:", updateError.message);
      }
    }

    console.log(
      `[license-validation] complete. checked=${validationResults.length} allActive=${allActive} hardStop=${hasExpediterHardStop} duration=${Date.now() - startTime}ms`
    );

    const responseStatus = hasExpediterHardStop ? 422 : 200;

    return new Response(
      JSON.stringify({
        filing_id: filingId,
        agent_run_id: agentRunId,
        status: agentStatus,
        ...outputData,
      }),
      {
        status: responseStatus,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[license-validation] error:", error);
    return new Response(
      JSON.stringify({
        code: 500,
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
