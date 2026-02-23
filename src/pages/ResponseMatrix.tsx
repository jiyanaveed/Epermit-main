import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Save, Wand2, ArrowLeft, CheckCircle2, ShieldCheck, FileDown } from "lucide-react";

const STATUS_OPTIONS = [
  "Pending Review",
  "Pending",
  "Approved",
  "Rejected",
  "Draft",
  "Ready for Review",
] as const;

/** Exclude report metadata lines that were mistakenly parsed as comments. */
const REPORT_METADATA_PHRASES = [
  "Created in ProjectDox version",
  "Report Generated:",
  "Workflow Started:",
  "Report date:",
  "Project Name:",
  "Upload and Submit",
  "Workflow Routing Slip",
  "Total Review Comments:",
  "Elapsed Days:",
  "Time Elapsed:",
  "Number of Files:",
  "Plan Review - Review Comments Report",
  "No data found.",
];

function isReportMetadataRow(row: { original_text?: string | null }): boolean {
  const t = (row.original_text ?? "").trim();
  if (t.length < 15) return true;
  return REPORT_METADATA_PHRASES.some((phrase) => t.includes(phrase));
}

export interface ParsedCommentRow {
  id: string;
  project_id: string;
  original_text: string;
  discipline: string;
  code_reference: string | null;
  status: string;
  page_number: number | null;
  response_text: string | null;
  assigned_to: string | null;
  sheet_reference: string | null;
  created_at: string;
}

export default function ResponseMatrix() {
  const { user, loading: authLoading } = useAuth();
  const { projects } = useProjects();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectIdParam = searchParams.get("project") ?? searchParams.get("project_id");
  const filterPending = searchParams.get("filter") === "pending";

  const [projectId, setProjectId] = useState<string | null>(projectIdParam);
  const [saving, setSaving] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [validateOpen, setValidateOpen] = useState(false);
  const [validateResult, setValidateResult] = useState<{
    complete: boolean;
    stats: { total: number; responded: number; pending: number };
    missing: string[];
  } | null>(null);
  const [validating, setValidating] = useState(false);
  const [qualityCheckOpen, setQualityCheckOpen] = useState(false);
  const [qualityChecking, setQualityChecking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [qualityCheckResult, setQualityCheckResult] = useState<{
    project_id: string;
    results: Array<{
      id: string;
      score: number;
      flags: string[];
      notes: string;
      suggested_improvement: string;
    }>;
    summary: { avg_score: number; flagged_count: number; top_issues: string[] };
  } | null>(null);

  const fetchComments = useCallback(async (): Promise<ParsedCommentRow[]> => {
    if (!projectId) return [];
    const { data, error } = await supabase
      .from("parsed_comments")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Failed to load comments");
      return [];
    }
    return (data as ParsedCommentRow[]) || [];
  }, [projectId]);

  const queryClient = useQueryClient();
  const { data: allRows = [], isLoading: loading } = useQuery({
    queryKey: ["parsed_comments", projectId],
    queryFn: fetchComments,
    enabled: !!projectId,
  });

  const withoutMetadata = (allRows ?? []).filter((r) => !isReportMetadataRow(r));
  const rows =
    filterPending && withoutMetadata.length > 0
      ? withoutMetadata.filter(
          (r) =>
            (r.status ?? "").toLowerCase() === "pending" ||
            r.response_text == null ||
            String(r.response_text).trim() === ""
        )
      : withoutMetadata;

  useEffect(() => {
    if (projectIdParam && !projectId) setProjectId(projectIdParam);
  }, [projectIdParam, projectId]);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading, navigate]);

  const updateRow = (id: string, field: keyof ParsedCommentRow, value: string | null) => {
    if (!projectId) return;
    queryClient.setQueryData<ParsedCommentRow[]>(["parsed_comments", projectId], (prev) =>
      (prev ?? []).map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const runAutoDraft = useCallback(async (row: ParsedCommentRow) => {
    setDraftingId(row.id);
    try {
      const { data, error } = await supabase.functions.invoke("generate-response", {
        body: {
          comment_text: row.original_text,
          code_reference: row.code_reference || "",
          discipline: row.discipline,
        },
      });
      if (error) throw error;
      const payload = data as { suggested_response?: string } | null;
      const text = typeof payload?.suggested_response === "string" ? payload.suggested_response : "";
      updateRow(row.id, "response_text", text);
      toast.success("Response drafted");
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Auto-draft failed");
    } finally {
      setDraftingId(null);
    }
  }, []);

  const runValidateCompleteness = useCallback(async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    setValidating(true);
    setValidateResult(null);
    setValidateOpen(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-completeness-agent", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      const payload = data as {
        complete?: boolean;
        stats?: { total: number; responded: number; pending: number };
        missing?: string[];
      };
      setValidateResult({
        complete: payload?.complete ?? false,
        stats: payload?.stats ?? { total: 0, responded: 0, pending: 0 },
        missing: Array.isArray(payload?.missing) ? payload.missing : [],
      });
    } catch (e) {
      console.warn("Validate completeness failed:", e);
      toast.error("Validation failed");
      setValidateResult({
        complete: false,
        stats: { total: 0, responded: 0, pending: 0 },
        missing: [],
      });
    } finally {
      setValidating(false);
    }
  }, [projectId]);

  const runQualityCheck = useCallback(async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    setQualityChecking(true);
    setQualityCheckResult(null);
    setQualityCheckOpen(true);
    try {
      const { data, error } = await supabase.functions.invoke("guardian-quality-agent", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      const payload = data as {
        project_id?: string;
        results?: Array<{ id: string; score: number; flags: string[]; notes: string; suggested_improvement: string }>;
        summary?: { avg_score?: number; flagged_count?: number; top_issues?: string[] };
      };
      setQualityCheckResult({
        project_id: payload?.project_id ?? projectId,
        results: Array.isArray(payload?.results) ? payload.results : [],
        summary: {
          avg_score: payload?.summary?.avg_score ?? 0,
          flagged_count: payload?.summary?.flagged_count ?? 0,
          top_issues: Array.isArray(payload?.summary?.top_issues) ? payload.summary.top_issues : [],
        },
      });
    } catch (e) {
      console.warn("Quality check failed:", e);
      toast.error("Quality check failed");
      setQualityCheckResult({
        project_id: projectId,
        results: [],
        summary: { avg_score: 0, flagged_count: 0, top_issues: [] },
      });
    } finally {
      setQualityChecking(false);
    }
  }, [projectId]);

  const runExportResponsePackage = useCallback(async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-response-package", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      const payload = data as { url?: string; file_path?: string; error?: string; missing_count?: number };
      if (payload?.error) {
        if (payload.error === "Incomplete responses" && typeof payload.missing_count === "number") {
          toast.error(
            `Project has ${payload.missing_count} comment(s) without responses. Run "Validate Completeness" first.`,
            { duration: 6000 }
          );
        } else {
          toast.error(payload.error);
        }
        return;
      }
      if (payload?.url) {
        window.open(payload.url, "_blank");
        toast.success("Response package exported");
      } else {
        toast.error("Export succeeded but no download URL returned");
      }
    } catch (e) {
      console.warn("Export response package failed:", e);
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }, [projectId]);

  const applySuggestion = useCallback(
    (commentId: string, suggested_improvement: string) => {
      updateRow(commentId, "response_text", suggested_improvement);
      toast.success("Suggestion applied to draft. Click Save Changes to persist.");
    },
    [updateRow]
  );

  const saveChanges = useCallback(async () => {
    if (!user || rows.length === 0) return;
    setSaving(true);
    try {
      for (const row of rows) {
        const { error } = await supabase
          .from("parsed_comments")
          .update({
            response_text: row.response_text || null,
            assigned_to: row.assigned_to || null,
            sheet_reference: row.sheet_reference || null,
            status: row.status,
          })
          .eq("id", row.id);
        if (error) throw error;
      }
      toast.success("Changes saved");
      fetchComments();
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [user, rows, fetchComments]);

  if (authLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] p-4 md:p-6">
      <div className="max-w-[1600px] mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Response Matrix</h1>
              <p className="text-muted-foreground text-sm">
                Manage and draft official responses to permit comments.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">Project</Label>
            <Select value={projectId ?? ""} onValueChange={setProjectId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={runValidateCompleteness}
              disabled={!projectId || validating}
            >
              {validating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Validate Completeness
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={runQualityCheck}
              disabled={!projectId || qualityChecking}
            >
              {qualityChecking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              Quality Check
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={runExportResponsePackage}
              disabled={!projectId || exporting}
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
              Export Response Package
            </Button>
            <Button
              onClick={saveChanges}
              disabled={saving || rows.length === 0}
              className="bg-accent hover:bg-accent/90"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </div>
        </div>

        <Dialog open={validateOpen} onOpenChange={setValidateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Completeness check</DialogTitle>
              <DialogDescription>
                {validating
                  ? "Checking comments..."
                  : validateResult
                    ? validateResult.complete
                      ? "All comments have a response and are Ready for Review or Approved."
                      : `${validateResult.stats.pending} comment(s) still need a response and/or status update.`
                    : "Run a quick check to see if the project is ready for submission."}
              </DialogDescription>
            </DialogHeader>
            {!validating && validateResult && (
              <div className="py-2">
                <p className="text-base font-medium">
                  {validateResult.complete
                    ? "Project ready for submission."
                    : `Project NOT ready. ${validateResult.stats.pending} comment(s) still missing responses.`}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Total: {validateResult.stats.total} · Responded: {validateResult.stats.responded} · Pending: {validateResult.stats.pending}
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={qualityCheckOpen} onOpenChange={setQualityCheckOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Quality check</DialogTitle>
              <DialogDescription>
                {qualityChecking
                  ? "Reviewing responses..."
                  : qualityCheckResult
                    ? `Average score: ${qualityCheckResult.summary.avg_score.toFixed(1)} · ${qualityCheckResult.summary.flagged_count} flagged`
                    : "Score each response and flag vague or incomplete answers."}
              </DialogDescription>
            </DialogHeader>
            {!qualityChecking && qualityCheckResult && (
              <div className="space-y-4 py-2">
                <div className="flex gap-4 text-sm">
                  <span className="font-medium">Avg score: {qualityCheckResult.summary.avg_score.toFixed(1)}</span>
                  <span className="text-muted-foreground">Flagged: {qualityCheckResult.summary.flagged_count}</span>
                </div>
                {qualityCheckResult.summary.top_issues.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Top issues: {qualityCheckResult.summary.top_issues.join("; ")}
                  </p>
                )}
                {qualityCheckResult.results.filter((r) => r.flags?.length > 0).length > 0 ? (
                  <div className="border rounded-md overflow-auto max-h-[50vh]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Score</TableHead>
                          <TableHead>Comment / Notes</TableHead>
                          <TableHead>Suggested improvement</TableHead>
                          <TableHead className="w-28">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {qualityCheckResult.results
                          .filter((r) => r.flags?.length > 0)
                          .map((item) => {
                            const row = allRows.find((r) => r.id === item.id);
                            const commentPreview = row?.original_text?.slice(0, 80) ?? item.id;
                            return (
                              <TableRow key={item.id}>
                                <TableCell className="font-mono">{item.score}</TableCell>
                                <TableCell className="text-sm">
                                  <p className="truncate max-w-[200px]" title={row?.original_text ?? ""}>
                                    {commentPreview}
                                    {commentPreview.length >= 80 ? "…" : ""}
                                  </p>
                                  <p className="text-muted-foreground text-xs mt-1">{item.notes}</p>
                                  <Badge variant="secondary" className="mt-1">
                                    {item.flags?.join(", ")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm max-w-[220px]">
                                  {item.suggested_improvement ? (
                                    <p className="line-clamp-3">{item.suggested_improvement}</p>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {item.suggested_improvement ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => applySuggestion(item.id, item.suggested_improvement)}
                                    >
                                      Apply suggestion
                                    </Button>
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No flagged items.</p>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {!projectId ? (
          <p className="text-muted-foreground text-center py-12">
            Select a project to load parsed comments.
          </p>
        ) : loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-12">
            {filterPending
              ? "No pending comments for this project."
              : "No parsed comments for this project. Add comments from the Comment Review workspace."}
          </p>
        ) : (
          <>
          {filterPending && (
            <p className="text-sm text-muted-foreground mb-2">
              <Badge variant="secondary">Showing pending comments only</Badge>
            </p>
          )}
          <div className="border rounded-md overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[100px]">Discipline</TableHead>
                  <TableHead className="min-w-[220px]">City Comment</TableHead>
                  <TableHead className="w-32">Code Ref.</TableHead>
                  <TableHead className="min-w-[280px]">Response</TableHead>
                  <TableHead className="w-[100px]">Auto-Draft</TableHead>
                  <TableHead className="w-[140px]">Assigned To</TableHead>
                  <TableHead className="w-[100px]">Sheet Ref.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Select
                        value={row.status}
                        onValueChange={(v) => updateRow(row.id, "status", v)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.discipline}</Badge>
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground max-w-[280px]">
                      {row.original_text}
                    </TableCell>
                    <TableCell className="align-top w-32">
                      {row.code_reference?.trim() ? (
                        <span className="text-xs font-mono text-blue-700 bg-blue-50 px-2 py-1 rounded">
                          {row.code_reference}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top p-2">
                      <Textarea
                        value={row.response_text ?? ""}
                        onChange={(e) => updateRow(row.id, "response_text", e.target.value)}
                        placeholder="Official response..."
                        className="min-h-[80px] resize-y"
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => runAutoDraft(row)}
                        disabled={draftingId === row.id}
                        className="shrink-0"
                      >
                        {draftingId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Wand2 className="h-4 w-4" />
                        )}
                        <span className="ml-1 hidden sm:inline">Auto-Draft</span>
                      </Button>
                    </TableCell>
                    <TableCell className="align-top p-2">
                      <Input
                        value={row.assigned_to ?? ""}
                        onChange={(e) => updateRow(row.id, "assigned_to", e.target.value)}
                        placeholder="Name or email"
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell className="align-top p-2">
                      <Input
                        value={row.sheet_reference ?? ""}
                        onChange={(e) => updateRow(row.id, "sheet_reference", e.target.value)}
                        placeholder="e.g. A1.02"
                        className="h-8"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
