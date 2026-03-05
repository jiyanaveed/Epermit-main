import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
  ExternalLink,
  XCircle,
  Workflow,
} from "lucide-react";
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

const SCRAPER_URL =
  "https://60319c1c-9adb-4aa0-a7f5-cc9fa75759e9-00-23cha9g730ax7.janeway.replit.dev";

type StepStatus =
  | "idle"
  | "checking"
  | "waiting"
  | "pending"
  | "done"
  | "failed";

type ChainPhase =
  | "idle"
  | "scraping"
  | "intake"
  | "classifier"
  | "enrichment"
  | "router"
  | "complete";

async function logChainFailure(
  projectId: string,
  agentName: string,
  errorMsg: string,
) {
  try {
    await supabase.functions.invoke("shadow-evaluator", {
      body: {
        action: "log_failure",
        project_id: projectId,
        agent_name: agentName,
        error_message: errorMsg,
      },
    });
  } catch (e) {
    console.error(`Failed to log chain failure for ${agentName}:`, e);
  }
}

export function AgentWorkflowStatus() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { selectedProjectId } = useSelectedProject();
  const queryClient = useQueryClient();

  const [portalStatus, setPortalStatus] = useState<StepStatus>("idle");
  const [portalStatusText, setPortalStatusText] = useState<string | null>(null);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(
    null,
  );
  const [parserRunning, setParserRunning] = useState(false);
  const [parserProgress, setParserProgress] = useState<{
    pdfIndex: number;
    totalPdfs: number;
  } | null>(null);
  const [firstJurisdiction, setFirstJurisdiction] = useState<string | null>(
    null,
  );
  const [latestProjectId, setLatestProjectId] = useState<string | null>(null);
  const [latestPermitNumber, setLatestPermitNumber] = useState<string | null>(
    null,
  );
  const [projectBySelectedId, setProjectBySelectedId] = useState<{
    id: string;
    permit_number: string | null;
  } | null>(null);

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
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const eventSourceRef = useRef<EventSource | null>(null);
  const onScrapingCompleteRef = useRef<(() => void) | null>(null);
  const doneDismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [chainPhase, setChainPhase] = useState<ChainPhase>("idle");
  const [chainError, setChainError] = useState<string | null>(null);
  const [isShadowMode, setIsShadowMode] = useState(false);
  const realtimeTriggeredRef = useRef(false);
  const chainPipelineRef = useRef<((projectId: string) => Promise<void>) | null>(null);

  useEffect(() => {
    const projectId = projectBySelectedId?.id ?? latestProjectId;
    if (!projectId) return;

    realtimeTriggeredRef.current = false;

    const channel = supabase
      .channel(`project-portal-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "projects",
          filter: `id=eq.${projectId}`,
        },
        (payload) => {
          const oldHash = (payload.old as Record<string, unknown>)?.portal_data_hash;
          const newHash = (payload.new as Record<string, unknown>)?.portal_data_hash;

          if (newHash && oldHash !== newHash && !realtimeTriggeredRef.current) {
            realtimeTriggeredRef.current = true;
            console.log("[Realtime] portal_data changed, auto-triggering chain for project:", projectId);
            toast.info("Portal data updated — auto-triggering agent chain...");
            loadDashboardData()
              .then(() => {
                if (chainPipelineRef.current) {
                  return chainPipelineRef.current(projectId);
                }
              })
              .catch((err) => {
                console.error("[Realtime] chain trigger failed:", err);
                toast.error("Auto-triggered chain failed. Try running manually.");
              })
              .finally(() => {
                realtimeTriggeredRef.current = false;
              });
          }
        },
      )
      .subscribe();

    return () => {
      realtimeTriggeredRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [projectBySelectedId?.id, latestProjectId]);

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

  const commentParserStatus: StepStatus =
    chainPhase === "intake"
      ? "checking"
      : commentParserFailed
        ? "failed"
        : parserRunning
          ? "checking"
          : parserSucceeded
            ? "done"
            : "waiting";

  const commentParserDescription =
    chainPhase === "intake"
      ? "Running (chained)..."
      : commentParserFailed
        ? "Failed"
        : parserRunning && parserProgress
          ? `Running... PDF ${parserProgress.pdfIndex}/${parserProgress.totalPdfs}`
          : parserSucceeded
            ? cp && (cp.parsed_count ?? 0) > 0
              ? `Complete (${cp.parsed_count} parsed / ${cp.skipped_count ?? 0} skipped)`
              : "Complete (No comments found)"
            : "Waiting for Doc";

  const rawClassifierStatus: StepStatus =
    chainPhase === "classifier"
      ? "checking"
      : classifierFailed
        ? "failed"
        : classifierDone
          ? "done"
          : "pending";

  const classifierStatus: StepStatus =
    commentParserStatus !== "done" && rawClassifierStatus === "done"
      ? "pending"
      : commentParserStatus !== "done" && rawClassifierStatus === "checking" && chainPhase !== "classifier"
        ? "pending"
        : rawClassifierStatus;

  const [enrichmentRunning, setEnrichmentRunning] = useState(false);
  const [enrichmentResult, setEnrichmentResult] = useState<number | null>(null);

  const { data: commentsForEnrichmentCheck } = useQuery({
    queryKey: ["parsed_comments_code_ref_check", selectedProjectId],
    queryFn: async (): Promise<
      { id: string; code_reference: string | null }[]
    > => {
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
    (commentsForEnrichmentCheck ?? []).every(
      (r) => (r.code_reference ?? "").trim().length > 0,
    );

  const rawEnrichmentStatus: StepStatus =
    chainPhase === "enrichment"
      ? "checking"
      : allCommentsHaveCodeRef
        ? "done"
        : enrichmentRunning
          ? "checking"
          : enrichmentResult != null
            ? "done"
            : "pending";

  const enrichmentStatus: StepStatus =
    classifierStatus !== "done" && (rawEnrichmentStatus === "done" || (rawEnrichmentStatus === "checking" && chainPhase !== "enrichment"))
      ? "pending"
      : rawEnrichmentStatus;

  const enrichmentDescription =
    enrichmentStatus === "pending" && rawEnrichmentStatus !== "pending"
      ? "Waiting for upstream steps"
      : chainPhase === "enrichment"
        ? "Running (chained)..."
        : allCommentsHaveCodeRef && enrichmentStatus === "done"
          ? "Complete (all have code refs)"
          : enrichmentRunning && enrichmentStatus === "checking"
            ? "Running..."
            : enrichmentResult != null && enrichmentStatus === "done"
              ? `Done (${enrichmentResult} enriched)`
              : "Enriches comments with code references and draft responses";

  const runEnrichment = useCallback(async () => {
    const projectIdToUse =
      selectedProjectId ?? projectBySelectedId?.id ?? latestProjectId;
    if (!projectIdToUse || !session?.access_token) {
      toast.error("Select a project and ensure you are logged in.");
      return;
    }
    setEnrichmentRunning(true);
    setEnrichmentResult(null);
    try {
      const { data: projRow } = await supabase
        .from("projects")
        .select("is_shadow_mode")
        .eq("id", projectIdToUse)
        .maybeSingle();
      const { data, error } = await supabase.functions.invoke(
        "context-reference-engine",
        {
          body: {
            projectId: projectIdToUse,
            is_shadow_mode: projRow?.is_shadow_mode === true,
          },
        },
      );
      if (error) throw error;
      const count = (data as { enriched_count?: number })?.enriched_count ?? 0;
      setEnrichmentResult(count);
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
      await queryClient.invalidateQueries({
        queryKey: ["parsed_comments_code_ref_check"],
      });
      toast.success(`${count} comment(s) enriched`);
    } catch (e) {
      console.warn("Context reference engine failed:", e);
      toast.error("Enrichment failed");
    } finally {
      setEnrichmentRunning(false);
    }
  }, [
    selectedProjectId,
    projectBySelectedId?.id,
    latestProjectId,
    session?.access_token,
    queryClient,
  ]);

  const [routerRunning, setRouterRunning] = useState(false);
  const [routerResult, setRouterResult] = useState<number | null>(null);

  const { data: commentsForRouterCheck } = useQuery({
    queryKey: ["parsed_comments_assigned_check", selectedProjectId],
    queryFn: async (): Promise<
      { id: string; assigned_to: string | null }[]
    > => {
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
    (commentsForRouterCheck ?? []).every(
      (r) => (r.assigned_to ?? "").trim().length > 0,
    );

  const rawRouterStatus: StepStatus =
    chainPhase === "router"
      ? "checking"
      : allCommentsHaveAssigned
        ? "done"
        : routerRunning
          ? "checking"
          : routerResult != null
            ? "done"
            : "pending";

  const routerStatus: StepStatus =
    enrichmentStatus !== "done" && (rawRouterStatus === "done" || (rawRouterStatus === "checking" && chainPhase !== "router"))
      ? "pending"
      : rawRouterStatus;

  const routerDescription =
    routerStatus === "pending" && rawRouterStatus !== "pending"
      ? "Waiting for upstream steps"
      : chainPhase === "router"
        ? "Running (chained)..."
        : allCommentsHaveAssigned && routerStatus === "done"
          ? "Complete (all assigned)"
          : routerRunning && routerStatus === "checking"
            ? "Running..."
            : routerResult != null && routerStatus === "done"
              ? `Done (${routerResult} routed)`
              : "Assigns comments to team members by discipline";

  const runAutoRoute = useCallback(async () => {
    const projectIdToUse =
      selectedProjectId ?? projectBySelectedId?.id ?? latestProjectId;
    if (!projectIdToUse || !session?.access_token) {
      toast.error("Select a project and ensure you are logged in.");
      return;
    }
    setRouterRunning(true);
    setRouterResult(null);
    try {
      const { data: projRow } = await supabase
        .from("projects")
        .select("is_shadow_mode")
        .eq("id", projectIdToUse)
        .maybeSingle();
      const { data, error } = await supabase.functions.invoke(
        "auto-router-agent",
        {
          body: {
            projectId: projectIdToUse,
            is_shadow_mode: projRow?.is_shadow_mode === true,
          },
        },
      );
      if (error) throw error;
      const count = (data as { routed_count?: number })?.routed_count ?? 0;
      setRouterResult(count);
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
      await queryClient.invalidateQueries({
        queryKey: ["parsed_comments_assigned_check"],
      });
      toast.success(`${count} comment(s) routed`);
    } catch (e) {
      console.warn("Auto-router agent failed:", e);
      toast.error("Auto-route failed");
    } finally {
      setRouterRunning(false);
    }
  }, [
    selectedProjectId,
    projectBySelectedId?.id,
    latestProjectId,
    session?.access_token,
    queryClient,
  ]);

  const classifierDescription =
    classifierStatus === "pending" && rawClassifierStatus === "done"
      ? "Waiting for upstream steps"
      : chainPhase === "classifier"
        ? "Running (chained)..."
        : classifierFailed
          ? "Failed"
          : classifierDone && classifierStatus === "done"
            ? dc && (dc.classified_count ?? 0) > 0
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
      setProjectBySelectedId(
        sel
          ? {
              id: sel.id as string,
              permit_number: (sel.permit_number as string) ?? null,
            }
          : null,
      );
    } else {
      setProjectBySelectedId(null);
    }
  }, [user, selectedProjectId]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const runChainedPipeline = useCallback(
    async (projectId: string) => {
      setChainError(null);

      const { data: projectRow } = await supabase
        .from("projects")
        .select("is_shadow_mode")
        .eq("id", projectId)
        .maybeSingle();
      const shadowActive = projectRow?.is_shadow_mode === true;
      setIsShadowMode(shadowActive);
      if (shadowActive) {
        toast.info("Shadow Mode active — all results will be logged to shadow tables.");
      }

      setChainPhase("intake");
      toast.info("Chain Step 2/5: Intake Pipeline (parsing PDFs)...");
      setParserRunning(true);
      setParserProgress(null);
      let cursor: { pdfIndex: number } | undefined;
      const pollIntervalMs = 2500;
      const maxRounds = 60;
      let totalParsed = 0;
      let totalSkipped = 0;
      let round = 0;
      let intakeFailed = false;
      try {
        while (round < maxRounds) {
          const { data: pipelineData, error: pipelineError } =
            await supabase.functions.invoke("intake-pipeline-agent", {
              body: {
                project_id: projectId,
                is_shadow_mode: shadowActive,
                ...(cursor && { cursor }),
              },
            });
          if (pipelineError) {
            console.warn("Intake pipeline error:", pipelineError);
            intakeFailed = true;
            const errMsg =
              typeof pipelineError === "string"
                ? pipelineError
                : pipelineError?.message ?? "Unknown intake error";
            setChainError(`Intake: ${errMsg}`);
            await logChainFailure(projectId, "intake-pipeline-agent", errMsg);
            break;
          }
          if (pipelineData == null) break;

          const cpData = pipelineData.comment_parser;
          const dcData = pipelineData.discipline_classifier;
          totalParsed += cpData?.parsed_count ?? 0;
          totalSkipped += cpData?.skipped_count ?? 0;
          setPipelineResult({
            comment_parser: {
              ...cpData,
              parsed_count: totalParsed,
              skipped_count: totalSkipped,
            },
            discipline_classifier: dcData,
          });

          if (
            cpData?.total_pdfs != null &&
            (cpData.next_cursor?.pdfIndex ?? 0) >= 0
          ) {
            setParserProgress({
              pdfIndex: cpData.next_cursor?.pdfIndex ?? 0,
              totalPdfs: cpData.total_pdfs,
            });
          }

          if (cpData?.done === true && !cpData?.error) {
            await queryClient.invalidateQueries({
              queryKey: ["parsed_comments"],
            });
            const classified = dcData?.classified_count ?? 0;
            if (totalParsed > 0 || classified > 0) {
              toast.success(
                `Intake complete: ${totalParsed} parsed, ${classified} classified.`,
              );
            }
            break;
          }

          if (cpData?.error && cpData.error !== "timeout") {
            intakeFailed = true;
            setChainError(`Parser: ${cpData.error}`);
            await logChainFailure(
              projectId,
              "comment-parser-agent",
              cpData.error,
            );
            break;
          }

          if (
            cpData?.error === "timeout" ||
            (cpData?.next_cursor != null && !cpData?.done)
          ) {
            cursor = cpData?.error === "timeout" ? undefined : cpData.next_cursor;
            await new Promise((r) => setTimeout(r, pollIntervalMs));
            round++;
            continue;
          }
          break;
        }
      } catch (e) {
        intakeFailed = true;
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn("Intake pipeline failed:", errMsg);
        setChainError(`Intake: ${errMsg}`);
        await logChainFailure(projectId, "intake-pipeline-agent", errMsg);
      } finally {
        setParserRunning(false);
        setParserProgress(null);
      }

      if (intakeFailed) {
        toast.error("Chain stopped: Intake Pipeline failed. Error logged.");
        setTimeout(() => setChainPhase("idle"), 8000);
        return;
      }

      setChainPhase("classifier");
      toast.info("Chain Step 3/5: Discipline Classifier...");
      let classifierFailed2 = false;
      try {
        const { data: classData, error: classError } =
          await supabase.functions.invoke("discipline-classifier-agent", {
            body: {
              project_id: projectId,
              is_shadow_mode: shadowActive,
            },
          });
        if (classError) {
          classifierFailed2 = true;
          const errMsg =
            typeof classError === "string"
              ? classError
              : classError?.message ?? "Unknown classifier error";
          setChainError(`Classifier: ${errMsg}`);
          await logChainFailure(
            projectId,
            "discipline-classifier-agent",
            errMsg,
          );
        } else {
          const classified =
            (classData as { classified_count?: number })?.classified_count ?? 0;
          setPipelineResult((prev) => ({
            ...prev,
            discipline_classifier: {
              classified_count: classified,
            },
          }));
          toast.success(`Classifier complete: ${classified} classified.`);
        }
      } catch (e) {
        classifierFailed2 = true;
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn("Discipline classifier failed:", errMsg);
        setChainError(`Classifier: ${errMsg}`);
        await logChainFailure(
          projectId,
          "discipline-classifier-agent",
          errMsg,
        );
      }

      if (classifierFailed2) {
        toast.error("Chain stopped: Classifier failed. Error logged.");
        setTimeout(() => setChainPhase("idle"), 8000);
        return;
      }

      setChainPhase("enrichment");
      toast.info("Chain Step 4/5: Context & Reference Engine...");
      setEnrichmentRunning(true);
      setEnrichmentResult(null);
      let enrichFailed = false;
      try {
        const { data: enrichData, error: enrichError } =
          await supabase.functions.invoke("context-reference-engine", {
            body: {
              projectId: projectId,
              is_shadow_mode: shadowActive,
            },
          });
        if (enrichError) {
          enrichFailed = true;
          const errMsg =
            typeof enrichError === "string"
              ? enrichError
              : enrichError?.message ?? "Unknown enrichment error";
          setChainError(`Enrichment: ${errMsg}`);
          await logChainFailure(
            projectId,
            "context-reference-engine",
            errMsg,
          );
        } else {
          const count =
            (enrichData as { enriched_count?: number })?.enriched_count ?? 0;
          setEnrichmentResult(count);
          await queryClient.invalidateQueries({
            queryKey: ["parsed_comments"],
          });
          await queryClient.invalidateQueries({
            queryKey: ["parsed_comments_code_ref_check"],
          });
          toast.success(`Enrichment complete: ${count} enriched.`);
        }
      } catch (e) {
        enrichFailed = true;
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn("Context reference engine failed:", errMsg);
        setChainError(`Enrichment: ${errMsg}`);
        await logChainFailure(projectId, "context-reference-engine", errMsg);
      } finally {
        setEnrichmentRunning(false);
      }

      if (enrichFailed) {
        toast.error("Chain stopped: Enrichment failed. Error logged.");
        setTimeout(() => setChainPhase("idle"), 8000);
        return;
      }

      setChainPhase("router");
      toast.info("Chain Step 5/5: Auto-Router Agent...");
      setRouterRunning(true);
      setRouterResult(null);
      let routeFailed = false;
      try {
        const { data: routeData, error: routeError } =
          await supabase.functions.invoke("auto-router-agent", {
            body: {
              projectId: projectId,
              is_shadow_mode: shadowActive,
            },
          });
        if (routeError) {
          routeFailed = true;
          const errMsg =
            typeof routeError === "string"
              ? routeError
              : routeError?.message ?? "Unknown router error";
          setChainError(`Router: ${errMsg}`);
          await logChainFailure(projectId, "auto-router-agent", errMsg);
        } else {
          const count =
            (routeData as { routed_count?: number })?.routed_count ?? 0;
          setRouterResult(count);
          await queryClient.invalidateQueries({
            queryKey: ["parsed_comments"],
          });
          await queryClient.invalidateQueries({
            queryKey: ["parsed_comments_assigned_check"],
          });
          toast.success(`Auto-Router complete: ${count} routed.`);
        }
      } catch (e) {
        routeFailed = true;
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn("Auto-router agent failed:", errMsg);
        setChainError(`Router: ${errMsg}`);
        await logChainFailure(projectId, "auto-router-agent", errMsg);
      } finally {
        setRouterRunning(false);
      }

      if (routeFailed) {
        toast.error("Chain stopped: Auto-Router failed. Error logged.");
        setTimeout(() => setChainPhase("idle"), 8000);
        return;
      }

      setChainPhase("complete");
      toast.success(
        shadowActive
          ? "Full chain complete! All results logged to shadow tables."
          : "Full chain complete! All agents finished successfully.",
      );
      toast.info("View scraped data on the Portal Data page.", {
        action: {
          label: "View",
          onClick: () => navigate("/portal-data"),
        },
      });
      setTimeout(() => setChainPhase("idle"), 5000);
    },
    [queryClient, navigate],
  );

  useEffect(() => {
    chainPipelineRef.current = runChainedPipeline;
  }, [runChainedPipeline]);

  const runManualCheck = async () => {
    const projectIdToUse = projectBySelectedId?.id ?? latestProjectId;
    const permitNumberToUse =
      projectBySelectedId?.permit_number ?? latestPermitNumber;

    if (!projectIdToUse) {
      toast.error(
        "No project found. Select a project in the sidebar or create one first.",
      );
      return;
    }

    if (!session?.access_token) {
      toast.error("You must be logged in to run this check.");
      return;
    }

    if (!permitNumberToUse || String(permitNumberToUse).trim() === "") {
      toast.error(
        "Permit # is required. Set it in the sidebar: select the project, then enter Permit # under the project dropdown.",
      );
      return;
    }

    setChainPhase("scraping");
    setChainError(null);
    setPipelineResult(null);
    setEnrichmentResult(null);
    setRouterResult(null);
    setPortalStatus("checking");
    setPortalStatusText("Connecting...");
    toast.info("Chain Step 1/5: Portal Scraping...");

    try {
      const { data: credentials, error: credError } = await supabase
        .from("portal_credentials")
        .select("portal_username, portal_password, permit_number, project_id, login_url, jurisdiction")
        .eq("user_id", user!.id);

      if (credError) throw new Error("Failed to load portal credentials");
      if (!credentials?.length)
        throw new Error(
          "No portal credentials found. Add credentials in Settings.",
        );

      const cred = credentials.find((c) => c.project_id === projectIdToUse);
      if (!cred) {
        throw new Error(
          "No portal credentials found for this project. Please add credentials in Settings and link them to this project.",
        );
      }

      const loginUrl = cred.login_url?.trim();
      if (!loginUrl) {
        throw new Error(
          `Missing Portal URL for ${cred.jurisdiction || "this jurisdiction"}. Please update Settings.`,
        );
      }

      const username = cred.portal_username;
      const password = cred.portal_password;

      toast.info("Logging into portal...");

      let loginRes: Response;
      try {
        loginRes = await fetch(`${SCRAPER_URL}/api/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, portalUrl: loginUrl }),
        });
      } catch (fetchErr) {
        throw new Error("SCRAPER_OFFLINE");
      }

      if (!loginRes.ok) {
        const errData = await loginRes.json().catch(() => ({}));
        throw new Error(
          errData.error || `Scraper login failed (${loginRes.status})`,
        );
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
              else if (msg.includes("→ Reports"))
                stepText = "Scraping Reports tab...";
              else if (msg.includes("→ Status"))
                stepText = "Scraping Status tab...";
              else if (msg.includes("→ Files"))
                stepText = "Scraping Files tab...";
              else if (msg.includes("→ Tasks"))
                stepText = "Scraping Tasks tab...";
              else stepText = msg;
            }
            const currentKey = msg.includes("→ Reports")
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

      const pollInterval = 1000;
      const maxAttempts = 180;
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
              : null,
          );
          onScrapingCompleteRef.current = async () => {
            setPortalStatusText("Done");
            setPortalStatus("done");
            toast.success(
              `Scraping complete! ${tabsExtracted} tab${tabsExtracted === 1 ? "" : "s"} extracted. Data saved.`,
            );
            await loadDashboardData();
            await runChainedPipeline(projectIdToUse);
          };
          return true;
        }
        if (data.status === "error") {
          throw new Error(data.message || "Scraping failed");
        }
        const total = data.total ?? 0;
        const progress = data.progress ?? 0;
        const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
        setPortalStatusText(
          pct > 0 ? `Scraping... ${pct}%` : data.message || "Scraping...",
        );
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
      setChainPhase("idle");
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
      setChainPhase("idle");
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const projectId = projectBySelectedId?.id ?? latestProjectId;
      if (projectId) {
        await logChainFailure(projectId, "portal-scraper", msg);
      }
      const isOffline =
        msg === "SCRAPER_OFFLINE" ||
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError") ||
        msg.includes("Network request failed");
      if (isOffline) {
        toast.error(
          "Local Scraper is not running. Run 'node server.js' in the scraper-service folder, then retry.",
        );
      } else {
        toast.error(
          msg
            ? `${msg} Try again or check your connection.`
            : "Something went wrong. Try again.",
        );
      }
    }
  };

  const chainRunning = chainPhase !== "idle" && chainPhase !== "complete";

  const steps = [
    {
      title: "Portal Monitor Agent",
      status: portalStatus,
      description:
        portalStatus === "checking"
          ? chainPhase === "scraping"
            ? "Scraping (Step 1/5)"
            : "Running"
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
            disabled={portalStatus === "checking" || chainRunning}
            data-testid="button-run-manual-check"
            className="group/btn transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
          >
            {portalStatus === "checking" || chainRunning ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2 transition-transform duration-300 group-hover/btn:rotate-180" />
            )}
            {chainRunning ? "Chain Running..." : "Run Manual Check"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            asChild
            className="group/btn transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
          >
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
        <Button size="sm" variant="outline" asChild className="mt-2" data-testid="link-comment-review">
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
        <Button size="sm" variant="outline" asChild className="mt-2" data-testid="link-classified-comments">
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
          disabled={enrichmentRunning || !selectedProjectId || chainRunning}
          data-testid="button-run-enrichment"
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
          disabled={routerRunning || !selectedProjectId || chainRunning}
          data-testid="button-run-auto-route"
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
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-emerald-600/5 pointer-events-none" />
            <div
              className="absolute inset-0 opacity-30 pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.15) 0%, transparent 60%)",
                animation: "scrape-pulse-glow 2s ease-in-out infinite",
              }}
            />

            <div className="relative p-6 space-y-5">
              {scrapingOverlay.phase === "scraping" ? (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">
                      Scraping portal
                    </h3>
                    <span className="text-sm font-mono text-emerald-400 tabular-nums">
                      {formatElapsed(scrapingElapsed)}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400">
                    Project:{" "}
                    <span className="font-medium text-emerald-400">
                      {scrapingOverlay.projectNum}
                    </span>
                  </p>
                  <div className="flex items-center gap-3">
                    <div
                      className="h-5 w-5 shrink-0 rounded-full border-2 border-emerald-500 border-t-transparent"
                      style={{ animation: "scrape-spin 0.8s linear infinite" }}
                    />
                    <p className="text-sm text-zinc-300">
                      {scrapingOverlay.stepText}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 rounded-full bg-zinc-700 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500 ease-out"
                        style={{
                          width: `${scrapingOverlay.total > 0 ? Math.round((scrapingOverlay.progress / scrapingOverlay.total) * 100) : 0}%`,
                          animation:
                            "scrape-pulse-glow 1.5s ease-in-out infinite",
                        }}
                      />
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {TAB_STEPS.map((tab) => {
                      const done = scrapingOverlay.completedSteps.has(tab.key);
                      const current =
                        scrapingOverlay.currentStepKey === tab.key;
                      return (
                        <li
                          key={tab.key}
                          className="flex items-center gap-3 text-sm"
                          style={
                            done
                              ? {
                                  animation:
                                    "scrape-fade-in-up 0.3s ease-out forwards",
                                }
                              : undefined
                          }
                        >
                          {done ? (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                          ) : current ? (
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500"
                              style={{
                                animation:
                                  "scrape-pulse-dot 1s ease-in-out infinite",
                              }}
                            />
                          ) : (
                            <Circle className="h-5 w-5 shrink-0 text-zinc-500" />
                          )}
                          <span
                            className={
                              done
                                ? "text-zinc-300"
                                : current
                                  ? "text-emerald-400 font-medium"
                                  : "text-zinc-500"
                            }
                          >
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
                    style={{
                      animation: "scrape-scale-check 0.4s ease-out forwards",
                    }}
                  >
                    <CheckCircle2 className="h-10 w-10" strokeWidth={2} />
                  </div>
                  <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl">
                    <span
                      className="absolute top-1/4 left-1/4 w-2 h-2 rounded-full bg-emerald-400"
                      style={{
                        animation: "scrape-sparkle 0.6s ease-out 0.1s forwards",
                        opacity: 0,
                      }}
                    />
                    <span
                      className="absolute top-1/3 right-1/3 w-1.5 h-1.5 rounded-full bg-emerald-300"
                      style={{
                        animation: "scrape-sparkle 0.6s ease-out 0.2s forwards",
                        opacity: 0,
                      }}
                    />
                    <span
                      className="absolute bottom-1/3 left-1/3 w-2 h-2 rounded-full bg-emerald-500"
                      style={{
                        animation: "scrape-sparkle 0.6s ease-out 0.3s forwards",
                        opacity: 0,
                      }}
                    />
                    <span
                      className="absolute bottom-1/4 right-1/4 w-1.5 h-1.5 rounded-full bg-emerald-400"
                      style={{
                        animation:
                          "scrape-sparkle 0.6s ease-out 0.25s forwards",
                        opacity: 0,
                      }}
                    />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-1">
                    Scraping complete!
                  </h3>
                  <p className="text-sm text-zinc-400 mb-1">
                    {scrapingOverlay.stepText}
                  </p>
                  <p className="text-xs text-emerald-400 mb-4">
                    Launching agent chain...
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
                    onClick={handleDismissScrapingOverlay}
                    data-testid="button-dismiss-scraping"
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
              <Workflow
                className="h-5 w-5 text-emerald-400 animate-pulse-glow"
                style={{ boxShadow: "0 0 12px rgba(16, 185, 129, 0.3)" }}
              />
              DesignCheck Intake Pipeline
            </span>
            <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
              AI-Powered
            </span>
            {chainRunning && (
              <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400 animate-pulse" data-testid="badge-chain-running">
                Chain Active
              </span>
            )}
            {chainPhase === "complete" && (
              <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400" data-testid="badge-chain-complete">
                Chain Complete
              </span>
            )}
            {isShadowMode && chainPhase !== "idle" && (
              <span className="inline-flex items-center rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-xs font-medium text-purple-400" data-testid="badge-shadow-mode">
                Shadow Mode
              </span>
            )}
          </CardTitle>
          <CardDescription>
            {chainRunning
              ? `Agent chain in progress — ${chainPhase} step active. All agents fire sequentially.`
              : "Agentic workflow status (Steps 1-5). Run a manual portal check to trigger the full chain."}
          </CardDescription>
          {chainError && (
            <p className="text-xs text-red-400 mt-1" data-testid="text-chain-error">
              Last error: {chainError}
            </p>
          )}
        </CardHeader>
        <CardContent className="relative space-y-0">
          {steps.map((step, i) => (
            <div
              key={i}
              className="flex gap-4 group transition-transform duration-200 hover:scale-[1.02]"
              style={{
                animation: "fade-in-up 0.4s ease-out forwards",
                animationDelay: `${i * 100}ms`,
                opacity: 0,
              }}
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
                  style={
                    step.status === "checking"
                      ? { animation: "scrape-spin 0.8s linear infinite" }
                      : undefined
                  }
                >
                  {step.status === "checking" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : step.status === "done" ? (
                    <CheckCircle2
                      className="h-4 w-4"
                      style={{ animation: "scrape-scale-check 0.3s ease-out" }}
                    />
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
                    {step.status === "checking" && (
                      <span className="inline-flex gap-0.5 mr-1">
                        <span className="animate-pulse">.</span>
                        <span
                          className="animate-pulse"
                          style={{ animationDelay: "0.2s" }}
                        >
                          .
                        </span>
                        <span
                          className="animate-pulse"
                          style={{ animationDelay: "0.4s" }}
                        >
                          .
                        </span>
                      </span>
                    )}
                    {step.status === "done" && (
                      <CheckCircle2 className="h-3 w-3 mr-1 shrink-0" />
                    )}
                    {step.status === "failed" && (
                      <XCircle className="h-3 w-3 mr-1 shrink-0" />
                    )}
                    {step.status === "waiting" && "Waiting for Doc"}
                    {step.status === "pending" && "Pending"}
                    {step.status === "checking" && "Running"}
                    {step.status === "done" && "Complete"}
                    {step.status === "failed" && "Error"}
                    {![
                      "checking",
                      "done",
                      "failed",
                      "waiting",
                      "pending",
                    ].includes(step.status) && "Idle"}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {step.description}
                </p>
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
