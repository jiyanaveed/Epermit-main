import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { supabase } from "@/lib/supabase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  RefreshCw,
  Shield,
  Activity,
  BarChart3,
  Clock,
  Target,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader2,
  TrendingUp,
  FileDown,
  Info,
  FolderKanban,
} from "lucide-react";

interface OverallMetrics {
  total_predictions: number;
  matches: number;
  partials: number;
  mismatches: number;
  pending: number;
  accuracy_percent: number;
  avg_confidence: number;
}

interface AgentPerformance {
  agent_name: string;
  predictions: number;
  matches: number;
  partials: number;
  mismatches: number;
  pending: number;
  accuracy: number;
  avg_confidence: number;
}

interface BaselineMetrics {
  total_baselines: number;
  unique_disciplines: number;
  baseline_coverage_percent: number;
}

interface AuditEntry {
  id: string;
  action_type: string;
  routing_decision: string;
  created_at: string;
}

interface ShadowPrediction {
  id: string;
  comment_id: string;
  agent_name: string;
  project_id: string;
  prediction_data: {
    ai_discipline?: string;
    portal_discipline?: string;
    [key: string]: unknown;
  };
  match_status: string;
  confidence_score: number;
  created_at: string;
  parsed_comments?: {
    original_text?: string;
  };
}

type ActiveFilter = "total" | "accuracy" | "confidence" | "mismatches";

interface ShadowMetricsData {
  overall: OverallMetrics;
  agent_performance: AgentPerformance[];
  baseline: BaselineMetrics;
  recent_audit: AuditEntry[];
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant = "default",
  active = false,
  glowColor,
  onClick,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: typeof Activity;
  variant?: "default" | "success" | "warning" | "danger";
  active?: boolean;
  glowColor?: string;
  onClick?: () => void;
}) {
  const variantStyles = {
    default: "border-border",
    success: "border-green-500/30 bg-green-500/5",
    warning: "border-yellow-500/30 bg-yellow-500/5",
    danger: "border-red-500/30 bg-red-500/5",
  };
  const iconStyles = {
    default: "text-muted-foreground",
    success: "text-green-500",
    warning: "text-yellow-500",
    danger: "text-red-500",
  };

  return (
    <Card
      className={`${variantStyles[variant]} cursor-pointer transition-transform duration-150 hover:scale-[1.03] ${active && glowColor ? `ring-2 ${glowColor} shadow-lg` : ""}`}
      data-testid={`stat-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className={`h-4 w-4 ${iconStyles[variant]}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`stat-value-${title.toLowerCase().replace(/\s+/g, "-")}`}>{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MatchStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "match":
      return (
        <Badge variant="outline" className="border-green-500 text-green-600 bg-green-500/10">
          <CheckCircle className="h-3 w-3 mr-1" /> Match
        </Badge>
      );
    case "partial":
      return (
        <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-500/10">
          <AlertTriangle className="h-3 w-3 mr-1" /> Partial
        </Badge>
      );
    case "mismatch":
      return (
        <Badge variant="outline" className="border-red-500 text-red-600 bg-red-500/10">
          <XCircle className="h-3 w-3 mr-1" /> Mismatch
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          <Clock className="h-3 w-3 mr-1" /> Pending
        </Badge>
      );
  }
}

export default function ShadowModeDashboard() {
  useAuth();
  const navigate = useNavigate();
  const { projects } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("total");
  const [data, setData] = useState<ShadowMetricsData | null>(null);
  const [predictions, setPredictions] = useState<ShadowPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const fetchPredictions = useCallback(async (projectId: string | null) => {
    try {
      let query = supabase
        .from("shadow_predictions")
        .select("id, comment_id, agent_name, project_id, prediction_data, match_status, confidence_score, created_at, parsed_comments(original_text)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (projectId) query = query.eq("project_id", projectId);
      const { data: rows, error: fetchErr } = await query;
      if (fetchErr) throw fetchErr;
      setPredictions((rows as unknown as ShadowPrediction[]) ?? []);
    } catch (err) {
      console.error("Failed to fetch shadow predictions:", err);
    }
  }, []);

  const fetchMetrics = useCallback(async (projectId: string | null, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const body: Record<string, string> = {};
      if (projectId) body.project_id = projectId;
      const { data: result, error: fnError } = await supabase.functions.invoke(
        "shadow-metrics",
        { body }
      );
      if (fnError) throw fnError;
      setData(result as ShadowMetricsData);
    } catch (err) {
      console.error("Failed to fetch shadow metrics:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load shadow metrics"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics(selectedProjectId);
    fetchPredictions(selectedProjectId);
  }, [fetchMetrics, fetchPredictions, selectedProjectId]);

  const exportPredictionsCSV = useCallback(() => {
    if (predictions.length === 0) return;
    const headers = ["Comment Snippet", "AI Prediction", "Human Baseline", "Status", "Confidence", "Date"];
    const rows = predictions.map((p) => [
      (p.parsed_comments?.original_text || "—").slice(0, 120).replace(/"/g, '""'),
      p.prediction_data?.ai_discipline || "—",
      p.prediction_data?.portal_discipline || "—",
      p.match_status,
      (p.confidence_score * 100).toFixed(1) + "%",
      new Date(p.created_at).toLocaleDateString(),
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shadow-mode-report-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [predictions]);

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-7xl space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-32 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const overall = data?.overall ?? {
    total_predictions: 0,
    matches: 0,
    partials: 0,
    mismatches: 0,
    pending: 0,
    accuracy_percent: 0,
    avg_confidence: 0,
  };
  const agents = data?.agent_performance ?? [];
  const baseline = data?.baseline ?? {
    total_baselines: 0,
    unique_disciplines: 0,
    baseline_coverage_percent: 0,
  };
  const recentAudit = data?.recent_audit ?? [];

  const toggleFilter = (filter: ActiveFilter) => {
    setActiveFilter((prev) => (prev === filter ? "total" : filter));
  };

  const displayedPredictions = (() => {
    let result = [...predictions];
    if (activeFilter === "mismatches") {
      result = result.filter((p) => p.match_status === "mismatch");
    } else if (activeFilter === "accuracy") {
      result = result.filter((p) => p.match_status === "match");
    } else if (activeFilter === "confidence") {
      result.sort((a, b) => (a.confidence_score ?? 0) - (b.confidence_score ?? 0));
    }
    return result;
  })();

  const projectPermitMap = new Map((projects ?? []).map((p) => [p.id, p.permit_number || p.name]));

  const toggleRowExpand = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-6" data-testid="shadow-mode-dashboard">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/admin")}
            data-testid="button-back-admin"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              Shadow Mode Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              AI pipeline testing & baseline comparison
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportPredictionsCSV}
            disabled={predictions.length === 0}
            data-testid="button-export-report"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Weekly Report
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { fetchMetrics(selectedProjectId, true); fetchPredictions(selectedProjectId); }}
            disabled={refreshing}
            data-testid="button-refresh-metrics"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4" data-testid="text-explainer">
        <Info className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <p className="text-sm text-muted-foreground leading-relaxed">
          Shadow Mode safely runs the AI pipeline in parallel with historical human data. It compares the AI's autonomous classifications against actual expeditor decisions to mathematically prove system accuracy before live deployment.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <FolderKanban className="h-4 w-4 text-muted-foreground" />
        <Select
          value={selectedProjectId ?? "__all__"}
          onValueChange={(v) => setSelectedProjectId(v === "__all__" ? null : v)}
        >
          <SelectTrigger className="w-[320px]" data-testid="select-shadow-project">
            <SelectValue placeholder="Filter by project..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Projects</SelectItem>
            {(projects ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedProjectId && (
          <Badge variant="secondary" className="text-xs">
            Filtered
          </Badge>
        )}
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-6">
            <p className="text-red-600 text-sm" data-testid="text-error-message">{error}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Predictions"
          value={overall.total_predictions}
          subtitle={`Processed ${overall.total_predictions} comments, with ${overall.pending} currently awaiting a human baseline.`}
          icon={Activity}
          active={activeFilter === "total"}
          glowColor="ring-blue-500/60"
          onClick={() => toggleFilter("total")}
        />
        <StatCard
          title="Overall Accuracy"
          value={`${overall.accuracy_percent}%`}
          subtitle={`The AI matched the human expeditor on ${overall.matches} out of ${overall.total_predictions - overall.pending} actionable comments.`}
          icon={Target}
          variant={
            overall.accuracy_percent >= 80
              ? "success"
              : overall.accuracy_percent >= 50
                ? "warning"
                : "danger"
          }
          active={activeFilter === "accuracy"}
          glowColor="ring-[#FF6B2B]/60"
          onClick={() => toggleFilter("accuracy")}
        />
        <StatCard
          title="Avg Confidence"
          value={`${(overall.avg_confidence * 100).toFixed(0)}%`}
          subtitle={`The LLM is operating with ${(overall.avg_confidence * 100).toFixed(0)}% self-reported certainty.`}
          icon={TrendingUp}
          variant={
            overall.avg_confidence >= 0.8
              ? "success"
              : overall.avg_confidence >= 0.6
                ? "warning"
                : "danger"
          }
          active={activeFilter === "confidence"}
          glowColor="ring-green-500/60"
          onClick={() => toggleFilter("confidence")}
        />
        <StatCard
          title="Mismatches"
          value={overall.mismatches}
          subtitle={`The AI had ${overall.mismatches} direct disagreement${overall.mismatches !== 1 ? "s" : ""} with the human expeditor.`}
          icon={AlertTriangle}
          variant={overall.mismatches > 0 ? "danger" : "success"}
          active={activeFilter === "mismatches"}
          glowColor="ring-red-500/60"
          onClick={() => toggleFilter("mismatches")}
        />
      </div>

      <Card data-testid="card-agent-performance" className="py-0">
        <div className="flex items-center gap-3 px-4 py-2 border-b">
          <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium whitespace-nowrap">Agent Performance</span>
          {agents.length === 0 ? (
            <span className="text-xs text-muted-foreground">No predictions yet</span>
          ) : (
            <div className="flex items-center gap-4 overflow-x-auto flex-1">
              {agents.map((agent) => (
                <div key={agent.agent_name} className="flex items-center gap-2 shrink-0" data-testid={`agent-row-${agent.agent_name.toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className="text-xs text-muted-foreground truncate max-w-[140px]">{agent.agent_name}</span>
                  <Progress value={agent.accuracy} className="h-1.5 w-20" />
                  <Badge variant={agent.accuracy >= 80 ? "default" : agent.accuracy >= 50 ? "secondary" : "destructive"} className="text-[10px] px-1.5 py-0">
                    {agent.accuracy}%
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{agent.predictions}p</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card data-testid="card-baseline-metrics" className="py-0">
        <div className="flex items-center gap-3 px-4 py-3">
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium whitespace-nowrap">Baseline Metrics</span>
          {baseline.total_baselines === 0 && baseline.unique_disciplines === 0 ? (
            <span className="text-xs text-muted-foreground">No human baseline data recorded</span>
          ) : (
            <div className="flex items-center gap-6 flex-1">
              <div className="flex flex-col" data-testid="text-total-baselines">
                <span className="text-xs"><span className="font-semibold">{baseline.total_baselines}</span> <span className="text-muted-foreground">total baselines</span></span>
                <span className="text-[10px] text-muted-foreground leading-tight">Comments explicitly categorized by the human expeditor in the portal.</span>
              </div>
              <div className="flex flex-col" data-testid="text-unique-disciplines">
                <span className="text-xs"><span className="font-semibold">{baseline.unique_disciplines}</span> <span className="text-muted-foreground">unique disciplines</span></span>
                <span className="text-[10px] text-muted-foreground leading-tight">Distinct routing departments utilized by the human.</span>
              </div>
              <div className="flex flex-col" data-testid="text-baseline-coverage">
                <span className="text-xs"><span className="font-semibold">{baseline.baseline_coverage_percent}%</span> <span className="text-muted-foreground">baseline coverage</span></span>
                <span className="text-[10px] text-muted-foreground leading-tight">Percentage of the total comments the human actually addressed.</span>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card data-testid="card-prediction-comparison">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Prediction Comparison
              </CardTitle>
              <CardDescription>
                Side-by-side view of AI predictions vs. human expeditor decisions
              </CardDescription>
            </div>
            {activeFilter !== "total" && (
              <Badge variant="outline" className="text-xs" data-testid="badge-active-filter">
                {activeFilter === "mismatches" && "Showing Mismatches Only"}
                {activeFilter === "accuracy" && "Showing Matches Only"}
                {activeFilter === "confidence" && "Sorted by Confidence ↑"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {displayedPredictions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {predictions.length === 0
                ? "No predictions recorded yet. Enable Shadow Mode on a project and run the pipeline to see results."
                : "No rows match the active filter."}
            </p>
          ) : (
            <div className="rounded-md border overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Comment Snippet</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>AI Prediction</TableHead>
                    <TableHead>Human Baseline</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedPredictions.map((pred) => {
                    const fullText = pred.parsed_comments?.original_text || "—";
                    const isLong = fullText.length > 120;
                    const isExpanded = expandedRows.has(pred.id);
                    return (
                      <TableRow key={pred.id} data-testid={`prediction-row-${pred.id}`}>
                        <TableCell className="text-sm max-w-[280px] align-top">
                          <div data-testid={`text-comment-snippet-${pred.id}`}>
                            <span className={isExpanded ? "" : "line-clamp-2"}>{fullText}</span>
                            {isLong && (
                              <button
                                className="text-xs text-primary hover:underline mt-0.5 block"
                                onClick={() => toggleRowExpand(pred.id)}
                                data-testid={`button-expand-${pred.id}`}
                              >
                                {isExpanded ? "Show less" : "Read more"}
                              </button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap align-top" data-testid={`text-project-${pred.id}`}>
                          {projectPermitMap.get(pred.project_id) || pred.project_id?.slice(0, 8) || "—"}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant="outline" className="font-mono text-xs" data-testid={`text-ai-prediction-${pred.id}`}>
                            {pred.prediction_data?.ai_discipline || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top">
                          {pred.prediction_data?.portal_discipline ? (
                            <Badge variant="secondary" className="font-mono text-xs" data-testid={`text-human-baseline-${pred.id}`}>
                              {pred.prediction_data.portal_discipline}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground" data-testid={`text-human-baseline-${pred.id}`}>No baseline</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-mono align-top" data-testid={`text-confidence-${pred.id}`}>
                          {(pred.confidence_score * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="align-top" data-testid={`badge-status-${pred.id}`}>
                          <MatchStatusBadge status={pred.match_status} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-audit-trail">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Recent Audit Trail
          </CardTitle>
          <CardDescription>
            Last 50 pipeline actions (immutable log)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No audit entries yet. Run the pipeline to generate entries.
            </p>
          ) : (
            <div className="rounded-md border overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Routing</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentAudit.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-sm">
                        {entry.action_type}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            entry.routing_decision === "live_update"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {entry.routing_decision}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(entry.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
