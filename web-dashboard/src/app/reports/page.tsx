"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { Button, Card, Input, Select, Table, Tabs } from "@/components/ui";
import { loadAdminProfile, type Profile } from "@/lib/dashboard-data";
import { formatHours, formatPercent } from "@/lib/format";
import {
  loadReportOptions,
  loadReports,
  type ActivityReportRow,
  type AppUsageReportRow,
  type AttendanceReportRow,
  type ProjectReportRow,
  type ReportOption,
  type ReportsData,
  type TimeReportRow,
} from "@/lib/reports-data";
import { supabase } from "@/lib/supabase";
import { downloadXlsx } from "@/lib/xlsx-export";

type ReportTab = "time" | "activity" | "apps" | "attendance" | "projects";

const navItems = [
  { label: "Overview", href: "/" },
  { label: "Team", href: "/team" },
  { label: "Projects", href: "/projects" },
  { label: "Screenshots", href: "/screenshots" },
  { label: "Reports", href: "/reports" },
  { label: "Settings", href: "/settings" },
];

const emptyReports: ReportsData = {
  activityRows: [],
  appRows: [],
  attendanceRows: [],
  projectRows: [],
  timeRows: [],
};

export default function ReportsPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<Profile | null>(null);
  const [reports, setReports] = useState<ReportsData>(emptyReports);
  const [vas, setVas] = useState<ReportOption[]>([]);
  const [projects, setProjects] = useState<ReportOption[]>([]);
  const [activeTab, setActiveTab] = useState<ReportTab>("time");
  const [startDate, setStartDate] = useState(toDateInputValue(new Date()));
  const [endDate, setEndDate] = useState(toDateInputValue(new Date()));
  const [userId, setUserId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const currentFilter = useMemo(
    () => ({
      endDate,
      projectId: projectId || undefined,
      startDate,
      userId: userId || undefined,
    }),
    [endDate, projectId, startDate, userId],
  );

  useEffect(() => {
    let isMounted = true;

    async function boot() {
      const profile = await loadAdminProfile(supabase);
      if (!isMounted) return;

      if (!profile || profile.role !== "admin" || !profile.is_active) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      setAdmin(profile);
      const options = await loadReportOptions(supabase);
      if (!isMounted) return;
      setVas(options.vas);
      setProjects(options.projects);
      await refreshReports();
    }

    boot();
    return () => {
      isMounted = false;
    };
  }, [router]);

  async function refreshReports() {
    try {
      setError("");
      setIsLoading(true);
      const nextReports = await loadReports(supabase, currentFilter);
      setReports(nextReports);
      setLastUpdatedAt(new Date());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not load reports.");
    } finally {
      setIsLoading(false);
    }
  }

  function exportActiveReport() {
    const { filename, rows, sheetName } = xlsxForReport(activeTab, reports);
    downloadXlsx(filename, sheetName, rows);
  }

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">ThriveTracker</p>
          <h1>Operations Desk</h1>
        </div>
        <nav className="nav-list" aria-label="Dashboard sections">
          {navItems.map((item) => (
            <Link className={item.label === "Reports" ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operational Reports</p>
            <h2>Reports</h2>
            <p className="subtle-line">
              {admin ? admin.full_name : "Checking session"}
              {lastUpdatedAt ? `, updated ${lastUpdatedAt.toLocaleTimeString()}` : ""}
            </p>
          </div>
          <div className="topbar-actions">
            <Button onClick={refreshReports} type="button" variant="secondary">
              <RefreshCw size={16} />
              Refresh
            </Button>
            <Button onClick={exportActiveReport} type="button">
              <Download size={16} />
              Export Excel
            </Button>
          </div>
        </header>

        {error ? <div className="toast">{error}</div> : null}

        <Card className="detail-card report-filter-card">
          <div className="report-filters">
            <label>
              Start date
              <Input onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} />
            </label>
            <label>
              End date
              <Input onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} />
            </label>
            <label>
              VA
              <Select onChange={(event) => setUserId(event.target.value)} value={userId}>
                <option value="">All VAs</option>
                {vas.map((va) => (
                  <option key={va.id} value={va.id}>
                    {va.name}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Project
              <Select onChange={(event) => setProjectId(event.target.value)} value={projectId}>
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </label>
            <Button onClick={refreshReports} type="button">
              Apply
            </Button>
          </div>
        </Card>

        <section className="stats-grid detail-stats" aria-label="Report stats">
          <ReportStat label="Tracked Hours" value={formatHours(sumTime(reports.timeRows))} />
          <ReportStat label="Average Activity" value={formatPercent(averageActivity(reports.activityRows))} />
          <ReportStat label="Apps Seen" value={String(reports.appRows.length)} />
          <ReportStat label="Projects Used" value={String(reports.projectRows.length)} />
        </section>

        <Card className="wide-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Exportable Views</p>
              <h3>{tabTitle(activeTab)}</h3>
            </div>
            <Tabs>
              <button className={activeTab === "time" ? "selected" : ""} onClick={() => setActiveTab("time")} type="button">
                Time
              </button>
              <button className={activeTab === "activity" ? "selected" : ""} onClick={() => setActiveTab("activity")} type="button">
                Activity
              </button>
              <button className={activeTab === "apps" ? "selected" : ""} onClick={() => setActiveTab("apps")} type="button">
                Apps
              </button>
              <button className={activeTab === "attendance" ? "selected" : ""} onClick={() => setActiveTab("attendance")} type="button">
                Attendance
              </button>
              <button className={activeTab === "projects" ? "selected" : ""} onClick={() => setActiveTab("projects")} type="button">
                Projects
              </button>
            </Tabs>
          </div>

          {isLoading ? (
            <div className="empty-state">
              <FileSpreadsheet size={28} />
              <strong>Loading reports</strong>
              <p>Calculating time, activity, app usage, attendance, and project totals.</p>
            </div>
          ) : (
            <ReportTable activeTab={activeTab} reports={reports} />
          )}
        </Card>
      </section>
    </main>
  );
}

function ReportTable({ activeTab, reports }: { activeTab: ReportTab; reports: ReportsData }) {
  if (activeTab === "time") return <TimeTable rows={reports.timeRows} />;
  if (activeTab === "activity") return <ActivityTable rows={reports.activityRows} />;
  if (activeTab === "apps") return <AppsTable rows={reports.appRows} />;
  if (activeTab === "attendance") return <AttendanceTable rows={reports.attendanceRows} />;
  return <ProjectsTable rows={reports.projectRows} />;
}

function TimeTable({ rows }: { rows: TimeReportRow[] }) {
  return (
    <Table className="reports-table">
      <div className="table-row reports-table-row table-head">
        <span>VA</span>
        <span>Total Hours</span>
        <span>Entries</span>
        <span>Manual</span>
      </div>
      {rows.length ? rows.map((row) => (
        <div className="table-row data-row reports-table-row" key={row.userId}>
          <span>{row.vaName}</span>
          <span>{formatHours(row.totalSeconds)}</span>
          <span>{row.entryCount}</span>
          <span>{row.manualEntries}</span>
        </div>
      )) : <ReportEmpty />}
    </Table>
  );
}

function ActivityTable({ rows }: { rows: ActivityReportRow[] }) {
  return (
    <Table className="reports-table">
      <div className="table-row reports-table-row table-head">
        <span>VA</span>
        <span>Avg Activity</span>
        <span>Active Minutes</span>
        <span>Input Events</span>
      </div>
      {rows.length ? rows.map((row) => (
        <div className="table-row data-row reports-table-row" key={row.userId}>
          <span>{row.vaName}</span>
          <span>{formatPercent(row.averageActivity)}</span>
          <span>{row.activeMinutes}</span>
          <span>{row.keystrokes + row.mouseClicks}</span>
        </div>
      )) : <ReportEmpty />}
    </Table>
  );
}

function AppsTable({ rows }: { rows: AppUsageReportRow[] }) {
  return (
    <Table className="reports-table">
      <div className="table-row reports-table-row table-head">
        <span>App / Window</span>
        <span>Minutes</span>
        <span>Avg Activity</span>
        <span>Share</span>
      </div>
      {rows.length ? rows.map((row) => {
        const totalMinutes = rows.reduce((sum, item) => sum + item.minutes, 0);
        return (
          <div className="table-row data-row reports-table-row" key={row.appName}>
            <span>{row.appName}</span>
            <span>{row.minutes}</span>
            <span>{formatPercent(row.averageActivity)}</span>
            <span>{formatPercent(totalMinutes ? (row.minutes / totalMinutes) * 100 : 0)}</span>
          </div>
        );
      }) : <ReportEmpty />}
    </Table>
  );
}

function AttendanceTable({ rows }: { rows: AttendanceReportRow[] }) {
  return (
    <Table className="reports-table">
      <div className="table-row reports-table-row table-head">
        <span>VA</span>
        <span>Days Worked</span>
        <span>First Start</span>
        <span>Last Stop</span>
      </div>
      {rows.length ? rows.map((row) => (
        <div className="table-row data-row reports-table-row" key={row.userId}>
          <span>{row.vaName}</span>
          <span>{row.daysWorked}</span>
          <span>{row.firstStart ? new Date(row.firstStart).toLocaleString() : "-"}</span>
          <span>{row.lastStop ? new Date(row.lastStop).toLocaleString() : "-"}</span>
        </div>
      )) : <ReportEmpty />}
    </Table>
  );
}

function ProjectsTable({ rows }: { rows: ProjectReportRow[] }) {
  return (
    <Table className="reports-table">
      <div className="table-row reports-table-row table-head">
        <span>Project</span>
        <span>Total Hours</span>
        <span>Entries</span>
        <span>VAs</span>
      </div>
      {rows.length ? rows.map((row) => (
        <div className="table-row data-row reports-table-row" key={row.projectId}>
          <span>{row.projectName}</span>
          <span>{formatHours(row.totalSeconds)}</span>
          <span>{row.entryCount}</span>
          <span>{row.vaCount}</span>
        </div>
      )) : <ReportEmpty />}
    </Table>
  );
}

function ReportEmpty() {
  return (
    <div className="empty-state">
      <FileSpreadsheet size={28} />
      <strong>No report data</strong>
      <p>Try a wider date range or remove filters.</p>
    </div>
  );
}

function ReportStat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="stat-card">
      <div className="stat-icon">
        <FileSpreadsheet size={18} />
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
    </Card>
  );
}

function xlsxForReport(activeTab: ReportTab, reports: ReportsData) {
  if (activeTab === "time") {
    return {
      filename: "thrivetracker-time-report.xlsx",
      rows: [["VA", "Total Hours", "Entries", "Manual Entries"], ...reports.timeRows.map((row) => [row.vaName, formatHours(row.totalSeconds), row.entryCount, row.manualEntries])],
      sheetName: "Time Report",
    };
  }
  if (activeTab === "activity") {
    return {
      filename: "thrivetracker-activity-report.xlsx",
      rows: [["VA", "Average Activity", "Active Minutes", "Keystrokes", "Mouse Clicks"], ...reports.activityRows.map((row) => [row.vaName, formatPercent(row.averageActivity), row.activeMinutes, row.keystrokes, row.mouseClicks])],
      sheetName: "Activity Report",
    };
  }
  if (activeTab === "apps") {
    return {
      filename: "thrivetracker-app-usage-report.xlsx",
      rows: [["App", "Minutes", "Average Activity"], ...reports.appRows.map((row) => [row.appName, row.minutes, formatPercent(row.averageActivity)])],
      sheetName: "App Usage",
    };
  }
  if (activeTab === "attendance") {
    return {
      filename: "thrivetracker-attendance-report.xlsx",
      rows: [["VA", "Days Worked", "First Start", "Last Stop", "Total Hours"], ...reports.attendanceRows.map((row) => [row.vaName, row.daysWorked, row.firstStart ?? "", row.lastStop ?? "", formatHours(row.totalSeconds)])],
      sheetName: "Attendance",
    };
  }
  return {
    filename: "thrivetracker-project-report.xlsx",
    rows: [["Project", "Total Hours", "Entries", "VAs"], ...reports.projectRows.map((row) => [row.projectName, formatHours(row.totalSeconds), row.entryCount, row.vaCount])],
    sheetName: "Projects",
  };
}

function tabTitle(activeTab: ReportTab) {
  if (activeTab === "time") return "Time Report";
  if (activeTab === "activity") return "Activity Report";
  if (activeTab === "apps") return "App Usage Report";
  if (activeTab === "attendance") return "Attendance Report";
  return "Project Report";
}

function sumTime(rows: TimeReportRow[]) {
  return rows.reduce((sum, row) => sum + row.totalSeconds, 0);
}

function averageActivity(rows: ActivityReportRow[]) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + row.averageActivity, 0) / rows.length;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
