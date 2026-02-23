import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface ProjectHealthCardProps {
  projectId: string | null;
}

interface ProjectRow {
  id: string;
  last_checked_at: string | null;
  deadline: string | null;
}

interface CommentRow {
  id: string;
  status: string | null;
  response_text: string | null;
}

function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function hoursBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (1000 * 60 * 60));
}

export function ProjectHealthCard({ projectId }: ProjectHealthCardProps) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["project-health", projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const [projectRes, commentsRes] = await Promise.all([
        supabase
          .from("projects")
          .select("id, last_checked_at, deadline, portal_data")
          .eq("id", projectId)
          .single(),
        supabase
          .from("parsed_comments")
          .select("id, status, response_text")
          .eq("project_id", projectId),
      ]);

      const project = projectRes.data as ProjectRow & { portal_data?: { tabs?: { reports?: { pdfs?: { fileName?: string }[] } } } } | null;
      const comments = (commentsRes.data ?? []) as CommentRow[];

      const pdfs = project?.portal_data?.tabs?.reports?.pdfs ?? [];
      const hasReviewCommentsReport = pdfs.some(
        (p) => (p.fileName ?? "").includes("Review Comments")
      );

      const now = new Date();
      const lastCheckedAt = project?.last_checked_at ? new Date(project.last_checked_at) : null;
      const deadline = project?.deadline ? new Date(project.deadline) : null;

      const daysSinceCheck = lastCheckedAt != null ? daysBetween(lastCheckedAt, now) : null;
      const daysUntilDeadline = deadline != null ? daysBetween(now, deadline) : null;
      const hoursSinceCheck = lastCheckedAt != null ? hoursBetween(lastCheckedAt, now) : null;

      const total_comments = comments.length;
      const pending_comments = comments.filter(
        (c) =>
          (c.status ?? "").toLowerCase() === "pending" ||
          c.response_text == null ||
          String(c.response_text).trim() === ""
      ).length;
      const ready_comments = comments.filter(
        (c) => (c.status ?? "").toLowerCase() === "ready for review"
      ).length;
      const approved_comments = comments.filter(
        (c) => (c.status ?? "").toLowerCase() === "approved"
      ).length;

      return {
        lastCheckedAt,
        deadline,
        daysSinceCheck,
        daysUntilDeadline,
        hoursSinceCheck,
        total_comments,
        pending_comments,
        ready_comments,
        approved_comments,
        hasReviewCommentsReport: !!hasReviewCommentsReport,
      };
    },
    enabled: !!projectId,
  });

  if (!projectId) return null;
  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const {
    lastCheckedAt,
    deadline,
    daysSinceCheck,
    daysUntilDeadline,
    hoursSinceCheck,
    total_comments,
    pending_comments,
    ready_comments,
    approved_comments,
    hasReviewCommentsReport,
  } = data;

  const lastCheckText =
    lastCheckedAt == null
      ? "Last portal check: never"
      : (hoursSinceCheck ?? 0) < 24
        ? `Last portal check: ${hoursSinceCheck} hour${(hoursSinceCheck ?? 0) === 1 ? "" : "s"} ago`
        : `Last portal check: ${daysSinceCheck} day${(daysSinceCheck ?? 0) === 1 ? "" : "s"} ago`;

  const deadlineText =
    deadline == null
      ? "Deadline: not set"
      : daysUntilDeadline != null && daysUntilDeadline < 0
        ? `${format(deadline, "MMM d, yyyy")} (${Math.abs(daysUntilDeadline)} days ago)`
        : `${format(deadline, "MMM d, yyyy")} (in ${daysUntilDeadline} days)`;

  const statusVariant =
    deadline != null && (daysUntilDeadline ?? 0) < 0
      ? "red"
      : pending_comments > 0
        ? "orange"
        : "green";

  const deadlineNear =
    deadline != null && daysUntilDeadline != null && daysUntilDeadline >= 0 && daysUntilDeadline <= 7;
  const allClear =
    total_comments > 0 &&
    pending_comments === 0 &&
    (deadline == null || (daysUntilDeadline ?? 0) > 7);

  const buttonLabel =
    pending_comments > 0
      ? "Resolve comments"
      : total_comments === 0 && hasReviewCommentsReport
        ? "Open Comment Review"
        : total_comments === 0
          ? "Run Manual Check"
          : deadlineNear
            ? "Review before deadline"
            : "All clear";

  const handleActionClick = () => {
    if (!projectId) return;
    if (pending_comments > 0) {
      navigate(`/response-matrix?project_id=${encodeURIComponent(projectId)}&filter=pending`);
    } else if (total_comments === 0 && hasReviewCommentsReport) {
      navigate("/comment-review");
    } else if (total_comments === 0) {
      navigate("/dashboard");
    } else if (deadlineNear) {
      navigate(`/response-matrix?project_id=${encodeURIComponent(projectId)}`);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Project Health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{lastCheckText}</p>
        <p className="text-sm text-muted-foreground">{deadlineText}</p>
        <div className="text-sm">
          <span className="font-medium">Comments: </span>
          <span>Total {total_comments}</span>
          {pending_comments > 0 && (
            <span className={cn("ml-2", "text-amber-600 font-medium")}>
              · Pending {pending_comments} ⚠️
            </span>
          )}
          {ready_comments > 0 && <span className="ml-2">· Ready for review {ready_comments}</span>}
          {approved_comments > 0 && <span className="ml-2">· Approved {approved_comments}</span>}
        </div>
        <div className="pt-1 flex flex-wrap items-center gap-2">
          <Badge
            className={cn(
              "border",
              statusVariant === "green" && "bg-green-500/15 text-green-700 border-green-200",
              statusVariant === "orange" && "bg-amber-500/15 text-amber-700 border-amber-200",
              statusVariant === "red" && "bg-red-500/15 text-red-700 border-red-200"
            )}
          >
            {statusVariant === "green"
              ? "On track"
              : statusVariant === "orange"
                ? "Action required"
                : "Deadline passed"}
          </Badge>
          <Button
            size="sm"
            variant={pending_comments > 0 ? "default" : "outline"}
            disabled={allClear}
            onClick={handleActionClick}
          >
            {buttonLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
