import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FONT_SIZE = 9;
const ROW_MARGIN = 12;
const PAGE_MARGIN = 50;
const LINE_HEIGHT = FONT_SIZE + 2;
const COLS = {
  discipline: { x: PAGE_MARGIN, w: 55 },
  cityComment: { x: PAGE_MARGIN + 55, w: 120 },
  codeRef: { x: PAGE_MARGIN + 175, w: 55 },
  response: { x: PAGE_MARGIN + 230, w: 140 },
  sheetRef: { x: PAGE_MARGIN + 370, w: 45 },
};

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  const safe = String(text ?? "").trim() || "—";
  const words = safe.split(/\s+/);
  let line = "";
  for (const w of words) {
    if (line.length + w.length + 1 <= maxCharsPerLine) {
      line += (line ? " " : "") + w;
    } else {
      if (line) lines.push(line);
      line = w.length > maxCharsPerLine ? w.slice(0, maxCharsPerLine) : w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["—"];
}

interface CommentRow {
  discipline: string | null;
  status: string | null;
  original_text: string;
  code_reference: string | null;
  response_text: string;
  sheet_reference: string | null;
  assigned_to: string | null;
  created_at: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Missing config" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing or invalid Authorization" }, 401);
    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Invalid JWT" }, 401);

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) return json({ error: "Invalid JWT" }, 401);

    const body = await req.json().catch(() => ({}));
    const projectId = (body.project_id ?? body.projectId) as string | undefined;
    if (!projectId) return json({ error: "project_id is required" }, 400);

    const includeOnlyStatuses = body.include_only_statuses as string[] | undefined;

    const { data: project } = await supabaseAuth
      .from("projects")
      .select("id, user_id, name, permit_number")
      .eq("id", projectId)
      .single();
    if (!project || project.user_id !== user.id) {
      return json({ error: "Project not found or access denied" }, 404);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: allComments, error: fetchError } = await supabase
      .from("parsed_comments")
      .select("discipline, status, original_text, code_reference, response_text, sheet_reference, assigned_to, created_at")
      .eq("project_id", projectId)
      .order("discipline", { ascending: true })
      .order("created_at", { ascending: true });

    if (fetchError) {
      console.error("export-response-package: fetch error", fetchError);
      return json({ error: fetchError.message }, 500);
    }

    const rows = (allComments ?? []) as CommentRow[];
    const withResponse = rows.filter((r) => r.response_text != null && String(r.response_text).trim() !== "");
    const missingCount = rows.length - withResponse.length;
    if (missingCount > 0) {
      return json({ error: "Incomplete responses", missing_count: missingCount }, 400);
    }

    let toExport = withResponse;
    if (includeOnlyStatuses?.length) {
      const set = new Set(includeOnlyStatuses.map((s: string) => s.toLowerCase()));
      toExport = toExport.filter((r) => set.has((r.status ?? "").toLowerCase()));
    }

    if (toExport.length === 0) {
      return json({ error: "No comments to export", missing_count: 0 }, 400);
    }

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    let page = doc.addPage([612, 792]);
    const pageHeight = 792;
    let y = pageHeight - PAGE_MARGIN;

    const drawText = (p: typeof page, x: number, y: number, text: string, bold = false) => {
      const f = bold ? fontBold : font;
      p.drawText(text, { x, y, size: FONT_SIZE, font: f, color: rgb(0.1, 0.1, 0.1) });
    };

    const projectName = (project as { name?: string }).name ?? "Project";
    const permitNumber = (project as { permit_number?: string | null }).permit_number ?? "";
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);

    drawText(page, PAGE_MARGIN, y, `Response Package: ${projectName}${permitNumber ? ` · Permit #${permitNumber}` : ""}`, true);
    y -= LINE_HEIGHT;
    drawText(page, PAGE_MARGIN, y, `Generated: ${timestamp}`);
    y -= LINE_HEIGHT * 1.5;

    drawText(page, COLS.discipline.x, y, "Discipline", true);
    drawText(page, COLS.cityComment.x, y, "City Comment", true);
    drawText(page, COLS.codeRef.x, y, "Code Ref", true);
    drawText(page, COLS.response.x, y, "Response", true);
    drawText(page, COLS.sheetRef.x, y, "Sheet Ref", true);
    y -= LINE_HEIGHT;
    const tableTopY = y;

    for (const row of toExport) {
      const discLines = wrapText(row.discipline ?? "", 8);
      const cityLines = wrapText(row.original_text ?? "", 22);
      const codeLines = wrapText(row.code_reference ?? "", 8);
      const respLines = wrapText(row.response_text ?? "", 28);
      const sheetLines = wrapText(row.sheet_reference ?? "", 6);
      const lineCount = Math.max(1, discLines.length, cityLines.length, codeLines.length, respLines.length, sheetLines.length);

      if (y - lineCount * LINE_HEIGHT < PAGE_MARGIN) {
        page = doc.addPage([612, 792]);
        y = pageHeight - PAGE_MARGIN;
      }

      let yOff = 0;
      for (let i = 0; i < lineCount; i++) {
        drawText(page, COLS.discipline.x, y - yOff, discLines[i] ?? "");
        drawText(page, COLS.cityComment.x, y - yOff, cityLines[i] ?? "");
        drawText(page, COLS.codeRef.x, y - yOff, codeLines[i] ?? "");
        drawText(page, COLS.response.x, y - yOff, respLines[i] ?? "");
        drawText(page, COLS.sheetRef.x, y - yOff, sheetLines[i] ?? "");
        yOff += LINE_HEIGHT;
      }
      y -= yOff + ROW_MARGIN;
    }

    const pdfBytes = await doc.save();
    const timestampSafe = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filePath = `exports/${projectId}/response-package-${timestampSafe}.pdf`;

    const { error: uploadError } = await supabase.storage.from("exports").upload(filePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

    if (uploadError) {
      console.error("export-response-package: upload error", uploadError);
      return json({ error: "Upload failed: " + uploadError.message }, 500);
    }

    const { data: signed, error: signError } = await supabase.storage.from("exports").createSignedUrl(filePath, 3600);
    if (signError || !signed?.signedUrl) {
      console.error("export-response-package: sign error", signError);
      return json({ error: "Signed URL failed", file_path: filePath }, 500);
    }

    return json({ url: signed.signedUrl, file_path: filePath });
  } catch (err) {
    console.error("export-response-package:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
