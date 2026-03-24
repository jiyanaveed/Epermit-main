import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type RecordInfoPanel =
  | "record_details"
  | "processing_status"
  | "related_records"
  | "attachments"
  | "inspections";
export type PaymentsPanel = "fees";
export type DetailPanel = RecordInfoPanel | PaymentsPanel | "plan_review";

interface BaltimoreRecordTabBarProps {
  activePanel: DetailPanel;
  onPanelChange: (panel: DetailPanel) => void;
}

const RECORD_INFO_LABELS: Record<RecordInfoPanel, string> = {
  record_details: "Record Details",
  processing_status: "Processing Status",
  related_records: "Related Records",
  attachments: "Attachments",
  inspections: "Inspections",
};

export function BaltimoreRecordTabBar({
  activePanel,
  onPanelChange,
}: BaltimoreRecordTabBarProps) {
  const isRecordInfo = [
    "record_details",
    "processing_status",
    "related_records",
    "attachments",
    "inspections",
  ].includes(activePanel);
  const isPayments = activePanel === "fees";
  const isPlanReview = activePanel === "plan_review";

  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-muted/50 p-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={isRecordInfo ? "secondary" : "ghost"}
            size="sm"
            className="gap-1"
          >
            Record Info
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          {(Object.keys(RECORD_INFO_LABELS) as RecordInfoPanel[]).map(
            (key) => (
              <DropdownMenuItem
                key={key}
                onClick={() => onPanelChange(key)}
                className={cn(activePanel === key && "bg-accent font-medium")}
              >
                {RECORD_INFO_LABELS[key]}
              </DropdownMenuItem>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={isPayments ? "secondary" : "ghost"}
            size="sm"
            className="gap-1"
          >
            Payments
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[140px]">
          <DropdownMenuItem
            onClick={() => onPanelChange("fees")}
            className={cn(activePanel === "fees" && "bg-accent font-medium")}
          >
            Fees
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant={isPlanReview ? "secondary" : "ghost"}
        size="sm"
        onClick={() => onPanelChange("plan_review")}
      >
        Plan Review
      </Button>
    </div>
  );
}
