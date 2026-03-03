import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
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
  Users,
  TrendingUp,
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
  total_actions: number;
  avg_time_per_comment_minutes: number;
  total_duration_minutes: number;
  unique_expeditors: number;
}

interface AuditEntry {
  id: string;
  action_type: string;
  routing_decision: string;
  created_at: string;
}

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
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: typeof Activity;
  variant?: "default" | "success" | "warning" | "danger";
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
    <Card className={variantStyles[variant]} data-testid={`stat-card-${title.toLowerCase().replace(/\s+/g, "-")}`}>
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
  const [data, setData] = useState<ShadowMetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const { data: result, error: fnError } = await supabase.functions.invoke(
        "shadow-metrics",
        { body: {} }
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
    fetchMetrics();
  }, [fetchMetrics]);

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
    total_actions: 0,
    avg_time_per_comment_minutes: 0,
    total_duration_minutes: 0,
    unique_expeditors: 0,
  };
  const recentAudit = data?.recent_audit ?? [];

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
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchMetrics(true)}
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
          subtitle={`${overall.pending} still pending`}
          icon={Activity}
        />
        <StatCard
          title="Overall Accuracy"
          value={`${overall.accuracy_percent}%`}
          subtitle={`${overall.matches} matches, ${overall.partials} partials`}
          icon={Target}
          variant={
            overall.accuracy_percent >= 80
              ? "success"
              : overall.accuracy_percent >= 50
                ? "warning"
                : "danger"
          }
        />
        <StatCard
          title="Avg Confidence"
          value={overall.avg_confidence.toFixed(2)}
          subtitle="LLM self-reported score"
          icon={TrendingUp}
          variant={
            overall.avg_confidence >= 0.8
              ? "success"
              : overall.avg_confidence >= 0.6
                ? "warning"
                : "danger"
          }
        />
        <StatCard
          title="Mismatches"
          value={overall.mismatches}
          subtitle={
            overall.total_predictions > 0
              ? `${Math.round((overall.mismatches / overall.total_predictions) * 100)}% of total`
              : "No data yet"
          }
          icon={AlertTriangle}
          variant={overall.mismatches > 0 ? "danger" : "success"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-agent-performance">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Agent Performance
            </CardTitle>
            <CardDescription>
              Breakdown by AI agent across all shadow predictions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {agents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No shadow predictions recorded yet. Enable Shadow Mode on a
                project and run the pipeline.
              </p>
            ) : (
              <div className="space-y-6">
                {agents.map((agent) => (
                  <div key={agent.agent_name} className="space-y-2" data-testid={`agent-row-${agent.agent_name.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {agent.agent_name}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {agent.predictions} predictions
                        </span>
                        <Badge
                          variant={
                            agent.accuracy >= 80
                              ? "default"
                              : agent.accuracy >= 50
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {agent.accuracy}%
                        </Badge>
                      </div>
                    </div>
                    <Progress
                      value={agent.accuracy}
                      className="h-2"
                    />
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span className="text-green-600">
                        {agent.matches} match
                      </span>
                      <span className="text-yellow-600">
                        {agent.partials} partial
                      </span>
                      <span className="text-red-600">
                        {agent.mismatches} mismatch
                      </span>
                      <span>{agent.pending} pending</span>
                      <span className="ml-auto">
                        Conf: {agent.avg_confidence.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-baseline-metrics">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Baseline Metrics
            </CardTitle>
            <CardDescription>
              Human expeditor performance for comparison
            </CardDescription>
          </CardHeader>
          <CardContent>
            {baseline.total_actions === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No baseline actions recorded yet. Expeditor activity will appear
                here once tracked.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border p-4 text-center">
                    <p className="text-2xl font-bold" data-testid="text-avg-time">
                      {baseline.avg_time_per_comment_minutes}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Avg min per comment
                    </p>
                  </div>
                  <div className="rounded-lg border p-4 text-center">
                    <p className="text-2xl font-bold" data-testid="text-total-actions">
                      {baseline.total_actions}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Total actions
                    </p>
                  </div>
                  <div className="rounded-lg border p-4 text-center">
                    <p className="text-2xl font-bold" data-testid="text-total-duration">
                      {baseline.total_duration_minutes}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Total minutes
                    </p>
                  </div>
                  <div className="rounded-lg border p-4 text-center">
                    <p className="text-2xl font-bold flex items-center justify-center gap-1" data-testid="text-unique-expeditors">
                      <Users className="h-4 w-4" />
                      {baseline.unique_expeditors}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Expeditors
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
