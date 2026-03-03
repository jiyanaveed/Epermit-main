import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, RefreshCw, ExternalLink, XCircle, Workflow } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

const SCRAPE_KEYFRAMES = `
  @keyframes scrape-pulse-glow {
    0%, 100% { opacity: 1; box-shadow: 0 0 12px rgba(16, 185, 129, 0.5); }
    50% { opacity: 0.9; box-shadow: 0 0 24px rgba(16, 185, 129, 0.7); }
  }
  @keyframes scrape-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes scrape-fade-in-up {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes scrape-scale-check {
    from { opacity: 0; transform: scale(0.5); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes scrape-pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(1.2); }
  }
  @keyframes scrape-sparkle {
    0%, 100% { opacity: 0; transform: scale(0); }
    50% { opacity: 1; transform: scale(1); }
  }
`;

const TAB_STEPS = [
  { key: "status", label: "Status tab" },
  { key: "files", label: "Files tab" },
  { key: "tasks", label: "Tasks tab" },
  { key: "info", label: "Info tab" },
  { key: "reports", label: "Reports tab" },
];

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

const SCRAPER_URL = "http://localhost:3000";

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

  const [scrapingOverlay, setScrapingOverlay] = useState<{
    phase: "scraping" | "done";
    stepText: string;
    progress: number;
    total: number;
    projectNum: string;
    completedSteps: Set<string>;
    currentStepKey: string | null;
  } | null>(null);
  const [scrapingElapsed, setScrapingElapsed] = useState(0);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onScrapingCompleteRef = useRef<(() => void) | null>(null);
  const doneDismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (scrapingOverlay?.phase !== "done") return;
    doneDismissTimeoutRef.current = setTimeout(() => {
      onScrapingCompleteRef.current?.();
      setScrapingOverlay(null);
      doneDismissTimeoutRef.current = null;
    }, 3000);
    return () => {
      if (doneDismissTimeoutRef.current) {
        clearTimeout(doneDismissTimeoutRef.current);
        doneDismissTimeoutRef.current = null;
      }
    };
  }, [scrapingOverlay?.phase]);

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

      const completedSteps = new Set<string>();
      setScrapingOverlay({
        phase: "scraping",
        stepText: "Logging in...",
        progress: 0,
        total: 5,
        projectNum: String(permitNumberToUse).trim(),
        completedSteps,
        currentStepKey: null,
      });
      setScrapingElapsed(0);
      elapsedIntervalRef.current = setInterval(() => {
        setScrapingElapsed((s) => s + 1);
      }, 1000);

      const progressUrl = `${SCRAPER_URL}/api/progress/${sessionId}`;
      const es = new EventSource(progressUrl);
      eventSourceRef.current = es;
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as {
            status?: string;
            message?: string;
            progress?: number;
            total?: number;
          };
          const total = data.total ?? 0;
          const progress = data.progress ?? 0;
          const msg = (data.message ?? "").trim();
          setScrapingOverlay((prev) => {
            if (!prev) return prev;
            const nextCompleted = new Set(prev.completedSteps);
            if (msg.includes("→ Info")) {
              nextCompleted.add("info");
              nextCompleted.add("status");
              nextCompleted.add("files");
              nextCompleted.add("tasks");
            }
            if (msg.includes("→ Reports")) {
              nextCompleted.add("reports");
            }
            if (msg.includes("→ Status")) nextCompleted.add("status");
            if (msg.includes("→ Files")) nextCompleted.add("files");
            if (msg.includes("→ Tasks")) nextCompleted.add("tasks");
            let stepText = prev.stepText;
            if (data.status === "done") {
              stepText = "Saving to database...";
            } else if (msg) {
              if (msg.includes("→ Info")) stepText = "Scraping Info tab...";
              else if (msg.includes("→ Reports")) stepText = "Scraping Reports tab...";
              else if (msg.includes("→ Status")) stepText = "Scraping Status tab...";
              else if (msg.includes("→ Files")) stepText = "Scraping Files tab...";
              else if (msg.includes("→ Tasks")) stepText = "Scraping Tasks tab...";
              else stepText = msg;
            }
            const currentKey =
              msg.includes("→ Reports")
                ? "reports"
                : msg.includes("→ Info")
                  ? "info"
                  : msg.includes("→ Status")
                    ? "status"
                    : msg.includes("→ Files")
                      ? "files"
                      : msg.includes("→ Tasks")
                        ? "tasks"
                        : prev.currentStepKey;
            return {
              ...prev,
              stepText,
              progress,
              total: total || prev.total,
              completedSteps: nextCompleted,
              currentStepKey: currentKey,
            };
          });
        } catch (_) {}
      };
      es.onerror = () => es.close();

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
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
          if (elapsedIntervalRef.current) {
            clearInterval(elapsedIntervalRef.current);
            elapsedIntervalRef.current = null;
          }
          const total = data.total ?? 0;
          const progress = data.progress ?? 0;
          const tabsExtracted = Math.max(progress, total, 1);
          setScrapingOverlay((prev) =>
            prev
              ? {
                  ...prev,
                  phase: "done",
                  stepText: `Scraping complete! ${tabsExtracted}/${Math.max(total, 1)} tabs extracted`,
                  progress: total,
                  total,
                  completedSteps: new Set(TAB_STEPS.map((t) => t.key)),
                  currentStepKey: null,
                }
              : null
          );
          onScrapingCompleteRef.current = async () => {
            setPortalStatusText("Done");
            setPortalStatus("done");
            toast.success(`🎉 Scraping complete! ${tabsExtracted} tab${tabsExtracted === 1 ? "" : "s"} extracted. Data saved.`);
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
                    toast.success(`Comment Parser · ${totalParsed} parsed, ${classified} classified.`);
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
            onScrapingCompleteRef.current = null;
          };
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
      setScrapingOverlay(null);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
      toast.warning("Scraping took longer than expected. Check back shortly.");
    } catch (error) {
      console.error(error);
      setPortalStatus("idle");
      setPortalStatusText("Error");
      setScrapingOverlay(null);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const isOffline =
        msg === "SCRAPER_OFFLINE" ||
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError") ||
        msg.includes("Network request failed");
      if (isOffline) {
        toast.error(
          "Local Scraper is not running. Run 'node server.js' in the scraper-service folder, then retry."
        );
      } else {
        toast.error(msg ? `${msg} Try again or check your connection.` : "Something went wrong. Try again.");
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
            className="group/btn transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
          >
            {portalStatus === "checking" ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2 transition-transform duration-300 group-hover/btn:rotate-180" />
            )}
            Run Manual Check
          </Button>
          <Button size="sm" variant="outline" asChild className="group/btn transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]">
            <Link to="/portal-data" className="flex items-center">
              <ExternalLink className="h-4 w-4 mr-2 transition-transform duration-300 group-hover/btn:scale-110" />
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

  const formatElapsed = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const handleDismissScrapingOverlay = useCallback(() => {
    if (doneDismissTimeoutRef.current) {
      clearTimeout(doneDismissTimeoutRef.current);
      doneDismissTimeoutRef.current = null;
    }
    onScrapingCompleteRef.current?.();
    setScrapingOverlay(null);
  }, []);

  return (
    <>
      <style>{SCRAPE_KEYFRAMES}</style>
      {scrapingOverlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Scraping progress"
        >
          <div className="relative w-full max-w-md rounded-xl border border-emerald-500/30 bg-zinc-900/95 shadow-2xl shadow-emerald-900/20 overflow-hidden">
            {/* Subtle pulse background */}
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-emerald-600/5 pointer-events-none" />
            <div
              className="absolute inset-0 opacity-30 pointer-events-none"
              style={{
                background: "radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.15) 0%, transparent 60%)",
                animation: "scrape-pulse-glow 2s ease-in-out infinite",
              }}
            />

            <div className="relative p-6 space-y-5">
              {scrapingOverlay.phase === "scraping" ? (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">Scraping portal</h3>
                    <span className="text-sm font-mono text-emerald-400 tabular-nums">{formatElapsed(scrapingElapsed)}</span>
                  </div>
                  <p className="text-sm text-zinc-400">Project: <span className="font-medium text-emerald-400">{scrapingOverlay.projectNum}</span></p>
                  <div className="flex items-center gap-3">
                    <div
                      className="h-5 w-5 shrink-0 rounded-full border-2 border-emerald-500 border-t-transparent"
                      style={{ animation: "scrape-spin 0.8s linear infinite" }}
                    />
                    <p className="text-sm text-zinc-300">{scrapingOverlay.stepText}</p>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 rounded-full bg-zinc-700 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500 ease-out"
                        style={{
                          width: `${scrapingOverlay.total > 0 ? Math.round((scrapingOverlay.progress / scrapingOverlay.total) * 100) : 0}%`,
                          animation: "scrape-pulse-glow 1.5s ease-in-out infinite",
                        }}
                      />
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {TAB_STEPS.map((tab) => {
                      const done = scrapingOverlay.completedSteps.has(tab.key);
                      const current = scrapingOverlay.currentStepKey === tab.key;
                      return (
                        <li
                          key={tab.key}
                          className="flex items-center gap-3 text-sm"
                          style={
                            done
                              ? { animation: "scrape-fade-in-up 0.3s ease-out forwards" }
                              : undefined
                          }
                        >
                          {done ? (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                          ) : current ? (
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500"
                              style={{ animation: "scrape-pulse-dot 1s ease-in-out infinite" }}
                            />
                          ) : (
                            <Circle className="h-5 w-5 shrink-0 text-zinc-500" />
                          )}
                          <span className={done ? "text-zinc-300" : current ? "text-emerald-400 font-medium" : "text-zinc-500"}>
                            {tab.label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <div className="text-center py-2">
                  <div
                    className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500"
                    style={{ animation: "scrape-scale-check 0.4s ease-out forwards" }}
                  >
                    <CheckCircle2 className="h-10 w-10" strokeWidth={2} />
                  </div>
                  <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl">
                    <span className="absolute top-1/4 left-1/4 w-2 h-2 rounded-full bg-emerald-400" style={{ animation: "scrape-sparkle 0.6s ease-out 0.1s forwards", opacity: 0 }} />
                    <span className="absolute top-1/3 right-1/3 w-1.5 h-1.5 rounded-full bg-emerald-300" style={{ animation: "scrape-sparkle 0.6s ease-out 0.2s forwards", opacity: 0 }} />
                    <span className="absolute bottom-1/3 left-1/3 w-2 h-2 rounded-full bg-emerald-500" style={{ animation: "scrape-sparkle 0.6s ease-out 0.3s forwards", opacity: 0 }} />
                    <span className="absolute bottom-1/4 right-1/4 w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ animation: "scrape-sparkle 0.6s ease-out 0.25s forwards", opacity: 0 }} />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-1">Scraping complete!</h3>
                  <p className="text-sm text-zinc-400 mb-4">{scrapingOverlay.stepText}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
                    onClick={handleDismissScrapingOverlay}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <Card className="relative overflow-hidden border-0 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl shadow-xl">
        <div className="absolute inset-0 rounded-xl border border-transparent bg-gradient-to-br from-emerald-500/20 via-transparent to-transparent bg-[length:200%_200%] animate-shimmer pointer-events-none" />
        <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-emerald-500/20 pointer-events-none" />
        <CardHeader className="relative">
          <CardTitle className="flex items-center gap-2 text-lg flex-wrap">
            <span className="flex items-center gap-2">
              <Workflow className="h-5 w-5 text-emerald-400 animate-pulse-glow" style={{ boxShadow: "0 0 12px rgba(16, 185, 129, 0.3)" }} />
              DesignCheck Intake Pipeline
            </span>
            <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
              AI-Powered
            </span>
          </CardTitle>
          <CardDescription>
            Agentic workflow status (Steps 1–5). Run a manual portal check to simulate the Portal Monitor Agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="relative space-y-0">
          {steps.map((step, i) => (
            <div
              key={i}
              className="flex gap-4 group transition-transform duration-200 hover:scale-[1.02]"
              style={{ animation: "fade-in-up 0.4s ease-out forwards", animationDelay: `${i * 100}ms`, opacity: 0 }}
            >
              <div className="flex flex-col items-center shrink-0">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300 group-hover:shadow-lg ${
                    step.status === "checking"
                      ? "border-emerald-500 bg-emerald-500/20 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)] [animation:spin_0.8s_linear_infinite]"
                      : step.status === "done"
                        ? "border-emerald-500 bg-emerald-500/20 text-emerald-500"
                        : step.status === "failed"
                          ? "border-red-500 bg-red-500/10 text-red-500 animate-status-shake"
                          : "border-muted-foreground/40 bg-muted/50 text-muted-foreground animate-pulse-glow"
                  }`}
                  style={step.status === "checking" ? { animation: "scrape-spin 0.8s linear infinite" } : undefined}
                >
                  {step.status === "checking" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : step.status === "done" ? (
                    <CheckCircle2 className="h-4 w-4" style={{ animation: "scrape-scale-check 0.3s ease-out" }} />
                  ) : step.status === "failed" ? (
                    <XCircle className="h-4 w-4" />
                  ) : (
                    <Circle className="h-4 w-4" />
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div className="w-0.5 flex-1 min-h-[24px] my-1 bg-border overflow-hidden">
                    <div
                      className="w-full bg-emerald-500/60 transition-all duration-500 ease-out min-h-0"
                      style={{ height: step.status === "done" ? "100%" : "0%" }}
                    />
                  </div>
                )}
              </div>
              <div className="pb-4 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium">{step.title}</p>
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                      step.status === "checking"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : step.status === "done"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : step.status === "failed"
                            ? "bg-red-500/10 text-red-400 border border-red-500/20"
                            : step.status === "waiting"
                              ? "bg-muted/50 text-muted-foreground border border-border animate-pulse-glow"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    }`}
                  >
                    {step.status === "checking" && <span className="inline-flex gap-0.5 mr-1"><span className="animate-pulse">.</span><span className="animate-pulse" style={{ animationDelay: "0.2s" }}>.</span><span className="animate-pulse" style={{ animationDelay: "0.4s" }}>.</span></span>}
                    {step.status === "done" && <CheckCircle2 className="h-3 w-3 mr-1 shrink-0" />}
                    {step.status === "failed" && <XCircle className="h-3 w-3 mr-1 shrink-0" />}
                    {step.status === "waiting" && "Waiting for Doc"}
                    {step.status === "pending" && "Pending"}
                    {step.status === "checking" && "Running"}
                    {step.status === "done" && "Complete"}
                    {step.status === "failed" && "Error"}
                    {!["checking", "done", "failed", "waiting", "pending"].includes(step.status) && "Idle"}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{step.description}</p>
                <div className="mt-2 [&_button]:transition-all [&_button]:duration-200 [&_button:hover]:-translate-y-0.5 [&_button:hover]:shadow-md [&_button:active]:scale-[0.98]">
                  {"action" in step && step.action}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}