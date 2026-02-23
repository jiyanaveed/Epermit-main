import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import OpenAI from "https://esm.sh/openai@4.28.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DISCIPLINE_ENUM = [
  "Architectural",
  "Structural",
  "Mechanical",
  "Electrical",
  "Plumbing",
  "Fire",
  "Civil",
  "Energy",
  "Zoning",
  "Environmental",
  "Administrative",
  "Other",
] as const;

type Discipline = (typeof DISCIPLINE_ENUM)[number];

function isDiscipline(s: string): s is Discipline {
  return (DISCIPLINE_ENUM as readonly string[]).includes(s);
}

const BATCH_SIZE = 50;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ code: 500, message: "OpenAI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
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
    console.log("Authorization header present, validating JWT");

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.warn("JWT validation failed:", userError?.message ?? "No user");
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log("JWT validated, user.id:", user.id);

    const body = await req.json().catch(() => ({}));
    const projectId = body.project_id as string | undefined;
    const batchLimit = typeof body.batch_limit === "number" && body.batch_limit > 0
      ? Math.min(body.batch_limit, 200)
      : BATCH_SIZE;

    if (projectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("id, user_id")
        .eq("id", projectId)
        .single();
      if (!project || project.user_id !== user.id) {
        return new Response(
          JSON.stringify({ code: 404, message: "Project not found or access denied" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const projectIdsResult = await supabase.from("projects").select("id").eq("user_id", user.id);
    const projectIds = (projectIdsResult.data ?? []).map((p: { id: string }) => p.id);
    if (projectIds.length === 0) {
      return new Response(
        JSON.stringify({ classified_count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orDiscipline = "discipline.is.null,discipline.eq.General,discipline.eq.";
    const projectFilter = projectId ? [projectId] : projectIds;
    console.log("[DEBUG] discipline-classifier query: table=parsed_comments, filter=(discipline IS NULL OR discipline='General' OR discipline=''), status=Pending, project_id in", projectFilter.length, "projects, limit=", batchLimit);

    let query = supabase
      .from("parsed_comments")
      .select("id, original_text, project_id, discipline")
      .or(orDiscipline)
      .eq("status", "Pending")
      .in("project_id", projectId ? [projectId] : projectIds)
      .limit(batchLimit);

    const { data: rows, error: fetchError } = await query;

    if (fetchError) {
      console.error("Fetch parsed_comments error:", fetchError);
      return new Response(
        JSON.stringify({ code: 500, message: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const comments = (rows ?? []) as { id: string; original_text: string; project_id: string; discipline: string | null }[];
    console.log("[DEBUG] discipline-classifier: query returned rows:", comments.length);
    if (comments.length === 0) {
      return new Response(
        JSON.stringify({ classified_count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const systemPrompt = `Classify each building permit review comment into exactly one discipline.

Available disciplines and what they cover:

- Structural: Load-bearing elements, foundations, framing, steel, concrete, structural calculations, wind/seismic design, IBC Chapter 16-23

- Architectural: Building envelope, egress, accessibility (ADA), room layouts, finishes, doors/windows, fire-rated assemblies, IBC Chapters 3-12

- Mechanical: Heating, cooling, ventilation, ductwork, IMC code references (use "Mechanical" for HVAC)

- Electrical: Power distribution, lighting, panels, NEC code references, electrical load calculations

- Plumbing: Water supply, drainage, fixtures, IPC code references

- Fire: Sprinklers, fire alarms, smoke detectors, fire suppression, NFPA references

- Civil: Site work, grading, stormwater, surveyor's plat, erosion control, utilities, site plans

- Zoning: Setbacks, lot coverage, FAR, height limits, use permits, zoning code references, variances

- Environmental: Lead abatement, asbestos, hazardous materials, DOEE permits, EPA requirements, environmental surveys, contamination

- Energy: Energy code compliance, IECC, green building requirements, insulation, energy modeling (use "Energy" for green/energy)

- Administrative: Document formatting, missing submissions, permit fees, application completeness, signatures, stamps, certifications

- Other: ONLY use this if the comment truly doesn't fit any category above. Most comments SHOULD fit into one of the specific disciplines.

IMPORTANT: Prefer specific disciplines over 'Other'. For example:
- Lead abatement → Environmental (not Other)
- Asbestos survey → Environmental (not Other)
- Cost estimate upload → Administrative (not Other)
- Surveyor's plat → Civil
- Demo permit → Administrative or Environmental depending on context
- DOEE permit → Environmental

Return a JSON object with a single key "classifications": an array of objects with "index" (0-based position in the list) and "discipline" (exactly one of: Architectural, Structural, Mechanical, Electrical, Plumbing, Fire, Civil, Energy, Zoning, Environmental, Administrative, Other). One object per comment in the same order as provided.`;

    const userContent = comments.map((c, i) => `[${i}] ${c.original_text}`).join("\n\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 2048,
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      return new Response(
        JSON.stringify({ code: 500, message: "No response from model", classified_count: 0 }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let data: { classifications?: { index: number; discipline: string }[] };
    try {
      data = JSON.parse(content);
    } catch {
      return new Response(
        JSON.stringify({ code: 500, message: "Invalid JSON from model", classified_count: 0 }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const classifications = Array.isArray(data.classifications) ? data.classifications : [];
    let classifiedCount = 0;
    let otherCount = 0;

    for (const c of classifications) {
      const i = c.index;
      if (i < 0 || i >= comments.length) continue;
      const row = comments[i];
      const discipline = isDiscipline(c.discipline) ? c.discipline : "Other";
      if (discipline === "Other") otherCount++;
      const { error: updateError } = await supabase
        .from("parsed_comments")
        .update({ discipline })
        .eq("id", row.id)
        .or(orDiscipline);

      if (!updateError) classifiedCount++;
    }

    if (classifications.length > 0 && otherCount / classifications.length > 0.5) {
      console.log("[WARN] Over 50% classified as Other — prompt may need tuning");
    }
    console.log("discipline-classifier: rows updated:", classifiedCount);
    return new Response(
      JSON.stringify({ classified_count: classifiedCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in discipline-classifier-agent:", error);
    return new Response(
      JSON.stringify({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
