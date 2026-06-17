"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, AlertTriangle, Clock3, Download, MonitorCheck, RefreshCw, UsersRound } from "lucide-react";
import { Button, Card, Input, Select, Table, Tabs } from "@/components/ui";
import type { DashboardAlert, DashboardRow, DashboardSummary, Profile } from "@/lib/dashboard-data";
import { closeStaleTimeEntries, loadAdminProfile, loadDashboardSummary } from "@/lib/dashboard-data";
import { formatHours, formatPercent } from "@/lib/format";
import { supabase } from "@/lib/supabase";
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
  onlineCount: 0,
  averageActivityPercent: 0,
  alertCount: 0,
  alerts: [],
  rows: [],
};

export default function DashboardHome() {
  const router = useRouter();
  const [admin, setAdmin] = useState<Profile | null>(null);
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [statusFilter, setStatusFilter] = useState<"active" | "all" | "online" | "idle" | "offline" | "low">("active");
  const [projectFilter, setProjectFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

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
      await refreshData();
    }

    boot();

    const intervalId = window.setInterval(refreshData, 15_000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [router]);

  async function refreshData() {
    try {
      setError("");
      await closeStaleTimeEntries(supabase);
      const nextSummary = await loadDashboardSummary(supabase);
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
      if (statusFilter === "active" && row.status === "offline") return false;
      if (statusFilter === "online" && row.status !== "online") return false;
      if (statusFilter === "idle" && row.status !== "idle") return false;
      if (statusFilter === "offline" && row.status !== "offline") return false;
      if (statusFilter === "low" && !row.alerts.some((alert) => alert.type === "low_activity")) return false;
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
    { label: "Total Hours Today", value: formatHours(summary.totalHoursTodaySeconds), icon: Clock3 },
    { label: "VAs Online", value: String(summary.onlineCount), icon: UsersRound },
    { label: "Average Activity", value: formatPercent(summary.averageActivityPercent), icon: Activity },
    { label: "Productivity Score", value: String(Math.round(summary.averageActivityPercent)), icon: MonitorCheck },
    { label: "Alerts", value: String(summary.alertCount), icon: AlertTriangle },
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
              {lastUpdatedAt ? `, updated ${lastUpdatedAt.toLocaleTimeString()}` : ""}
            </p>
          </div>
          <div className="topbar-actions">
            <Select aria-label="Date range" defaultValue="today">
              <option value="today">Today</option>
            </Select>
            <Button onClick={refreshData} type="button" variant="secondary">
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
              <Card className="stat-card" key={stat.label}>
                <div className="stat-icon">
                  <Icon size={18} />
                </div>
                <p>{stat.label}</p>
                <strong>{isLoading ? "..." : stat.value}</strong>
              </Card>
            );
          })}
        </section>

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
                <option value="low">Low activity</option>
                <option value="all">All</option>
              </Select>
            </div>
            <Table>
              <div className="table-row overview-table-row table-head">
                <span>VA</span>
                <span>Status</span>
                <span>Project</span>
                <span>Hours</span>
                <span>Activity</span>
                <span>Score</span>
                <span>Alerts</span>
                <span>Last Shot</span>
              </div>
              {visibleRows.length ? (
                visibleRows.map((row) => <VaRow key={row.userId} row={row} />)
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
    </main>
  );
}

function VaRow({ row }: { row: DashboardRow }) {
  return (
    <Link className="table-row data-row data-row-link overview-table-row" href={`/va/${row.userId}`}>
      <span>
        <strong>{row.name}</strong>
        <small>{row.email}</small>
      </span>
      <span>
        <span className={`status-pill status-${row.status}`}>{row.status}</span>
      </span>
      <span>{row.currentProject}</span>
      <span>{formatHours(row.hoursTodaySeconds)}</span>
      <span>{row.activityPercent === null ? "-" : formatPercent(row.activityPercent)}</span>
      <span>{row.productivityScore}</span>
      <span>{row.alerts.length ? <span className="alert-badge">{row.alerts.length}</span> : "-"}</span>
      <span>
        {row.lastScreenshot?.signedUrl ? (
          <img className="overview-shot-thumb" alt={`Latest screenshot for ${row.name}`} src={row.lastScreenshot.signedUrl} />
        ) : (
          "-"
        )}
      </span>
    </Link>
  );
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
      ["VA", "Email", "Status", "Project", "Hours Today", "Activity", "Productivity Score", "Alerts", "Last Screenshot", "Last Seen"],
      ...rows.map((row) => [
        row.name,
        row.email,
        row.status,
        row.currentProject,
        formatHours(row.hoursTodaySeconds),
        row.activityPercent === null ? "" : formatPercent(row.activityPercent),
        row.productivityScore,
        row.alerts.map((alert) => alert.title).join("; "),
        row.lastScreenshot?.capturedAt ?? "",
        row.lastSeenAt ?? "",
      ]),
    ],
  );
}
