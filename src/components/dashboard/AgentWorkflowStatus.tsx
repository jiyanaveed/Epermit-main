import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, RefreshCw, Bot, ExternalLink, XCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

type PipelineResult = {
  comment_parser?: {
    parsed_count?: number;
    skipped_count?: number;
    error?: string;
    done?: boolean;
    next_cursor?: { pdfIndex: number };
    total_pdfs?: number;
  };
  discipline_classifier?: { classified_count?: number; error?: string };
};

const SCRAPER_URL = "http://localhost:3001";

type StepStatus = "idle" | "checking" | "waiting" | "pending" | "done" | "failed";

export function AgentWorkflowStatus() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { selectedProjectId } = useSelectedProject();
  const queryClient = useQueryClient();

  const [portalStatus, setPortalStatus] = useState<StepStatus>("idle");
  const [portalStatusText, setPortalStatusText] = useState<string | null>(null);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [parserRunning, setParserRunning] = useState(false);
  const [parserProgress, setParserProgress] = useState<{ pdfIndex: number; totalPdfs: number } | null>(null);
  const [firstJurisdiction, setFirstJurisdiction] = useState<string | null>(null);
  const [latestProjectId, setLatestProjectId] = useState<string | null>(null);
  const [latestPermitNumber, setLatestPermitNumber] = useState<string | null>(null);
  const [projectBySelectedId, setProjectBySelectedId] = useState<{ id: string; permit_number: string | null } | null>(null);

  const cp = pipelineResult?.comment_parser;
  const dc = pipelineResult?.discipline_classifier;
  const parserSucceeded = cp != null && !cp.error && cp.done === true;
  const commentParserFailed = cp != null && !!cp.error;
  const classifierDone = dc != null && !dc.error;
  const classifierFailed = dc != null && !!dc.error;

  const commentParserStatus: StepStatus = commentParserFailed
    ? "failed"
    : parserRunning
      ? "checking"
      : parserSucceeded
        ? "done"
        : "waiting";

  const commentParserDescription =
    commentParserFailed
      ? "Failed"
      : parserRunning && parserProgress
        ? `Running… PDF ${parserProgress.pdfIndex}/${parserProgress.totalPdfs}`
        : parserSucceeded
          ? (cp && (cp.parsed_count ?? 0) > 0)
            ? `Complete (${cp.parsed_count} parsed / ${cp.skipped_count ?? 0} skipped)`
            : "Complete (No comments found)"
          : "Waiting for Doc";

  const classifierStatus: StepStatus = classifierFailed ? "failed" : classifierDone ? "done" : "pending";

  const [enrichmentRunning, setEnrichmentRunning] = useState(false);
  const [enrichmentResult, setEnrichmentResult] = useState<number | null>(null);

  const { data: commentsForEnrichmentCheck } = useQuery({
    queryKey: ["parsed_comments_code_ref_check", selectedProjectId],
    queryFn: async (): Promise<{ id: string; code_reference: string | null }[]> => {
      if (!selectedProjectId) return [];
      const { data, error } = await supabase
        .from("parsed_comments")
        .select("id, code_reference")
        .eq("project_id", selectedProjectId);
      if (error) return [];
      return (data ?? []) as { id: string; code_reference: string | null }[];
    },
    enabled: !!selectedProjectId,
  });

  const allCommentsHaveCodeRef =
    (commentsForEnrichmentCheck?.length ?? 0) > 0 &&
    (commentsForEnrichmentCheck ?? []).every((r) => (r.code_reference ?? "").trim().length > 0);

  const enrichmentStatus: StepStatus =
    allCommentsHaveCodeRef ? "done" : enrichmentRunning ? "checking" : enrichmentResult != null ? "done" : "pending";

  const enrichmentDescription =
    allCommentsHaveCodeRef
      ? "Complete (all have code refs)"
      : enrichmentRunning
        ? "Running…"
        : enrichmentResult != null
          ? `Done (${enrichmentResult} enriched)`
          : "Enriches comments with code references and draft responses";

  const runEnrichment = useCallback(async () => {
    const projectIdToUse = selectedProjectId ?? projectBySelectedId?.id ?? latestProjectId;
    if (!projectIdToUse || !session?.access_token) {
      toast.error("Select a project and ensure you are logged in.");
      return;
    }
    setEnrichmentRunning(true);
    setEnrichmentResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("context-reference-engine", {
        body: { projectId: projectIdToUse },
      });
      if (error) throw error;
      const count = (data as { enriched_count?: number })?.enriched_count ?? 0;
      setEnrichmentResult(count);
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments_code_ref_check"] });
      toast.success(`${count} comment(s) enriched`);
    } catch (e) {
      console.warn("Context reference engine failed:", e);
      toast.error("Enrichment failed");
    } finally {
      setEnrichmentRunning(false);
    }
  }, [selectedProjectId, projectBySelectedId?.id, latestProjectId, session?.access_token, queryClient]);

  const [routerRunning, setRouterRunning] = useState(false);
  const [routerResult, setRouterResult] = useState<number | null>(null);

  const { data: commentsForRouterCheck } = useQuery({
    queryKey: ["parsed_comments_assigned_check", selectedProjectId],
    queryFn: async (): Promise<{ id: string; assigned_to: string | null }[]> => {
      if (!selectedProjectId) return [];
      const { data, error } = await supabase
        .from("parsed_comments")
        .select("id, assigned_to")
        .eq("project_id", selectedProjectId);
      if (error) return [];
      return (data ?? []) as { id: string; assigned_to: string | null }[];
    },
    enabled: !!selectedProjectId,
  });

  const allCommentsHaveAssigned =
    (commentsForRouterCheck?.length ?? 0) > 0 &&
    (commentsForRouterCheck ?? []).every((r) => (r.assigned_to ?? "").trim().length > 0);

  const routerStatus: StepStatus =
    allCommentsHaveAssigned ? "done" : routerRunning ? "checking" : routerResult != null ? "done" : "pending";

  const routerDescription =
    allCommentsHaveAssigned
      ? "Complete (all assigned)"
      : routerRunning
        ? "Running…"
        : routerResult != null
          ? `Done (${routerResult} routed)`
          : "Assigns comments to team members by discipline";

  const runAutoRoute = useCallback(async () => {
    const projectIdToUse = selectedProjectId ?? projectBySelectedId?.id ?? latestProjectId;
    if (!projectIdToUse || !session?.access_token) {
      toast.error("Select a project and ensure you are logged in.");
      return;
    }
    setRouterRunning(true);
    setRouterResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("auto-router-agent", {
        body: { projectId: projectIdToUse },
      });
      if (error) throw error;
      const count = (data as { routed_count?: number })?.routed_count ?? 0;
      setRouterResult(count);
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments_assigned_check"] });
      toast.success(`${count} comment(s) routed`);
    } catch (e) {
      console.warn("Auto-router agent failed:", e);
      toast.error("Auto-route failed");
    } finally {
      setRouterRunning(false);
    }
  }, [selectedProjectId, projectBySelectedId?.id, latestProjectId, session?.access_token, queryClient]);

  const classifierDescription =
    classifierFailed
      ? "Failed"
      : classifierDone
        ? (dc && (dc.classified_count ?? 0) > 0)
          ? `Complete (${dc.classified_count} classified)`
          : "Complete (Nothing to classify)"
        : "Pending";

  const loadDashboardData = useCallback(async () => {
    if (!user) return;
    const { data: cred } = await supabase
      .from("portal_credentials")
      .select("jurisdiction")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (cred?.jurisdiction) setFirstJurisdiction(cred.jurisdiction);

    const { data: project } = await supabase
      .from("projects")
      .select("id, portal_status, permit_number")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (project) {
      setLatestProjectId(project.id as string);
      setLatestPermitNumber((project.permit_number as string) ?? null);
      if (project.portal_status) {
        setPortalStatusText(project.portal_status as string);
      }
    }

    if (selectedProjectId) {
      const { data: sel } = await supabase
        .from("projects")
        .select("id, permit_number")
        .eq("id", selectedProjectId)
        .eq("user_id", user.id)
        .maybeSingle();
      setProjectBySelectedId(sel ? { id: sel.id as string, permit_number: (sel.permit_number as string) ?? null } : null);
    } else {
      setProjectBySelectedId(null);
    }
  }, [user, selectedProjectId]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const runManualCheck = async () => {
    const projectIdToUse = projectBySelectedId?.id ?? latestProjectId;
    const permitNumberToUse = projectBySelectedId?.permit_number ?? latestPermitNumber;

    if (!projectIdToUse) {
      toast.error("No project found. Select a project in the sidebar or create one first.");
      return;
    }

    if (!session?.access_token) {
      toast.error("You must be logged in to run this check.");
      return;
    }

    if (!permitNumberToUse || String(permitNumberToUse).trim() === "") {
      toast.error("Permit # is required. Set it in the sidebar: select the project, then enter Permit # under the project dropdown.");
      return;
    }

    setPortalStatus("checking");
    setPortalStatusText("Connecting...");
    toast.info("Fetching credentials...");

    try {
      // 1. Fetch portal credentials (prefer match by project_id; fallback permit_number)
      const { data: credentials, error: credError } = await supabase
        .from("portal_credentials")
        .select("portal_username, portal_password, permit_number, project_id")
        .eq("user_id", user!.id);

      if (credError) throw new Error("Failed to load portal credentials");
      if (!credentials?.length) throw new Error("No portal credentials found. Add credentials in Settings.");

      const cred =
        credentials.find((c) => c.project_id === projectIdToUse) ??
        (permitNumberToUse ? credentials.find((c) => c.permit_number === permitNumberToUse) : null) ??
        credentials[0];
      const username = cred.portal_username;
      const password = cred.portal_password;

      toast.info("Logging into portal...");

      // 2. Call local scraper login
      let loginRes: Response;
      try {
        loginRes = await fetch(`${SCRAPER_URL}/api/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
      } catch (fetchErr) {
        // Network error: scraper unreachable
        throw new Error("SCRAPER_OFFLINE");
      }

      if (!loginRes.ok) {
        const errData = await loginRes.json().catch(() => ({}));
        throw new Error(errData.error || `Scraper login failed (${loginRes.status})`);
      }

      const loginData = (await loginRes.json()) as { sessionId: string };
      const { sessionId } = loginData;

      toast.success("Scraping started");

      // 3. Trigger scrape with permit number from project (source of truth)
      const scrapeRes = await fetch(`${SCRAPER_URL}/api/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          permitNumber: String(permitNumberToUse).trim(),
          tabs: ["info", "reports"],
          userId: user!.id,
          projectId: projectIdToUse,
        }),
      });

      if (!scrapeRes.ok) {
        const errData = await scrapeRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to start scrape");
      }

      // 4. Poll for progress (every 1 second)
      const pollInterval = 1000;
      const maxAttempts = 180; // ~3 minutes
      let attempts = 0;

      const checkDone = async (): Promise<boolean> => {
        const dataRes = await fetch(`${SCRAPER_URL}/api/data/${sessionId}`);
        if (!dataRes.ok) return false;
        const data = (await dataRes.json()) as {
          status: string;
          message?: string;
          progress?: number;
          total?: number;
        };
        if (data.status === "done") {
          setPortalStatusText("Done");
          setPortalStatus("done");
          toast.success("Scraping complete! Data saved to dashboard.");
          await loadDashboardData();
          setParserRunning(true);
          setParserProgress(null);
          let cursor: { pdfIndex: number } | undefined;
          const pollIntervalMs = 2500;
          const maxRounds = 60;
          let totalParsed = 0;
          let totalSkipped = 0;
          let round = 0;
          try {
            while (round < maxRounds) {
              const { data: pipelineData, error: pipelineError } = await supabase.functions.invoke(
                "intake-pipeline-agent",
                { body: { project_id: projectIdToUse, ...(cursor && { cursor }) } }
              );
              if (pipelineError) {
                console.warn("Intake pipeline error:", pipelineError);
                break;
              }
              if (pipelineData == null) break;

              const cp = pipelineData.comment_parser;
              const dc = pipelineData.discipline_classifier;
              totalParsed += cp?.parsed_count ?? 0;
              totalSkipped += cp?.skipped_count ?? 0;
              setPipelineResult({
                comment_parser: { ...cp, parsed_count: totalParsed, skipped_count: totalSkipped },
                discipline_classifier: dc,
              });

              if (cp?.total_pdfs != null && (cp.next_cursor?.pdfIndex ?? 0) >= 0) {
                setParserProgress({
                  pdfIndex: cp.next_cursor?.pdfIndex ?? 0,
                  totalPdfs: cp.total_pdfs,
                });
              }

              if (cp?.done === true && !cp?.error) {
                await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
                const classified = dc?.classified_count ?? 0;
                if (totalParsed > 0 || classified > 0) {
                  toast.success(`Comments parsed: ${totalParsed}, classified: ${classified}.`);
                }
                break;
              }

              if (cp?.error === "timeout" || (cp?.next_cursor != null && !cp?.done)) {
                cursor = cp?.error === "timeout" ? undefined : cp.next_cursor;
                await new Promise((r) => setTimeout(r, pollIntervalMs));
                round++;
                continue;
              }
              break;
            }
          } catch (e) {
            console.warn("Intake pipeline (comment parser + classifier) failed:", e);
          } finally {
            setParserRunning(false);
            setParserProgress(null);
          }
          toast.info("View scraped data on the Portal Data page.", {
            action: { label: "View", onClick: () => navigate("/portal-data") },
          });
          return true;
        }
        if (data.status === "error") {
          throw new Error(data.message || "Scraping failed");
        }
        // Show progress percentage when available
        const total = data.total ?? 0;
        const progress = data.progress ?? 0;
        const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
        setPortalStatusText(pct > 0 ? `Scraping... ${pct}%` : (data.message || "Scraping..."));
        return false;
      };

      while (attempts < maxAttempts) {
        if (await checkDone()) return;
        await new Promise((r) => setTimeout(r, pollInterval));
        attempts++;
      }

      setPortalStatus("idle");
      setPortalStatusText("Timeout");
      toast.warning("Scraping took longer than expected. Check back shortly.");
    } catch (error) {
      console.error(error);
      setPortalStatus("idle");
      setPortalStatusText("Error");
      const msg = error instanceof Error ? error.message : String(error);
      const isOffline =
        msg === "SCRAPER_OFFLINE" ||
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError") ||
        msg.includes("Network request failed");
      if (isOffline) {
        toast.error(
          "Local Scraper is not running. Please run 'node server.js' in the scraper-service folder."
        );
      } else {
        toast.error(msg);
      }
    }
  };

  // ... (Rest of the UI render code remains the same)
  // Just pasting the return block to be safe:
  
  const steps = [
    {
      title: "Portal Monitor Agent",
      status: portalStatus,
      description:
        portalStatus === "checking"
          ? "Running"
          : portalStatus === "done"
            ? "Complete"
            : portalStatusText
              ? `Status: ${portalStatusText}`
              : "Idle",
      action: (
        <div className="flex flex-col gap-2 mt-2">
           <Button
            size="sm"
            variant="outline"
            onClick={runManualCheck}
            disabled={portalStatus === "checking"}
          >
            {portalStatus === "checking" ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Run Manual Check
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/portal-data">
              <ExternalLink className="h-4 w-4 mr-2" />
              View Portal Data
            </Link>
          </Button>
        </div>
      ),
    },
    {
      title: "Comment Parser Agent",
      status: commentParserStatus,
      description: commentParserDescription,
      action: (
        <Button size="sm" variant="outline" asChild className="mt-2">
          <Link to="/comment-review">
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Comment Review
          </Link>
        </Button>
      ),
    },
    {
      title: "Discipline Classifier Agent",
      status: classifierStatus,
      description: classifierDescription,
      action: (
        <Button size="sm" variant="outline" asChild className="mt-2">
          <Link to="/classified-comments">
            <ExternalLink className="h-4 w-4 mr-2" />
            View Classified Comments
          </Link>
        </Button>
      ),
    },
    {
      title: "Context & Reference Engine",
      status: enrichmentStatus,
      description: enrichmentDescription,
      action: (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={runEnrichment}
          disabled={enrichmentRunning || !selectedProjectId}
        >
          {enrichmentRunning ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : null}
          Run Enrichment
        </Button>
      ),
    },
    {
      title: "Auto-Router Agent",
      status: routerStatus,
      description: routerDescription,
      action: (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={runAutoRoute}
          disabled={routerRunning || !selectedProjectId}
        >
          {routerRunning ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : null}
          Run Auto-Route
        </Button>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bot className="h-5 w-5 text-accent" />
          DesignCheck Intake Pipeline
        </CardTitle>
        <CardDescription>
          Agentic workflow status (Steps 1–5). Run a manual portal check to simulate the Portal Monitor Agent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex flex-col items-center shrink-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                    step.status === "checking"
                      ? "border-accent bg-accent/10"
                      : step.status === "done"
                        ? "border-green-500 bg-green-500/10 text-green-600"
                        : step.status === "failed"
                          ? "border-destructive bg-destructive/10 text-destructive"
                          : "border-muted-foreground/30 bg-muted text-muted-foreground"
                  }`}
                >
                  {step.status === "checking" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : step.status === "done" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : step.status === "failed" ? (
                    <XCircle className="h-4 w-4" />
                  ) : (
                    <Circle className="h-4 w-4" />
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div className="w-0.5 flex-1 min-h-[24px] bg-border my-1" />
                )}
              </div>
              <div className="pb-4 min-w-0">
                <p className="font-medium">{step.title}</p>
                <p className="text-sm text-muted-foreground">{step.description}</p>
                {"action" in step && step.action}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}