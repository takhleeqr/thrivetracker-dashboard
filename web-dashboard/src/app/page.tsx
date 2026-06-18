"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Activity, AlertTriangle, CalendarDays, Clock3, DollarSign, Download, MonitorCheck, RefreshCw, UsersRound, X } from "lucide-react";
import { Button, Card, Input, ModalFrame, Select, Table, Tabs } from "@/components/ui";
import type { DashboardAlert, DashboardRow, DashboardSummary, Profile } from "@/lib/dashboard-data";
import { closeStaleTimeEntries, loadAdminProfile, loadDashboardSummary } from "@/lib/dashboard-data";
import { formatHours, formatPercent } from "@/lib/format";
import { defaultSettings, loadSettings, type AppSettings } from "@/lib/settings-data";
import { supabase } from "@/lib/supabase";
import { endOfDayIso, formatTime, startOfDayIso, todayDateInputValue } from "@/lib/timezone";
import { downloadXlsx } from "@/lib/xlsx-export";

const navItems = [
  { label: "Overview", href: "/" },
  { label: "Team", href: "/team" },
  { label: "Projects", href: "/projects" },
  { label: "Screenshots", href: "/screenshots" },
  { label: "Reports", href: "/reports" },
  { label: "Settings", href: "/settings" },
];

const emptySummary: DashboardSummary = {
  totalHoursTodaySeconds: 0,
  totalHoursWeekSeconds: 0,
  totalEarningsToday: 0,
  onlineCount: 0,
  averageActivityPercent: 0,
  alertCount: 0,
  alerts: [],
  rows: [],
};

type OverviewRangeMode = "today" | "yesterday" | "week" | "month" | "custom";
type OverviewScreenshot = {
  capturedAt: string;
  signedUrl: string;
  vaName: string;
};

export default function DashboardHome() {
  const router = useRouter();
  const [admin, setAdmin] = useState<Profile | null>(null);
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [statusFilter, setStatusFilter] = useState<"active" | "all" | "online" | "idle" | "offline" | "low" | "attention">("active");
  const [projectFilter, setProjectFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [timezone, setTimezone] = useState("Asia/Karachi");
  const [dashboardSettings, setDashboardSettings] = useState<AppSettings>(defaultSettings);
  const [rangeMode, setRangeMode] = useState<OverviewRangeMode>("today");
  const [customDate, setCustomDate] = useState(todayDateInputValue("Asia/Karachi"));
  const [selectedScreenshot, setSelectedScreenshot] = useState<OverviewScreenshot | null>(null);
  const selectedRange = useMemo(() => buildOverviewRange(rangeMode, customDate, timezone), [customDate, rangeMode, timezone]);

  useEffect(() => {
    let isMounted = true;

    async function boot() {
      const profile = await loadAdminProfile(supabase);
      if (!isMounted) return;

      if (!profile) {
        router.replace("/login");
        return;
      }

      if (profile.role !== "admin" || !profile.is_active) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      setAdmin(profile);
      const settings = await loadSettings(supabase);
      setTimezone(settings.timezone);
      setCustomDate(todayDateInputValue(settings.timezone));
      setDashboardSettings(settings);
      await refreshData(settings.timezone, settings, buildOverviewRange(rangeMode, todayDateInputValue(settings.timezone), settings.timezone));
    }

    boot();
    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (!admin) return;
    const intervalId = window.setInterval(() => refreshData(timezone, dashboardSettings, selectedRange), 60_000);
    return () => window.clearInterval(intervalId);
  }, [admin, dashboardSettings, selectedRange, timezone]);

  async function refreshData(selectedTimezone = timezone, selectedSettings = dashboardSettings, range = selectedRange) {
    try {
      setError("");
      await closeStaleTimeEntries(supabase);
      const nextSummary = await loadDashboardSummary(supabase, selectedTimezone, selectedSettings, { range });
      setSummary(nextSummary);
      setLastUpdatedAt(new Date());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not load dashboard data.");
    } finally {
      setIsLoading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const visibleRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return summary.rows.filter((row) => {
      if (statusFilter === "active" && (row.status === "offline" || row.status === "day_off")) return false;
      if (statusFilter === "online" && row.status !== "online") return false;
      if (statusFilter === "idle" && row.status !== "idle") return false;
      if (statusFilter === "offline" && row.status !== "offline") return false;
      if (statusFilter === "low" && !row.alerts.some((alert) => alert.type === "low_activity")) return false;
      if (statusFilter === "attention" && !row.alerts.length && row.scheduleStatus !== "late" && row.scheduleStatus !== "no_show") return false;
      if (projectFilter && row.currentProjectId !== projectFilter) return false;
      if (normalizedSearch && !`${row.name} ${row.email}`.toLowerCase().includes(normalizedSearch)) return false;
      return true;
    });
  }, [projectFilter, searchTerm, statusFilter, summary.rows]);

  const projectOptions = useMemo(
    () =>
      [...new Map(summary.rows.filter((row) => row.currentProjectId).map((row) => [row.currentProjectId, row.currentProject])).entries()].map(
        ([id, name]) => ({ id: id ?? "", name }),
      ),
    [summary.rows],
  );

  const stats = [
    { label: rangeMode === "today" ? "Total Hours Today" : "Tracked Hours", value: formatHours(summary.totalHoursTodaySeconds), icon: Clock3, tone: "hours" },
    { label: rangeMode === "today" ? "Total Earnings Today" : "Payable Earnings", value: formatMoney(summary.totalEarningsToday), icon: DollarSign, tone: "earnings" },
    { label: "Total Hours This Week", value: formatHours(summary.totalHoursWeekSeconds), icon: CalendarDays, tone: "hours" },
    { label: "VAs Online", value: String(summary.onlineCount), icon: UsersRound, tone: "online" },
    { label: "Average Activity", value: formatPercent(summary.averageActivityPercent), icon: Activity, tone: "activity" },
    { label: "Productivity Score", value: String(Math.round(summary.averageActivityPercent)), icon: MonitorCheck, tone: "score" },
    { label: "Alerts", value: String(summary.alertCount), icon: AlertTriangle, tone: "alerts" },
  ];

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">ThriveTracker</p>
          <h1>Operations Desk</h1>
        </div>
        <nav className="nav-list" aria-label="Dashboard sections">
          {navItems.map((item) => (
            <Link className={item.label === "Overview" ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Live Workforce Monitor</p>
            <h2>Overview</h2>
            <p className="subtle-line">
              {admin ? admin.full_name : "Checking session"}
              {lastUpdatedAt ? `, updated ${formatTime(lastUpdatedAt, timezone)}` : ""}
            </p>
          </div>
          <div className="topbar-actions">
            <Select aria-label="Date range" onChange={(event) => setRangeMode(event.target.value as OverviewRangeMode)} value={rangeMode}>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="custom">Custom</option>
            </Select>
            {rangeMode === "custom" ? (
              <Input aria-label="Custom overview date" onChange={(event) => setCustomDate(event.target.value)} type="date" value={customDate} />
            ) : null}
            <Button onClick={() => refreshData(timezone, dashboardSettings, selectedRange)} type="button" variant="secondary">
              <RefreshCw size={16} />
              Refresh
            </Button>
            <Button onClick={() => exportRows(summary.rows)} type="button" variant="secondary">
              <Download size={16} />
              Export Excel
            </Button>
            <Button onClick={signOut} type="button" variant="ghost">
              Logout
            </Button>
          </div>
        </header>

        {error ? <div className="toast">{error}</div> : null}

        <section className="stats-grid" aria-label="Dashboard stats">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card className={`stat-card stat-${stat.tone}`} key={stat.label}>
                <div className="stat-icon">
                  <Icon size={18} />
                </div>
                <p>{stat.label}</p>
                <strong>{isLoading ? "..." : stat.value}</strong>
              </Card>
            );
          })}
        </section>
        <p className="metric-explainer">
          Productivity Score is a 0-100 weighted activity score from today&apos;s keyboard and mouse activity across tracked sessions.
        </p>

        <section className="work-area">
          <Card className="wide-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Team Status</p>
                <h3>Virtual Assistants</h3>
              </div>
              <Tabs>
                <button className={statusFilter === "active" ? "selected" : ""} onClick={() => setStatusFilter("active")}>
                  Active
                </button>
                <button className={statusFilter === "all" ? "selected" : ""} onClick={() => setStatusFilter("all")}>
                  All
                </button>
                <button className={statusFilter === "attention" ? "selected attention-chip" : "attention-chip"} onClick={() => setStatusFilter("attention")}>
                  Needs Attention
                </button>
              </Tabs>
            </div>
            {summary.alerts.length ? <AlertPanel alerts={summary.alerts} /> : null}
            <div className="overview-filters">
              <Input onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search VA name or email" value={searchTerm} />
              <Select onChange={(event) => setProjectFilter(event.target.value)} value={projectFilter}>
                <option value="">All active projects</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
              <Select onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} value={statusFilter}>
                <option value="active">Active only</option>
                <option value="online">Online</option>
                <option value="idle">Idle</option>
                <option value="offline">Offline</option>
                <option value="attention">Needs Attention</option>
                <option value="low">Low activity</option>
                <option value="all">All</option>
              </Select>
            </div>
            <Table>
              <div className="table-row overview-table-row table-head">
                <span>VA</span>
                <span>Status</span>
                <span>Project</span>
                <span>Schedule</span>
                <span>Hours Today</span>
                <span>Earnings</span>
                <span>Week</span>
                <span>Activity</span>
                <span>Alerts</span>
                <span>Last Screenshot</span>
              </div>
              {visibleRows.length ? (
                visibleRows.map((row) => <VaRow key={row.userId} onScreenshotClick={setSelectedScreenshot} row={row} />)
              ) : (
                <div className="empty-state">
                  <MonitorCheck size={28} />
                  <strong>{isLoading ? "Loading live sessions" : "No live sessions yet"}</strong>
                  <p>Once a VA starts tracking from the desktop app, they will appear here.</p>
                </div>
              )}
            </Table>
          </Card>
        </section>
      </section>
      {selectedScreenshot ? <OverviewScreenshotLightbox item={selectedScreenshot} onClose={() => setSelectedScreenshot(null)} timezone={timezone} /> : null}
    </main>
  );
}

function VaRow({ onScreenshotClick, row }: { onScreenshotClick: (item: OverviewScreenshot) => void; row: DashboardRow }) {
  return (
    <Link className="table-row data-row data-row-link overview-table-row" href={`/va/${row.userId}`}>
      <span>
        <strong>{row.name}</strong>
        <small>{row.email}</small>
      </span>
      <span>
        <span className={`status-pill status-${row.status}`}>{statusLabel(row.status)}</span>
      </span>
      <span>
        <span className={`schedule-pill schedule-${row.scheduleStatus}`}>{scheduleLabel(row.scheduleStatus)}</span>
      </span>
      <span>{row.currentProject}</span>
      <span>{formatHours(row.hoursTodaySeconds)}</span>
      <span>{formatMoney(row.earningsToday)}</span>
      <span>
        {formatHours(row.weeklyHoursSeconds)}
        {row.expectedWeekSeconds ? <small>/ {formatHours(row.expectedWeekSeconds)}</small> : null}
      </span>
      <span>{row.activityPercent === null ? "-" : formatPercent(row.activityPercent)}</span>
      <span>{row.alerts.length ? <span className="alert-badge">{row.alerts.length}</span> : "-"}</span>
      <span>
        {row.lastScreenshot?.signedUrl ? (
          <button
            className="overview-shot-button"
            onClick={(event) => openOverviewScreenshot(event, row, onScreenshotClick)}
            type="button"
          >
            <img className="overview-shot-thumb" alt={`Latest screenshot for ${row.name}`} src={row.lastScreenshot.signedUrl} />
          </button>
        ) : (
          "-"
        )}
      </span>
    </Link>
  );
}

function OverviewScreenshotLightbox({ item, onClose, timezone }: { item: OverviewScreenshot; onClose: () => void; timezone: string }) {
  return (
    <div className="modal-backdrop screenshot-lightbox-backdrop">
      <ModalFrame className="screenshot-lightbox">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Last Screenshot</p>
            <h3>{item.vaName}</h3>
            <p className="subtle-line">{formatTime(item.capturedAt, timezone)}</p>
          </div>
          <button className="modal-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        <img alt={`Latest screenshot for ${item.vaName}`} className="lightbox-image" src={item.signedUrl} />
      </ModalFrame>
    </div>
  );
}

function openOverviewScreenshot(
  event: MouseEvent<HTMLButtonElement>,
  row: DashboardRow,
  onScreenshotClick: (item: OverviewScreenshot) => void,
) {
  event.preventDefault();
  event.stopPropagation();
  if (!row.lastScreenshot?.signedUrl) return;
  onScreenshotClick({
    capturedAt: row.lastScreenshot.capturedAt,
    signedUrl: row.lastScreenshot.signedUrl,
    vaName: row.name,
  });
}

function AlertPanel({ alerts }: { alerts: DashboardAlert[] }) {
  const visibleAlerts = alerts.slice(0, 4);

  return (
    <div className="alert-panel">
      {visibleAlerts.map((alert) => (
        <Link className={`alert-item alert-${alert.severity}`} href={`/va/${alert.userId}`} key={alert.id}>
          <AlertTriangle size={17} />
          <span>
            <strong>
              {alert.vaName}: {alert.title}
            </strong>
            <small>{alert.message}</small>
          </span>
        </Link>
      ))}
      {alerts.length > visibleAlerts.length ? <div className="alert-more">+{alerts.length - visibleAlerts.length} more alerts</div> : null}
    </div>
  );
}

function exportRows(rows: DashboardRow[]) {
  downloadXlsx(
    `thrivetracker-overview-${new Date().toISOString().slice(0, 10)}.xlsx`,
    "Overview",
    [
      ["VA", "Email", "Status", "Schedule", "Project", "Hours Today", "Earnings Today", "Weekly Hours", "Expected Weekly Hours", "Activity", "Productivity Score", "Alerts", "Last Screenshot", "Last Seen"],
      ...rows.map((row) => [
        row.name,
        row.email,
        statusLabel(row.status),
        scheduleLabel(row.scheduleStatus),
        row.currentProject,
        formatHours(row.hoursTodaySeconds),
        formatMoney(row.earningsToday),
        formatHours(row.weeklyHoursSeconds),
        row.expectedWeekSeconds ? formatHours(row.expectedWeekSeconds) : "",
        row.activityPercent === null ? "" : formatPercent(row.activityPercent),
        row.productivityScore,
        row.alerts.map((alert) => alert.title).join("; "),
        row.lastScreenshot?.capturedAt ?? "",
        row.lastSeenAt ?? "",
      ]),
    ],
  );
}

function scheduleLabel(status: DashboardRow["scheduleStatus"]) {
  if (status === "on_time") return "On Time";
  if (status === "late") return "Late";
  if (status === "no_show") return "No Show";
  if (status === "day_off") return "Day Off";
  return "Not Set";
}

function statusLabel(status: DashboardRow["status"]) {
  if (status === "day_off") return "Day Off";
  return status;
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

function buildOverviewRange(mode: OverviewRangeMode, customDate: string, timezone: string) {
  const todayInput = todayDateInputValue(timezone);
  let startInput = todayInput;
  let endInput = todayInput;

  if (mode === "yesterday") {
    const date = dateFromInput(todayInput);
    date.setDate(date.getDate() - 1);
    startInput = inputFromDate(date);
    endInput = startInput;
  }

  if (mode === "week") {
    const date = dateFromInput(todayInput);
    const daysSinceMonday = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - daysSinceMonday);
    startInput = inputFromDate(date);
  }

  if (mode === "month") {
    const date = dateFromInput(todayInput);
    date.setDate(1);
    startInput = inputFromDate(date);
  }

  if (mode === "custom") {
    startInput = customDate || todayInput;
    endInput = startInput;
  }

  return {
    start: startOfDayIso(startInput, timezone),
    end: mode === "today" || mode === "week" || mode === "month" ? new Date().toISOString() : endOfDayIso(endInput, timezone),
  };
}

function dateFromInput(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date();
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function inputFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
