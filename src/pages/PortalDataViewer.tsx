import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { supabase } from "@/lib/supabase";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, ChevronDown, ChevronRight, FileText, AlertCircle, ListChecks } from "lucide-react";

interface KeyValue {
  key: string;
  value: string;
}

interface TableData {
  headers: string[];
  rows: Record<string, string>[];
  tableIndex?: number;
}

interface TabData {
  keyValues?: KeyValue[];
  projectInfo?: KeyValue[];
  tables?: TableData[];
  links?: { text: string; href: string }[];
  error?: string;
  pdfs?: {
    fileName: string;
    text?: string;
    screenshot?: string;
    pages?: number;
    error?: string;
    url?: string;
  }[];
}

interface PortalData {
  name: string;
  projectNum: string;
  description: string;
  location: string;
  dashboardStatus: string;
  tabs: {
    info?: TabData;
    reports?: TabData;
  };
}

export default function PortalDataViewer() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { selectedProjectId } = useSelectedProject();
  const [loading, setLoading] = useState(true);
  const [portalData, setPortalData] = useState<PortalData | null>(null);
  const [portalStatus, setPortalStatus] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [noPermitConfigured, setNoPermitConfigured] = useState(false);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [rawTextByReport, setRawTextByReport] = useState<Record<string, boolean>>({});
  const [showRawText, setShowRawText] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setNoPermitConfigured(false);
    try {
      let project: { portal_data: unknown; portal_status: string | null; last_checked_at: string | null } | null = null;

      if (selectedProjectId) {
        const { data, error } = await supabase
          .from("projects")
          .select("portal_data, portal_status, last_checked_at")
          .eq("id", selectedProjectId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!error) project = data as typeof project;
      }

      if (!project?.portal_data) {
        const { data, error } = await supabase
          .from("projects")
          .select("portal_data, portal_status, last_checked_at")
          .eq("user_id", user.id)
          .not("portal_data", "is", null)
          .order("last_checked_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!error) project = data as typeof project;
      }

      if (!project?.portal_data) {
        const { data: creds } = await supabase
          .from("portal_credentials")
          .select("project_id")
          .eq("user_id", user.id)
          .not("project_id", "is", null);
        const hasLinkedCreds = (creds?.length ?? 0) > 0;
        setNoPermitConfigured(!hasLinkedCreds);
        setPortalData(null);
        setPortalStatus(null);
        setLastCheckedAt(null);
      } else {
        setPortalData((project.portal_data as PortalData) || null);
        setPortalStatus((project.portal_status as string) ?? null);
        setLastCheckedAt((project.last_checked_at as string) ?? null);
      }
    } catch (err) {
      console.error(err);
      setPortalData(null);
    } finally {
      setLoading(false);
    }
  }, [user, selectedProjectId]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
      return;
    }
    fetchData();
  }, [user, authLoading, navigate, fetchData]);

  if (authLoading || loading) {
    return (
      <section className="py-6 px-4 sm:px-6 max-w-5xl">
        <Skeleton className="h-12 w-64 mb-4" />
        <Skeleton className="h-6 w-full mb-2" />
        <Skeleton className="h-6 w-3/4 mb-6" />
        <Skeleton className="h-10 w-48 mb-6" />
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }

  if (noPermitConfigured) {
    return (
      <section className="py-6 px-4 sm:px-6 max-w-5xl">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">No project linked</h2>
            <p className="text-muted-foreground mb-4">
              In Settings &gt; Portal Credentials, link credentials to a project. Then select that project in the sidebar and set Permit # there.
            </p>
            <Button asChild variant="outline">
              <Link to="/settings">Open Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (!portalData) {
    return (
      <section className="py-6 px-4 sm:px-6 max-w-5xl">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">No portal data yet</h2>
            <p className="text-muted-foreground mb-4">
              Click Run Manual Check on the Dashboard to fetch data.
            </p>
            <Button asChild className="bg-accent hover:bg-accent/90">
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  const lastCheckedStr = lastCheckedAt
    ? `Last checked: ${formatDistanceToNow(new Date(lastCheckedAt), { addSuffix: true })}`
    : null;

  const infoTab = portalData.tabs?.info;
  const reportsTab = portalData.tabs?.reports;
  const reportsTable = reportsTab?.tables?.[0];
  const reportsRows = reportsTable?.rows ?? [];
  const pdfs = reportsTab?.pdfs ?? [];
  const PROJECT_INFO_LABELS = [
    "Project name",
    "Description",
    "Location",
    "Contact",
    "Contact's Email",
    "Phone",
    "Cell Phone",
    "Job Class",
    "Project Owner",
    "Owner's Email",
    "Status",
    "Review Cycle",
    "Project Start/End",
  ] as const;

  const infoTables = infoTab?.tables ?? [];
  const projectInfoFromTab = infoTab?.projectInfo ?? [];

  /** DC ProjectDox "weird" table: headers like ["Project name:", "B2508799"], rows like {"Project name:": "<value>"}. First column holds values in label order. */
  const isWeirdProjectInfoTable = (table: TableData, projectNum: string) => {
    const headers = table.headers ?? [];
    const first = headers[0] ?? "";
    const second = headers[1] ?? "";
    return (
      first.includes("Project name:") &&
      (second === projectNum || (second.length <= 20 && !second.includes(":")))
    );
  };

  /** Detect if tabs.info.projectInfo is malformed (scraper put values as keys). Do not use for display. */
  const isProjectInfoMalformed = (): boolean => {
    const jurisdiction =
      (portalData?.dashboardStatus ?? "") + (portalData?.location ?? "") + (portalData?.name ?? "");
    const isDC =
      /washington\s*dc|projectdox|avolve|dc\s*accela/i.test(jurisdiction) ||
      (portalData?.location && /sheridan|dc\b/i.test(portalData.location));
    if (isDC) return true;
    const projectNum = portalData?.projectNum ?? "";
    if (!projectNum) return false;
    const hasProjectNumAsKey = projectInfoFromTab.some(
      (kv) => kv.key === projectNum || kv.key?.trim() === projectNum
    );
    if (hasProjectNumAsKey) return true;
    const emptyCount = projectInfoFromTab.filter((kv) => !kv.value?.trim()).length;
    if (projectInfoFromTab.length >= 5 && emptyCount >= projectInfoFromTab.length - 2)
      return true;
    return false;
  };

  /**
   * Build Project Info from portalData + the weird info table (DC ProjectDox).
   * Table: first column key is "Project name:", row i value = row[i][firstHeader]. Order: description, location, contact, contact email, phone, cell phone, job class, project owner, owner email, status, review cycle, start/end.
   */
  const buildProjectInfoFromPortalAndTable = (): KeyValue[] => {
    const projectNum = portalData?.projectNum ?? "";
    const name = portalData?.name ?? "";
    const description = portalData?.description ?? "";
    const location = portalData?.location ?? "";

    const infoTable = infoTables.find((t) => isWeirdProjectInfoTable(t, projectNum));
    const firstColKey = infoTable?.headers?.[0] ?? "Project name:";

    const getRowValue = (rowIndex: number): string => {
      if (!infoTable?.rows?.[rowIndex]) return "";
      const row = infoTable.rows[rowIndex];
      const v = row[firstColKey] ?? (Object.values(row)[0] as string | undefined);
      return typeof v === "string"
        ? v.replace(/\s+/g, " ").replace(/\u00a0/g, "").trim()
        : "";
    };

    const rowCount = infoTable?.rows?.length ?? 0;
    const values: string[] = [];
    for (let i = 0; i < Math.max(rowCount, 12); i++) {
      values.push(getRowValue(i));
    }

    if (typeof window !== "undefined" && import.meta.env.DEV) {
      console.log("[PortalDataViewer] weirdTable debug:", {
        headers: infoTable?.headers,
        rowCount,
        extractedByIndex: values.slice(0, rowCount).map((v, i) => `[${i}]: ${(v || "(empty)").slice(0, 50)}`),
      });
    }

    const projectName =
      projectNum ||
      name ||
      (infoTable?.headers?.[1] && !infoTable.headers[1].includes(":")
        ? infoTable.headers[1].trim()
        : "");

    const v5 = values[5] ?? "";
    const looksLikeJobClass = (s: string) =>
      /^[A-Z]{1,3}-[A-Z]{1,3}$/.test(s.trim()) || /C-C|Job\s*Class/i.test(s) || (s.length <= 6 && /^[A-Z0-9\-]+$/.test(s.trim()));
    const looksLikePhone = (s: string) =>
      s.length >= 7 && /^[\d\s\-\(\)]+$/.test(s.replace(/\s/g, "")) && /\d{7,}/.test(s);

    const hasCellPhoneRow = v5 !== "" && looksLikePhone(v5) && !looksLikeJobClass(v5);

    let jobClassIdx: number;
    let projectOwnerIdx: number;
    let ownerEmailIdx: number;
    let statusIdx: number;
    let reviewCycleIdx: number;
    let startEndIdx: number;
    let cellPhoneValue: string;

    if (!hasCellPhoneRow) {
      cellPhoneValue = "";
      jobClassIdx = 5;
      projectOwnerIdx = 6;
      ownerEmailIdx = 7;
      statusIdx = 8;
      startEndIdx = 9;
      reviewCycleIdx = -1;
    } else {
      cellPhoneValue = v5;
      jobClassIdx = 6;
      projectOwnerIdx = 7;
      ownerEmailIdx = 8;
      statusIdx = 9;
      reviewCycleIdx = rowCount >= 11 ? 10 : -1;
      startEndIdx = rowCount >= 12 ? 11 : rowCount >= 11 ? 10 : -1;
    }

    const startEndValue =
      startEndIdx >= 0 ? (values[startEndIdx] ?? "") : "";

    const rows: KeyValue[] = [
      { key: "Project name", value: projectName },
      { key: "Description", value: description || values[0] },
      { key: "Location", value: location || values[1] },
      { key: "Contact", value: values[2] },
      { key: "Contact's Email", value: values[3] },
      { key: "Phone", value: values[4] },
      { key: "Cell Phone", value: cellPhoneValue },
      { key: "Job Class", value: values[jobClassIdx] ?? "" },
      { key: "Project Owner", value: values[projectOwnerIdx] ?? "" },
      { key: "Owner's Email", value: values[ownerEmailIdx] ?? "" },
      { key: "Status", value: values[statusIdx] ?? "" },
      { key: "Review Cycle", value: reviewCycleIdx >= 0 ? (values[reviewCycleIdx] ?? "") : "" },
      { key: "Project Start/End", value: startEndValue },
    ];
    return rows;
  };

  const isMalformedInfoTable = (table: TableData) => {
    const headers = table.headers ?? [];
    const hasProjectNameHeader = headers[0]?.includes("Project name:");
    const hasVeryLongHeader = headers.some((h) => (h ?? "").length > 100);
    const hasLabelLikeHeaders = headers.some((h) =>
      /^(Description|Location|Contact):?$/i.test((h ?? "").trim())
    );
    return hasProjectNameHeader || hasVeryLongHeader || hasLabelLikeHeaders;
  };
  const filteredInfoTables = infoTables.filter((table) => !isMalformedInfoTable(table));

  let displayProjectInfo: KeyValue[] = [];
  const weirdTable = infoTables.find((t) => isWeirdProjectInfoTable(t, portalData?.projectNum ?? ""));
  if (isProjectInfoMalformed() || weirdTable) {
    displayProjectInfo = buildProjectInfoFromPortalAndTable();
  } else if (projectInfoFromTab.length > 2) {
    displayProjectInfo = projectInfoFromTab;
  } else {
    const infoTable = infoTables.find((t) =>
      t.headers?.some(
        (h) =>
          h?.includes("Project name:") ||
          (h ?? "").length > 100 ||
          /^(Description|Location|Contact):?$/i.test((h ?? "").trim())
      )
    );
    if (infoTable) {
      const parsedInfo: KeyValue[] = [];
      const projectNameValue = infoTable.headers?.find(
        (h) => h && h.length < 20 && !h.includes(":")
      );
      if (projectNameValue?.trim()) {
        parsedInfo.push({ key: "Project name", value: projectNameValue.trim() });
      }
      const headers = infoTable.headers ?? [];
      const valueColumnKey = headers[1] ?? null;
      infoTable.rows?.forEach((row, idx) => {
        const labelIdx = parsedInfo.length;
        if (labelIdx >= PROJECT_INFO_LABELS.length) return;
        let value = "";
        if (valueColumnKey != null && row[valueColumnKey] !== undefined) {
          const v = row[valueColumnKey];
          value =
            typeof v === "string"
              ? v.replace(/\s+/g, " ").replace(/\u00a0/g, "").trim()
              : "";
        } else {
          const values = Object.values(row);
          const second = values[1];
          value =
            typeof second === "string"
              ? String(second).replace(/\s+/g, " ").replace(/\u00a0/g, "").trim()
              : "";
        }
        parsedInfo.push({ key: PROJECT_INFO_LABELS[labelIdx], value });
      });
      displayProjectInfo = parsedInfo;
    }
  }

  if (typeof window !== "undefined" && import.meta.env.DEV && displayProjectInfo.length > 0) {
    const cellPhoneIdx = displayProjectInfo.findIndex((kv) => /cell\s*phone/i.test(kv.key));
    if (cellPhoneIdx >= 0 && cellPhoneIdx + 1 < displayProjectInfo.length) {
      const nextKey = displayProjectInfo[cellPhoneIdx + 1].key;
      if (nextKey !== "Job Class") {
        console.warn("[PortalDataViewer] Project Info alignment: after Cell Phone expected Job Class, got", nextKey);
      }
    }
  }

  const hasInfoData =
    displayProjectInfo.length > 0 ||
    (infoTab?.keyValues?.length ?? 0) > 0 ||
    filteredInfoTables.length > 0;

  const findPdfForReport = (reportName: string) =>
    pdfs.find(
      (p) =>
        p.fileName &&
        reportName &&
        (p.fileName.includes(reportName) || reportName.includes(p.fileName))
    );

  function parseReviewComments(originalText: string) {
    const comments: Array<{
      ref: string;
      cycle: string;
      department: string;
      reviewer: string;
      date: string;
      status: string;
      body: string[];
    }> = [];

    const rcIdx = originalText.indexOf("STATUS");
    if (rcIdx === -1) return comments;

    const afterHeader = originalText.substring(rcIdx + "STATUS".length);
    const lines = afterHeader.split("\n").map((l) => l.trim());

    let current: (typeof comments)[0] | null = null;

    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      if (!line) continue;
      if (line.includes("Created in ProjectDox")) break;

      if (/^[\t ]+$/.test(line)) continue;

      if (/^\d{1,2}$/.test(line) && parseInt(line, 10) <= 50) {
        if (current) comments.push(current);
        current = {
          ref: line,
          cycle: "",
          department: "",
          reviewer: "",
          date: "",
          status: "",
          body: [],
        };

        const next = lines[j + 1]?.trim();
        if (next && /^\d{1,2}$/.test(next) && parseInt(next, 10) <= 10) {
          current.cycle = next;
          j++;
        }
        continue;
      }

      if (!current) continue;

      if (/^(Resolved|Unresolved|Info Only)$/i.test(line)) {
        current.status = line;
        continue;
      }

      if (
        !current.department &&
        line === line.toUpperCase() &&
        line.length >= 2 &&
        line.length <= 30 &&
        /^[A-Z]/.test(line) &&
        !line.includes(":") &&
        !line.includes(".") &&
        line.split(" ").length <= 4 &&
        !line.startsWith("SUBJECT") &&
        !line.startsWith("NO ") &&
        !line.startsWith("ENGAGING") &&
        line !== "REVIEW COMMENTS"
      ) {
        current.department = line;
        continue;
      }

      if (
        !current.reviewer &&
        /^[A-Z][a-z]+ [A-Z][a-z]+/.test(line) &&
        line.length < 40 &&
        !line.includes(":") &&
        !line.includes("http") &&
        !line.includes(".") &&
        line.split(" ").length <= 4
      ) {
        current.reviewer = line;
        continue;
      }

      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) {
        if (!current.date) {
          current.date = line;
          const nextLine = lines[j + 1]?.trim();
          if (nextLine && /^\d{2}\s*(AM|PM)/i.test(nextLine)) {
            current.date += " " + nextLine;
            j++;
          }
        }
        continue;
      }

      if (line === "Comment" || line === "Markup" || line === "Checklist") {
        continue;
      }

      if (/^-{5,}$/.test(line)) {
        current.body.push("---");
        continue;
      }

      current.body.push(line);
    }
    if (current) comments.push(current);

    return comments;
  }

  function renderReportContent(text: string): React.ReactNode {
    if (!text) return null;

    const elements: React.ReactNode[] = [];
    let keyInc = 0;

    // SSRS uses \n\t as cell separator. Join any line starting with \t
    // to the previous line, converting \n\t into just \t
    const processed = text.replace(/\n\t/g, "\t");
    const lines = processed.split("\n");

    const tableRegions: Array<{ start: number; end: number; headers: string[] }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || /^\t+$/.test(line)) continue;

      if (
        line === line.toUpperCase() &&
        line.length >= 2 &&
        line.length <= 40 &&
        /[A-Z]/.test(line) &&
        !line.includes(":")
      ) {
        const headers: string[] = [line];
        let j = i + 1;
        while (j < lines.length) {
          const jl = lines[j].trim();
          if (/^\t*$/.test(jl)) {
            j++;
            continue;
          }
          if (
            jl === jl.toUpperCase() &&
            jl.length >= 2 &&
            jl.length <= 40 &&
            /[A-Z]/.test(jl) &&
            !jl.includes(":")
          ) {
            headers.push(jl);
            j++;
          } else {
            break;
          }
        }

        if (headers.length >= 3) {
          const numCols = headers.length;
          const dataStart = j;
          const rows: string[][] = [];
          let currentRow: string[] = [];

          while (j < lines.length) {
            const dl = lines[j];
            const dt = dl.trim();

            if (dt.includes("Created in ProjectDox")) break;
            if (
              dt === dt.toUpperCase() &&
              dt.length > 10 &&
              !dt.includes(":") &&
              /[A-Z]/.test(dt) &&
              currentRow.length === 0 &&
              !dt.match(/^\d/) &&
              !dt.startsWith("-")
            ) {
              let isNewTable = false;
              for (let nk = j + 1; nk < Math.min(j + 5, lines.length); nk++) {
                const nkl = lines[nk].trim();
                if (/^\t*$/.test(nkl) || !nkl) continue;
                if (
                  nkl === nkl.toUpperCase() &&
                  nkl.length >= 2 &&
                  /[A-Z]/.test(nkl)
                ) {
                  isNewTable = true;
                }
                break;
              }
              if (!isNewTable) break;
            }

            if (/^\t+ *$/.test(dl)) {
              j++;
              continue;
            }

            if (dt === "") {
              if (currentRow.length > 0) {
                while (currentRow.length < numCols) currentRow.push("");
                rows.push(currentRow.slice(0, numCols));
                currentRow = [];
              }
              j++;
              continue;
            }

            currentRow.push(dt);
            j++;
          }
          if (currentRow.length > 0) {
            while (currentRow.length < numCols) currentRow.push("");
            rows.push(currentRow.slice(0, numCols));
          }

          if (rows.length > 0) {
            tableRegions.push({ start: i, end: j, headers });
          }

          i = j - 1;
          continue;
        }
      }
    }

    let lineIdx = 0;

    const tablesByStart = new Map<
      number,
      { headers: string[]; rows: string[][]; end: number }
    >();
    for (const region of tableRegions) {
      const numCols = region.headers.length;
      const rows: string[][] = [];
      let currentRow: string[] = [];
      let pastHeaders = false;
      let headerCount = 0;
      for (let li = region.start; li < region.end; li++) {
        const lt = lines[li].trim();
        if (!pastHeaders) {
          if (
            lt &&
            lt === lt.toUpperCase() &&
            /[A-Z]/.test(lt) &&
            !lt.includes(":") &&
            lt.length <= 40
          ) {
            headerCount++;
            if (headerCount >= numCols) {
              pastHeaders = true;
            }
          }
          continue;
        }
        if (/^\t+ *$/.test(lines[li])) continue;
        if (lt === "") {
          if (currentRow.length > 0) {
            while (currentRow.length < numCols) currentRow.push("");
            rows.push(currentRow.slice(0, numCols));
            currentRow = [];
          }
          continue;
        }
        if (lt.includes("Created in ProjectDox")) break;
        currentRow.push(lt);
      }
      if (currentRow.length > 0) {
        while (currentRow.length < numCols) currentRow.push("");
        rows.push(currentRow.slice(0, numCols));
      }
      tablesByStart.set(region.start, {
        headers: region.headers,
        rows,
        end: region.end,
      });
    }

    lineIdx = 0;
    while (lineIdx < lines.length) {
      const table = tablesByStart.get(lineIdx);
      if (table) {
        elements.push(
          <div key={keyInc++} className="overflow-x-auto my-4 border rounded-lg">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#091428] border-b-2 border-[#1A3055]">
                  {table.headers.map((h, hi) => (
                    <th
                      key={hi}
                      className="text-left p-2 px-3 text-xs font-bold text-[#C44D14] font-mono border-r border-[#1A3055] whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, ri) => (
                  <tr
                    key={ri}
                    className={`border-b border-[#1A3055] ${ri % 2 === 0 ? "bg-[#0D1E38]" : "bg-[#091428]"} hover:bg-[#FF6B2B08]`}
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="p-2 px-3 align-top border-r border-[#1A3055] whitespace-nowrap text-[#F0F6FF] max-w-[200px] overflow-hidden text-ellipsis"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        lineIdx = table.end;
        continue;
      }

      const line = lines[lineIdx];
      const trimmed = line.trim();

      if (!trimmed || /^\t+$/.test(trimmed)) {
        lineIdx++;
        continue;
      }

      if (trimmed.includes("Created in ProjectDox")) {
        elements.push(
          <p
            key={keyInc++}
            className="text-xs text-[#6B9AC4] mt-6 pt-2 border-t border-[#1A3055] italic"
          >
            {trimmed}
          </p>
        );
        lineIdx++;
        continue;
      }

      if (
        elements.length === 0 &&
        (trimmed.startsWith("Plan Review") ||
          trimmed.startsWith("Current Project") ||
          trimmed.includes("Review Comments Report") ||
          trimmed.includes("Review Details") ||
          trimmed.includes("Routing Slip") ||
          trimmed.includes("Department Review"))
      ) {
        elements.push(
          <h3
            key={keyInc++}
            className="text-xl font-light text-[#6B9AC4] pb-2 mb-4 border-b-2 border-blue-600"
          >
            {trimmed}
          </h3>
        );
        lineIdx++;
        continue;
      }

      if (
        trimmed === trimmed.toUpperCase() &&
        trimmed.length > 3 &&
        trimmed.length < 80 &&
        !trimmed.includes(":") &&
        /[A-Z]/.test(trimmed) &&
        !/^\d+$/.test(trimmed)
      ) {
        elements.push(
          <div
            key={keyInc++}
            className="text-center text-sm font-bold tracking-wider text-[#6B9AC4] bg-[#091428] py-2 my-4 border-y border-[#1A3055]"
          >
            {trimmed}
          </div>
        );
        lineIdx++;
        continue;
      }

      if (
        trimmed.includes(":") &&
        trimmed.indexOf(":") > 1 &&
        trimmed.indexOf(":") < 45 &&
        !trimmed.startsWith("http")
      ) {
        const ci = trimmed.indexOf(":");
        const key = trimmed.substring(0, ci).trim();
        const val = trimmed.substring(ci + 1).trim();
        if (key.length > 1 && key.length < 45) {
          elements.push(
            <div key={keyInc++} className="flex gap-2 py-0.5">
              <span className="text-sm text-[#6B9AC4] whitespace-nowrap min-w-[160px]">
                {key}:
              </span>
              <span className="text-sm font-semibold text-[#F0F6FF]">{val}</span>
            </div>
          );
          lineIdx++;
          continue;
        }
      }

      elements.push(
        <p key={keyInc++} className="text-sm text-[#F0F6FF] py-0.5">
          {trimmed}
        </p>
      );
      lineIdx++;
    }

    return <>{elements}</>;
  }

  function renderReviewComments(text: string): React.ReactNode {
    if (!text) return null;

    const elements: React.ReactNode[] = [];
    let keyInc = 0;

    const rcSectionIdx = text.indexOf("REVIEW COMMENTS");
    if (rcSectionIdx > 0) {
      const beforeRC = text.substring(0, rcSectionIdx);
      elements.push(
        <div key={keyInc++}>{renderReportContent(beforeRC)}</div>
      );
    }

    elements.push(
      <div
        key={keyInc++}
        className="text-center text-sm font-bold tracking-wider text-[#6B9AC4] bg-[#091428] py-2 my-4 border-y border-[#1A3055]"
      >
        REVIEW COMMENTS
      </div>
    );

    const comments = parseReviewComments(text);

    if (comments.length === 0) {
      elements.push(
        <p key={keyInc++} className="text-sm text-[#6B9AC4] italic py-2">
          No comments parsed.
        </p>
      );
    }

    comments.forEach((comment) => {
      elements.push(
        <div key={keyInc++} className="border rounded-lg mb-3 overflow-hidden">
          <div className="flex items-center justify-between bg-[#091428] px-4 py-2 border-b border-[#1A3055] flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="bg-blue-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                #{comment.ref}
              </span>
              {comment.cycle && (
                <span className="text-xs text-[#6B9AC4] bg-[#1A3055] px-2 py-0.5 rounded">
                  Cycle {comment.cycle}
                </span>
              )}
              {comment.department && (
                <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded">
                  {comment.department}
                </span>
              )}
              {comment.reviewer && (
                <span className="text-sm text-[#F0F6FF] font-medium">{comment.reviewer}</span>
              )}
              {comment.date && (
                <span className="text-xs text-[#6B9AC4]">{comment.date}</span>
              )}
            </div>
            {comment.status && (
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${
                  comment.status === "Resolved"
                    ? "bg-green-100 text-green-700"
                    : comment.status === "Unresolved"
                      ? "bg-red-100 text-red-700"
                      : comment.status === "Info Only"
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-[#6B9AC4]/10 text-[#6B9AC4]"
                }`}
              >
                {comment.status}
              </span>
            )}
          </div>
          <div className="px-4 py-3 space-y-1">
            {comment.body.map((line, idx) => {
              if (
                line.startsWith("Responded by:") ||
                line.startsWith("Reviewer Response:")
              ) {
                return (
                  <div
                    key={idx}
                    className="text-sm font-semibold text-[#6B9AC4] mt-3 pt-2 border-t border-dashed border-[#1A3055]"
                  >
                    {line}
                  </div>
                );
              }
              if (line === "---") {
                return <hr key={idx} className="my-2 border-[#1A3055]" />;
              }
              return (
                <p key={idx} className="text-sm text-[#F0F6FF] leading-relaxed">
                  {line}
                </p>
              );
            })}
          </div>
        </div>
      );
    });

    const footerMatch = text.match(/Created in ProjectDox[^\n]*/);
    if (footerMatch) {
      elements.push(
        <p key={keyInc++} className="text-xs text-[#6B9AC4] mt-4 pt-2 border-t border-[#1A3055] italic">
          {footerMatch[0]}
        </p>
      );
    }

    return <>{elements}</>;
  }

  return (
    <section className="py-6 px-4 sm:px-6 max-w-5xl">
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{portalData.projectNum}</h1>
            {portalData.description && (
              <p className="text-muted-foreground mt-1 max-w-2xl">{portalData.description}</p>
            )}
            {portalData.location && (
              <p className="text-sm text-muted-foreground mt-0.5">{portalData.location}</p>
            )}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {(portalData.dashboardStatus ?? portalStatus) && (
                <Badge className="bg-[#1a1a2e] text-white border-0">
                  {portalData.dashboardStatus ?? portalStatus}
                </Badge>
              )}
              {lastCheckedStr && (
                <span className="text-sm text-muted-foreground">{lastCheckedStr}</span>
              )}
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link to="/dashboard">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="info" className="w-full">
        <TabsList className="h-9 rounded-none border-b border-transparent bg-transparent p-0 gap-0">
          <TabsTrigger
            value="info"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none"
          >
            Info
          </TabsTrigger>
          <TabsTrigger
            value="reports"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none"
          >
            Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {infoTab?.error ? (
                <div className="p-4 text-destructive flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {infoTab.error}
                </div>
              ) : hasInfoData ? (
                <div>
                  {displayProjectInfo.length > 0 && (
                    <div className="p-4 pb-0">
                      <p className="text-sm font-bold mb-2">Project Info</p>
                      <div className="border border-border rounded-md overflow-hidden">
                        <div className="grid grid-cols-3 border-b border-border bg-muted/30">
                          <div className="col-span-1 px-3 py-2 text-sm font-semibold">Field</div>
                          <div className="col-span-2 px-3 py-2 text-sm font-semibold">Value</div>
                        </div>
                        {displayProjectInfo.map((kv, i) => (
                          <div
                            key={`${kv.key}-${i}`}
                            className={`grid grid-cols-3 border-b border-border last:border-b-0 ${
                              i % 2 === 0 ? "bg-[#0D1E38]" : "bg-[#091428]"
                            }`}
                          >
                            <div className="col-span-1 w-1/3 min-w-[140px] px-3 py-2 text-sm font-semibold bg-[#091428] border-r border-[#1A3055]">
                              {kv.key}
                            </div>
                            <div
                              className={`col-span-2 px-3 py-2 text-sm ${
                                kv.key === "Description"
                                  ? "whitespace-normal break-words"
                                  : ""
                              }`}
                            >
                              {kv.value.trim() !== "" ? kv.value : "-"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {infoTab.keyValues && infoTab.keyValues.length > 0 && displayProjectInfo.length === 0 && (
                    <div className="border-0">
                      {infoTab.keyValues.map((kv, i) => (
                        <div
                          key={i}
                          className={`flex border-b border-border last:border-b-0 ${
                            i % 2 === 0 ? "bg-[#0D1E38]" : "bg-[#091428]"
                          }`}
                        >
                          <div className="w-1/3 min-w-[140px] px-3 py-2 text-sm font-semibold text-muted-foreground bg-muted/40 shrink-0">
                            {kv.key}
                          </div>
                          <div className="flex-1 px-3 py-2 text-sm">
                            {kv.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {filteredInfoTables.map((tbl, ti) => (
                    <div
                      key={ti}
                      className={`overflow-x-auto ${
                        ti === 0 && !infoTab.keyValues?.length && displayProjectInfo.length === 0
                          ? ""
                          : "mt-4"
                      }`}
                    >
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-[#1a1a2e] hover:bg-[#1a1a2e]">
                            {tbl.headers?.map((h, hi) => (
                              <TableHead key={hi} className="text-white font-medium whitespace-nowrap">
                                {h}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tbl.rows?.map((row, ri) => (
                            <TableRow key={ri} className={ri % 2 === 1 ? "bg-[#091428]" : "bg-[#0D1E38]"}>
                              {tbl.headers?.map((h) => (
                                <TableCell key={h} className="whitespace-nowrap">{row[h] ?? ""}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="p-4 text-muted-foreground">No info data available.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          <p className="text-sm text-muted-foreground mb-3">
            Source data from the portal. For an actionable comment list and responses, use <strong>Comment Review</strong>.
          </p>
          <Card>
            <CardContent className="p-0">
              {reportsTab?.error ? (
                <div className="p-4 text-destructive flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {reportsTab.error}
                </div>
              ) : reportsTable ? (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#1a1a2e] hover:bg-[#1a1a2e]">
                      {reportsTable.headers?.map((h, hi) => (
                        <TableHead key={hi} className="text-white font-medium">
                          {h}
                        </TableHead>
                      ))}
                      <TableHead className="text-white font-medium w-12 min-w-[3rem] text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportsRows.map((row, ri) => {
                      const reportName = (row["REPORT NAME"] ?? row["Report Name"] ?? "") as string;
                      const isExpanded = expandedReport === reportName;
                      const pdf = findPdfForReport(reportName);
                      const hasError = pdf?.error;

                      return (
                        <Collapsible
                          key={ri}
                          open={isExpanded}
                          onOpenChange={(open) =>
                            setExpandedReport(open ? reportName : null)
                          }
                        >
                          <>
                            <TableRow
                              className={`cursor-pointer hover:bg-muted/50 ${ri % 2 === 1 ? "bg-muted/30" : ""}`}
                              onClick={() =>
                                setExpandedReport(isExpanded ? null : reportName)
                              }
                            >
                              {reportsTable.headers?.map((h) => (
                                <TableCell key={h}>{row[h] ?? ""}</TableCell>
                              ))}
                              <TableCell className="w-12 min-w-[3rem] text-right align-middle">
                                <div className="flex justify-end">
                                  <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                                      {isExpanded ? (
                                        <ChevronDown className="h-4 w-4" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </CollapsibleTrigger>
                                </div>
                              </TableCell>
                            </TableRow>
                            <CollapsibleContent asChild>
                              <TableRow>
                                <TableCell
                                  colSpan={(reportsTable.headers?.length ?? 1) + 1}
                                  className="bg-muted/30 p-0"
                                >
                                    <div className="p-4">
                                    <Card className="bg-background border shadow-sm">
                                      <CardHeader className="pb-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <CardTitle className="text-base flex items-center gap-2">
                                            {reportName}
                                            {hasError && (
                                              <Badge
                                                variant="destructive"
                                                className="text-xs"
                                              >
                                                Error
                                              </Badge>
                                            )}
                                          </CardTitle>
                                          <div className="flex items-center gap-2">
                                            {reportName && reportName.includes("Review Comments") && (
                                              <Button
                                                size="sm"
                                                className="bg-accent hover:bg-accent/90"
                                                onClick={() => navigate("/comment-review", { state: { fromReports: true } })}
                                              >
                                                <ListChecks className="h-4 w-4 mr-2" />
                                                Open Comment Review
                                              </Button>
                                            )}
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() =>
                                                setRawTextByReport((prev) => ({
                                                  ...prev,
                                                  [reportName]: !prev[reportName],
                                                }))
                                              }
                                            >
                                              {rawTextByReport[reportName] ? "Table view" : "Raw text"}
                                            </Button>
                                          </div>
                                        </div>
                                      </CardHeader>
                                      <CardContent className="pt-0">
                                        {hasError ? (
                                          <p className="text-sm text-destructive">
                                            {pdf?.error}
                                          </p>
                                        ) : pdf?.screenshot ? (
                                          <div>
                                            <div className="overflow-auto rounded border" style={{ maxHeight: "700px" }}>
                                              <img
                                                src={`data:image/png;base64,${pdf.screenshot}`}
                                                alt={reportName}
                                                className="w-full"
                                              />
                                            </div>
                                            {pdf.text && (
                                              <details className="mt-2">
                                                <summary className="text-xs text-[#6B9AC4] cursor-pointer hover:text-[#F0F6FF]">
                                                  Show extracted text
                                                </summary>
                                                <pre className="mt-2 text-xs bg-[#091428] text-[#F0F6FF] p-3 rounded border border-[#1A3055] overflow-auto max-h-64 whitespace-pre-wrap">
                                                  {pdf.text}
                                                </pre>
                                              </details>
                                            )}
                                          </div>
                                        ) : pdf?.text ? (
                                          <div className="max-h-96 overflow-y-auto rounded border border-[#1A3055] bg-[#0D1E38] p-4">
                                            {pdf.fileName?.includes("Review Comments")
                                              ? renderReviewComments(pdf.text)
                                              : renderReportContent(pdf.text)}
                                          </div>
                                        ) : (
                                          <p className="text-sm text-muted-foreground">
                                            No content available.
                                          </p>
                                        )}
                                      </CardContent>
                                    </Card>
                                  </div>
                                </TableCell>
                              </TableRow>
                            </CollapsibleContent>
                          </>
                        </Collapsible>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="p-4 text-muted-foreground">No reports data available.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </section>
  );
}
