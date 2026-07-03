"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Activity, ArrowLeft, Camera, Clock3, Download, Monitor, Plus, RefreshCw, Rows3, TimerReset, X, type LucideIcon } from "lucide-react";
import { Button, Card, Input, ModalFrame, Select, Table, Tabs } from "@/components/ui";
import type { ActivityLog, DetailDateRange, Screenshot, VaDetail } from "@/lib/dashboard-data";
import { closeStaleTimeEntries, loadAdminProfile, loadVaDetail } from "@/lib/dashboard-data";
import { formatHours, formatPercent } from "@/lib/format";
import { loadSettings } from "@/lib/settings-data";
import { supabase } from "@/lib/supabase";
import {
  endOfDayIso,
  formatDate,
  formatDateTimeFull,
  formatDateTime as formatInTimezone,
  formatTime,
  startOfDayIso,
  todayDateInputValue,
  zonedDateTimeToUtc,
} from "@/lib/timezone";

type RangeMode = "today" | "last24h" | "week" | "month" | "custom";
type ManualEntryForm = {
  date: string;
  endTime: string;
  note: string;
  projectId: string;
  startTime: string;
};

type ActivityLogItem = {
  id: string;
  kind: "session" | "break" | "idle" | "offline" | "stopped" | "untracked";
  title: string;
  reason: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  tone: "work" | "break" | "alert" | "neutral";
  session: VaDetail["timeEntries"][number] | null;
};

type ScreenshotGroup = {
  id: string;
  label: string;
  shots: Screenshot[];
};

export default function VaDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const [detail, setDetail] = useState<VaDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [timezone, setTimezone] = useState("Asia/Karachi");
  const [customStart, setCustomStart] = useState(todayDateInputValue("Asia/Karachi"));
  const [customEnd, setCustomEnd] = useState(todayDateInputValue("Asia/Karachi"));
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualForm, setManualForm] = useState<ManualEntryForm>(() => createManualEntryForm(todayDateInputValue("Asia/Karachi")));
  const [manualError, setManualError] = useState("");
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [unproductiveApps, setUnproductiveApps] = useState<string[]>([]);
  const [isReady, setIsReady] = useState(false);

  const selectedRange = useMemo(
    () => buildDateRange(rangeMode, customStart, customEnd, timezone),
    [rangeMode, customStart, customEnd, timezone],
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

      const settings = await loadSettings(supabase);
      if (!isMounted) return;
      setTimezone(settings.timezone);
      setUnproductiveApps(parseUnproductiveApps(settings.app_categories_unproductive));
      setCustomStart(todayDateInputValue(settings.timezone));
      setCustomEnd(todayDateInputValue(settings.timezone));
      setIsReady(true);
    }

    boot();
    return () => {
      isMounted = false;
    };
  }, [router, userId]);

  useEffect(() => {
    if (!isReady) return;
    refreshData(selectedRange, timezone);
  }, [isReady, selectedRange, timezone]);

  useEffect(() => {
    if (!isReady) return;
    const intervalId = window.setInterval(() => refreshData(selectedRange, timezone), 30_000);
    return () => window.clearInterval(intervalId);
  }, [isReady, selectedRange, timezone]);

  async function refreshData(range = selectedRange, selectedTimezone = timezone) {
    try {
      setError("");
      await closeStaleTimeEntries(supabase);
      const nextDetail = await loadVaDetail(supabase, userId, range, selectedTimezone);
      setDetail(nextDetail);
      setLastUpdatedAt(new Date());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not load VA detail.");
    } finally {
      setIsLoading(false);
    }
  }

  function openManualEntryModal() {
    setManualError("");
    setManualForm({
      ...createManualEntryForm(todayDateInputValue(timezone)),
      projectId: detail?.projectOptions[0]?.id ?? "",
    });
    setIsManualModalOpen(true);
  }

  async function saveManualEntry() {
    if (!detail) return;

    const note = manualForm.note.trim();
    if (!manualForm.projectId) {
      setManualError("Choose a project first.");
      return;
    }
    if (!manualForm.date || !manualForm.startTime || !manualForm.endTime) {
      setManualError("Enter the date, start time, and end time.");
      return;
    }
    if (!note) {
      setManualError("Add a short reason or note for this manual entry.");
      return;
    }

    const startedAt = zonedDateTimeToUtc(manualForm.date, manualForm.startTime, timezone);
    const stoppedAt = zonedDateTimeToUtc(manualForm.date, manualForm.endTime, timezone);
    const durationSeconds = Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000);

    if (durationSeconds <= 0) {
      setManualError("End time must be after start time on the same date.");
      return;
    }

    setIsSavingManual(true);
    setManualError("");
    const { error: insertError } = await supabase.from("time_entries").insert({
      duration_seconds: durationSeconds,
      is_manual: true,
      manual_note: note,
      project_id: manualForm.projectId,
      started_at: startedAt.toISOString(),
      stop_reason: "manual",
      stopped_at: stoppedAt.toISOString(),
      user_id: userId,
    });
    setIsSavingManual(false);

    if (insertError) {
      setManualError(insertError.message);
      return;
    }

    setIsManualModalOpen(false);
    await refreshData();
  }

  const activityItems = useMemo(() => buildActivityLogItems(detail), [detail]);

  useEffect(() => {
    if (!selectedActivityId) return;
    if (!activityItems.some((item) => item.id === selectedActivityId)) {
      setSelectedActivityId(null);
    }
  }, [activityItems, selectedActivityId]);

  const selectedActivity = useMemo(
    () => activityItems.find((item) => item.id === selectedActivityId) ?? null,
    [activityItems, selectedActivityId],
  );
  const selectedSession = selectedActivity?.session ?? null;
  const scopedLogs = useMemo(
    () => (selectedSession ? detail?.activityLogs.filter((log) => log.time_entry_id === selectedSession.id) ?? [] : detail?.activityLogs ?? []),
    [detail?.activityLogs, selectedSession],
  );
  const scopedScreenshots = useMemo(
    () => (selectedSession ? detail?.screenshots.filter((shot) => shot.time_entry_id === selectedSession.id) ?? [] : detail?.screenshots ?? []),
    [detail?.screenshots, selectedSession],
  );
  const scopedAppUsage = useMemo(
    () => (selectedSession ? buildAppUsageFromLogs(scopedLogs) : detail?.appUsage ?? []),
    [detail?.appUsage, scopedLogs, selectedSession],
  );
  const screenshotGroups = useMemo(
    () => (selectedSession ? [] : groupScreenshotsBySession(detail, timezone)),
    [detail, selectedSession, timezone],
  );
  const scopedKeystrokes = scopedLogs.reduce((sum, log) => sum + Number(log.keystrokes_count ?? 0), 0);
  const scopedClicks = scopedLogs.reduce((sum, log) => sum + Number(log.mouse_clicks_count ?? 0), 0);
  const scopedAverageActivity = selectedSession ? selectedSession.averageActivityPercent : averageActivityFromLogs(scopedLogs);
  const scopedScore = selectedSession ? selectedSession.productivityScore : productivityScore(scopedAverageActivity);
  const scopedIdleMinutes = selectedSession ? selectedSession.idleMinutes : scopedLogs.filter((log) => Number(log.activity_percent ?? 0) === 0).length;
  const scopedDurationSeconds = selectedActivity ? selectedActivity.durationSeconds : detail?.totalHoursTodaySeconds ?? 0;
  const scopedPay = earningsForSeconds(scopedDurationSeconds, Number(detail?.profile.hourly_rate ?? 0));
  const durationCardLabel = rangeMode === "today" ? "Hours Today" : rangeMode === "last24h" ? "Last 24 Hours" : "Tracked Hours";

  if (isLoading && !detail) {
    return (
      <main className="detail-shell">
        <Card className="detail-card empty-state">
          <Rows3 size={28} />
          <strong>Loading VA day view</strong>
          <p>Pulling time entries, screenshots, app usage, and activity.</p>
        </Card>
      </main>
    );
  }

  return (
    <main className="detail-shell">
      <header className="detail-topbar">
        <div>
          <Link className="back-link" href="/">
            <ArrowLeft size={16} />
            Overview
          </Link>
          <p className="eyebrow">VA Detail View</p>
          <h1>{detail?.profile.full_name ?? "Virtual Assistant"}</h1>
          <p className="subtle-line">
            {detail?.profile.email}
            {detail?.lastSeenAt ? `, last seen ${formatDateTimeFull(detail.lastSeenAt, timezone)}` : ""}
            {lastUpdatedAt ? `, updated ${formatTime(lastUpdatedAt, timezone)}` : ""}
          </p>
        </div>
        <div className="topbar-actions">
          <Button onClick={openManualEntryModal} type="button" variant="secondary">
            <Plus size={16} />
            Add Manual Entry
          </Button>
          <Button onClick={() => refreshData()} type="button" variant="secondary">
            <RefreshCw size={16} />
            Refresh
          </Button>
        </div>
      </header>

      <Card className="detail-card range-card">
        <Tabs>
          <button className={rangeMode === "today" ? "selected" : ""} onClick={() => setRangeMode("today")} type="button">
            Today
          </button>
          <button className={rangeMode === "last24h" ? "selected" : ""} onClick={() => setRangeMode("last24h")} type="button">
            Last 24 Hours
          </button>
          <button className={rangeMode === "week" ? "selected" : ""} onClick={() => setRangeMode("week")} type="button">
            Week
          </button>
          <button className={rangeMode === "month" ? "selected" : ""} onClick={() => setRangeMode("month")} type="button">
            Month
          </button>
          <button className={rangeMode === "custom" ? "selected" : ""} onClick={() => setRangeMode("custom")} type="button">
            Custom
          </button>
        </Tabs>
        <div className="range-summary">
          <strong>{rangeLabel(selectedRange, timezone)}</strong>
          {rangeMode === "custom" ? (
            <div className="custom-range-fields">
              <Input aria-label="Custom start date" onChange={(event) => setCustomStart(event.target.value)} type="date" value={customStart} />
              <Input aria-label="Custom end date" onChange={(event) => setCustomEnd(event.target.value)} type="date" value={customEnd} />
            </div>
          ) : null}
        </div>
      </Card>

      {error ? <div className="toast">{error}</div> : null}

      {detail ? (
        <>
          <section className="stats-grid detail-stats" aria-label="VA stats">
            <StatCard icon={Clock3} label={durationCardLabel} tone="hours" value={formatHours(detail.totalHoursTodaySeconds)} />
            <StatCard icon={Activity} label="Productivity Score" tone="score" value={String(detail.productivityScore)} />
            <StatCard icon={Camera} label="Screenshots" tone="screenshots" value={String(detail.screenshotCount)} />
            <StatCard icon={TimerReset} label="Break Time" tone="activity" value={formatHours(totalBreakSeconds(activityItems))} />
            <StatCard icon={Clock3} label="Earnings This Week" tone="earnings" value={formatMoney(detail.earningsThisWeek)} />
            <StatCard icon={Clock3} label="Earnings This Month" tone="earnings" value={formatMoney(detail.earningsThisMonth)} />
          </section>
          <p className="metric-explainer">
            Click any row in the activity log to focus that session. If nothing is selected, the panels below show the whole chosen time window.
          </p>

          <section className="detail-grid">
            <Card className="detail-card detail-main-card">
              <SectionTitle eyebrow="Activity" title="Activity Log" />
              <ActivityStrip
                items={activityItems}
                onSelect={setSelectedActivityId}
                rangeEnd={detail.rangeEnd}
                rangeStart={detail.rangeStart}
                selectedId={selectedActivityId}
                timezone={timezone}
              />
              <ActivityLogTable items={activityItems} onSelect={setSelectedActivityId} selectedId={selectedActivityId} timezone={timezone} />
            </Card>

            <Card className="detail-card">
              <SelectionDetailsCard
                detail={detail}
                onClear={() => setSelectedActivityId(null)}
                scopedAppUsage={scopedAppUsage}
                scopedAverageActivity={scopedAverageActivity}
                scopedClicks={scopedClicks}
                scopedDurationSeconds={scopedDurationSeconds}
                scopedIdleMinutes={scopedIdleMinutes}
                scopedKeystrokes={scopedKeystrokes}
                scopedPay={scopedPay}
                scopedScore={scopedScore}
                scopedScreenshotsCount={selectedSession ? scopedScreenshots.length : detail.screenshotCount}
                selectedActivity={selectedActivity}
                selectedSession={selectedSession}
                timezone={timezone}
                unproductiveApps={unproductiveApps}
              />
            </Card>
          </section>

          <section className="detail-grid detail-grid-wide">
            <Card className="detail-card">
              <SectionTitle eyebrow="Activity" title={selectedSession ? "Minute Activity for Selected Session" : "Minute Activity for Selected Time Window"} />
              <ActivityChart logs={scopedLogs} timezone={timezone} />
            </Card>

            <Card className="detail-card">
              <PayrollPanel detail={detail} selectedActivity={selectedActivity} selectedSession={selectedSession} timezone={timezone} />
            </Card>
          </section>

          <Card className="detail-card">
            <SectionTitle eyebrow="Visual Audit" title={selectedSession ? "Session Screenshots" : "Screenshots for Selected Time Window"} />
            <p className="subtle-line">
              {selectedSession
                ? "Only screenshots from the selected session are shown here."
                : "Screenshots are grouped by session so the whole time window is easier to review."}
            </p>
            <ScreenshotsPanel
              groups={screenshotGroups}
              screenshots={scopedScreenshots}
              selectedActivity={selectedActivity}
              selectedSession={selectedSession}
              setSelectedScreenshot={setSelectedScreenshot}
              timezone={timezone}
            />
          </Card>

          {isManualModalOpen ? (
            <ManualEntryModal
              error={manualError}
              form={manualForm}
              isSaving={isSavingManual}
              onCancel={() => setIsManualModalOpen(false)}
              onChange={setManualForm}
              onSave={saveManualEntry}
              projects={detail.projectOptions}
            />
          ) : null}
          {selectedScreenshot ? <ScreenshotLightbox screenshot={selectedScreenshot} onClose={() => setSelectedScreenshot(null)} timezone={timezone} /> : null}
        </>
      ) : null}
    </main>
  );
}

function StatCard({ icon: Icon, label, tone, value }: { icon: LucideIcon; label: string; tone: string; value: string }) {
  return (
    <Card className={`stat-card stat-${tone}`}>
      <div className="stat-icon">
        <Icon size={18} />
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
    </Card>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
      </div>
    </div>
  );
}

function ManualEntryModal({
  error,
  form,
  isSaving,
  onCancel,
  onChange,
  onSave,
  projects,
}: {
  error: string;
  form: ManualEntryForm;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (form: ManualEntryForm) => void;
  onSave: () => void;
  projects: VaDetail["projectOptions"];
}) {
  return (
    <div className="modal-backdrop">
      <ModalFrame className="project-editor">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Manual Time</p>
            <h3>Add Manual Entry</h3>
            <p className="subtle-line">Use this only for approved corrections, missed starts, or verified offline work.</p>
          </div>
          <button className="modal-close" onClick={onCancel} type="button">
            <X size={18} />
          </button>
        </div>

        <div className="editor-grid manual-entry-grid">
          <label>
            Project
            <Select onChange={(event) => onChange({ ...form, projectId: event.target.value })} value={form.projectId}>
              {projects.length ? (
                projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))
              ) : (
                <option value="">No assigned projects</option>
              )}
            </Select>
          </label>
          <label>
            Date
            <Input onChange={(event) => onChange({ ...form, date: event.target.value })} type="date" value={form.date} />
          </label>
          <label>
            Start Time
            <Input onChange={(event) => onChange({ ...form, startTime: event.target.value })} type="time" value={form.startTime} />
          </label>
          <label>
            End Time
            <Input onChange={(event) => onChange({ ...form, endTime: event.target.value })} type="time" value={form.endTime} />
          </label>
          <label className="manual-note-field">
            Reason / Note
            <textarea
              className="field field-textarea"
              onChange={(event) => onChange({ ...form, note: event.target.value })}
              placeholder="Example: Forgot to start timer after approved work call."
              value={form.note}
            />
          </label>
        </div>

        {error ? <div className="toast manual-entry-error">{error}</div> : null}

        <div className="modal-actions">
          <Button onClick={onCancel} type="button" variant="secondary">
            Cancel
          </Button>
          <Button disabled={isSaving || !projects.length} onClick={onSave} type="button">
            {isSaving ? "Saving..." : "Save Manual Entry"}
          </Button>
        </div>
      </ModalFrame>
    </div>
  );
}

function ActivityStrip({
  items,
  onSelect,
  rangeEnd,
  rangeStart,
  selectedId,
  timezone,
}: {
  items: ActivityLogItem[];
  onSelect: (id: string) => void;
  rangeEnd: string;
  rangeStart: string;
  selectedId: string | null;
  timezone: string;
}) {
  if (!items.length) {
    return <EmptySmall icon={Rows3} title="No activity yet" text="Tracked work and gaps will appear here." />;
  }

  return (
    <div className="activity-strip">
      <div className="timeline-axis">
        {timelineAxisLabels(rangeStart, rangeEnd, timezone).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="activity-strip-track">
        {items.map((item) => {
          const position = timelinePosition(item.startedAt, item.endedAt, rangeStart, rangeEnd);
          return (
            <button
              className={`activity-strip-block tone-${item.tone} ${selectedId === item.id ? "is-selected" : ""}`}
              key={item.id}
              onClick={() => onSelect(item.id)}
              style={{ left: `${position.left}%`, width: `${position.width}%` }}
              title={`${item.title}: ${formatHours(item.durationSeconds)}`}
              type="button"
            />
          );
        })}
      </div>
    </div>
  );
}

function ActivityLogTable({
  items,
  onSelect,
  selectedId,
  timezone,
}: {
  items: ActivityLogItem[];
  onSelect: (id: string) => void;
  selectedId: string | null;
  timezone: string;
}) {
  return (
    <div className="activity-log-table">
      <div className="activity-log-head">
        <span>Time</span>
        <span>Type</span>
        <span>Duration</span>
        <span>Reason</span>
        <span>Activity</span>
        <span>Keys</span>
        <span>Clicks</span>
        <span>Shots</span>
        <span>Score</span>
      </div>
      {items.map((item) => (
        <button
          className={`activity-log-row tone-${item.tone} ${selectedId === item.id ? "is-selected" : ""}`}
          key={item.id}
          onClick={() => onSelect(item.id)}
          type="button"
        >
          <span>
            <strong>{formatInTimezone(item.startedAt, timezone)}</strong>
            <small>{formatInTimezone(item.endedAt, timezone)}</small>
          </span>
          <span>{item.title}</span>
          <span>{formatHours(item.durationSeconds)}</span>
          <span>{item.reason}</span>
          <span>{item.session?.averageActivityPercent === null || item.session === null ? "-" : formatPercent(item.session.averageActivityPercent)}</span>
          <span>{item.session?.totalKeystrokes ?? "-"}</span>
          <span>{item.session?.totalMouseClicks ?? "-"}</span>
          <span>{item.session?.screenshotsTaken ?? "-"}</span>
          <span>{item.session?.productivityScore ?? "-"}</span>
        </button>
      ))}
    </div>
  );
}

function SelectionDetailsCard({
  detail,
  onClear,
  scopedAppUsage,
  scopedAverageActivity,
  scopedClicks,
  scopedDurationSeconds,
  scopedIdleMinutes,
  scopedKeystrokes,
  scopedPay,
  scopedScore,
  scopedScreenshotsCount,
  selectedActivity,
  selectedSession,
  timezone,
  unproductiveApps,
}: {
  detail: VaDetail;
  onClear: () => void;
  scopedAppUsage: VaDetail["appUsage"];
  scopedAverageActivity: number | null;
  scopedClicks: number;
  scopedDurationSeconds: number;
  scopedIdleMinutes: number;
  scopedKeystrokes: number;
  scopedPay: number;
  scopedScore: number;
  scopedScreenshotsCount: number;
  selectedActivity: ActivityLogItem | null;
  selectedSession: VaDetail["timeEntries"][number] | null;
  timezone: string;
  unproductiveApps: string[];
}) {
  const title = selectedSession
    ? "Selected Session"
    : selectedActivity
      ? selectedActivity.title
      : "Selected Time Window";
  const subtitle = selectedSession
    ? `${formatDateTimeFull(selectedActivity?.startedAt ?? selectedSession.started_at, timezone)} to ${formatDateTimeFull(selectedActivity?.endedAt ?? selectedSession.stopped_at ?? selectedSession.started_at, timezone)}`
    : selectedActivity
      ? `${formatDateTimeFull(selectedActivity.startedAt, timezone)} to ${formatDateTimeFull(selectedActivity.endedAt, timezone)}`
      : `${formatDate(detail.rangeStart, timezone)} to ${formatDate(detail.rangeEnd, timezone)}`;

  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Details</p>
          <h3>{title}</h3>
          <p className="subtle-line">{subtitle}</p>
        </div>
        {selectedActivity ? (
          <Button onClick={onClear} type="button" variant="secondary">
            Show Whole Window
          </Button>
        ) : null}
      </div>

      <div className="detail-metric-grid">
        <MetricCard label="Duration" value={formatHours(scopedDurationSeconds)} />
        <MetricCard label="Payable" value={formatMoney(scopedPay)} />
        <MetricCard label="Avg Activity" value={scopedAverageActivity === null ? "-" : formatPercent(scopedAverageActivity)} />
        <MetricCard label="Score" value={String(scopedScore)} />
        <MetricCard label="Keystrokes" value={String(scopedKeystrokes)} />
        <MetricCard label="Clicks" value={String(scopedClicks)} />
        <MetricCard label="Idle Min" value={String(scopedIdleMinutes)} />
        <MetricCard label="Shots" value={String(scopedScreenshotsCount)} />
      </div>

      {selectedActivity && !selectedSession ? (
        <div className="selection-note">
          <strong>{selectedActivity.reason}</strong>
          <p>No keyboard, mouse, screenshot, or app detail exists for this non-working period.</p>
        </div>
      ) : null}

      <div className="app-usage-list">
        <div className="app-usage-row">
          <span>
            <strong>{selectedSession ? "Session reason" : "Latest login device"}</strong>
            <small>
              {selectedSession
                ? stopReasonLabel(selectedSession)
                : detail.lastDevice
                  ? deviceLabel(detail.lastDevice.hostname, detail.lastDevice.os_username)
                  : "No device recorded yet"}
            </small>
          </span>
          <b>{selectedSession ? "Why it ended" : "Access"}</b>
        </div>
        {selectedSession ? (
          <div className="app-usage-row">
            <span>
              <strong>Session device</strong>
              <small>{selectedSession.device_hostname ? deviceLabel(selectedSession.device_hostname, selectedSession.device_os_username) : "Device not captured"}</small>
            </span>
            <b>PC</b>
          </div>
        ) : detail.lastDevice ? (
          <div className="app-usage-row">
            <span>
              <strong>Last heartbeat</strong>
              <small>{detail.lastDevice.last_seen_at ? formatDateTimeFull(detail.lastDevice.last_seen_at, timezone) : "No heartbeat yet"}</small>
            </span>
            <b>Live</b>
          </div>
        ) : null}
      </div>

      <SectionTitle eyebrow="Apps" title={selectedSession ? "Apps in This Session" : "Apps in This Time Window"} />
      <div className="app-usage-list">
        {scopedAppUsage.length ? (
          scopedAppUsage.map((app) => {
            const isUnproductive = appIsUnproductive(app.appName, unproductiveApps);
            return (
              <div className="app-usage-row" key={app.appName}>
                <span>
                  <strong>
                    {app.appName}
                    {isUnproductive ? <b className="unproductive-badge">Unproductive</b> : null}
                  </strong>
                  <small>{app.minutes} min tracked</small>
                </span>
                <b>{formatPercent(app.averageActivityPercent)}</b>
              </div>
            );
          })
        ) : (
          <EmptySmall icon={Monitor} title="No app data yet" text="App activity appears for tracked work sessions only." />
        )}
      </div>
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-metric-card">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function ActivityChart({ logs, timezone }: { logs: ActivityLog[]; timezone: string }) {
  if (!logs.length) {
    return <EmptySmall icon={Activity} title="No activity logs yet" text="Minute activity appears while the desktop timer is running." />;
  }

  const sampledLogs = sampleLogs(logs, 72);
  const axisLogs = activityAxisLabels(sampledLogs, timezone);

  return (
    <>
      <div className="activity-chart" aria-label="Activity percentage chart">
        {sampledLogs.map((log) => (
          <span
            className="activity-bar"
            key={log.id}
            style={{ height: `${Math.max(6, Number(log.activity_percent ?? 0))}%` }}
            title={`${formatTime(log.timestamp, timezone)}: ${formatPercent(log.activity_percent)}`}
          />
        ))}
      </div>
      <div className="activity-axis">
        {axisLogs.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </>
  );
}

function PayrollPanel({
  detail,
  selectedActivity,
  selectedSession,
  timezone,
}: {
  detail: VaDetail;
  selectedActivity: ActivityLogItem | null;
  selectedSession: VaDetail["timeEntries"][number] | null;
  timezone: string;
}) {
  const hourlyRate = Number(detail.profile.hourly_rate ?? 0);

  if (selectedSession && selectedActivity) {
    return (
      <>
        <SectionTitle eyebrow="Payroll" title="Selected Session Pay" />
        <Table className="compact-table">
          <div className="table-row payroll-table-row table-head">
            <span>Hours Worked</span>
            <span>Rate</span>
            <span>Payable</span>
          </div>
          <div className="table-row data-row payroll-table-row">
            <span>{formatHours(selectedActivity.durationSeconds)}</span>
            <span>{formatMoney(hourlyRate)}/hr</span>
            <span>{formatMoney(earningsForSeconds(selectedActivity.durationSeconds, hourlyRate))}</span>
          </div>
        </Table>
        <div className="selection-note">
          <strong>{formatDateTimeFull(selectedActivity.startedAt, timezone)}</strong>
          <p>{stopReasonLabel(selectedSession)}</p>
        </div>
      </>
    );
  }

  if (selectedActivity && !selectedSession) {
    return (
      <>
        <SectionTitle eyebrow="Payroll" title="Selected Period Pay" />
        <EmptySmall icon={Clock3} title="No payable time" text="Breaks, idle gaps, stopped periods, and disconnected periods do not create payroll." />
      </>
    );
  }

  const totalSeconds = detail.dailyPay.reduce((sum, day) => sum + day.seconds, 0);
  const totalPay = detail.dailyPay.reduce((sum, day) => sum + day.earnings, 0);

  return (
    <>
      <SectionTitle eyebrow="Payroll" title="Hours and Pay By Date" />
      <p className="subtle-line">Rate: {formatMoney(hourlyRate)}/hr</p>
      <Table className="compact-table">
        <div className="table-row payroll-table-row table-head">
          <span>Date</span>
          <span>Hours Worked</span>
          <span>Payable</span>
        </div>
        {detail.dailyPay.length ? (
          <>
            {detail.dailyPay.map((day) => (
              <div className="table-row data-row payroll-table-row" key={day.date}>
                <span>{day.date}</span>
                <span>{formatHours(day.seconds)}</span>
                <span>{formatMoney(day.earnings)}</span>
              </div>
            ))}
            <div className="table-row data-row payroll-table-row payroll-total-row">
              <span>Total</span>
              <span>{formatHours(totalSeconds)}</span>
              <span>{formatMoney(totalPay)}</span>
            </div>
          </>
        ) : (
          <EmptySmall icon={Clock3} title="No payroll rows" text="Tracked or manual time entries create daily payroll rows." />
        )}
      </Table>
    </>
  );
}

function ScreenshotsPanel({
  groups,
  screenshots,
  selectedActivity,
  selectedSession,
  setSelectedScreenshot,
  timezone,
}: {
  groups: ScreenshotGroup[];
  screenshots: Screenshot[];
  selectedActivity: ActivityLogItem | null;
  selectedSession: VaDetail["timeEntries"][number] | null;
  setSelectedScreenshot: (screenshot: Screenshot) => void;
  timezone: string;
}) {
  if (selectedActivity && !selectedSession) {
    return <EmptySmall icon={Camera} title="No screenshots for this period" text="Screenshots exist only while a work session is actively being tracked." />;
  }

  if (selectedSession) {
    return <ScreenshotGrid screenshots={screenshots} setSelectedScreenshot={setSelectedScreenshot} timezone={timezone} />;
  }

  if (!groups.length) {
    return <EmptySmall icon={Camera} title="No screenshots in this time window" text="Screenshots appear after the desktop agent uploads them." />;
  }

  return (
    <div className="screenshot-session-groups">
      {groups.map((group) => (
        <div className="screenshot-session-group" key={group.id}>
          <div className="section-heading">
            <div>
              <h3>{group.label}</h3>
              <p className="subtle-line">{group.shots.length} screenshot(s)</p>
            </div>
          </div>
          <ScreenshotGrid screenshots={group.shots} setSelectedScreenshot={setSelectedScreenshot} timezone={timezone} />
        </div>
      ))}
    </div>
  );
}

function ScreenshotGrid({
  screenshots,
  setSelectedScreenshot,
  timezone,
}: {
  screenshots: Screenshot[];
  setSelectedScreenshot: (screenshot: Screenshot) => void;
  timezone: string;
}) {
  return (
    <div className="screenshot-grid">
      {screenshots.length ? (
        screenshots.map((screenshot) => (
          <div className="screenshot-card" key={screenshot.id}>
            <button className="screenshot-open-button" disabled={!screenshot.signedUrl} onClick={() => setSelectedScreenshot(screenshot)} type="button">
              {screenshot.signedUrl ? (
                <img alt={`Screenshot from ${formatTime(screenshot.captured_at, timezone)}`} src={screenshot.signedUrl} />
              ) : (
                <div className="screenshot-missing">Signed URL unavailable</div>
              )}
              <span>
                <strong>{formatTime(screenshot.captured_at, timezone)}</strong>
                <small>{screenshot.activity_percent_at_capture === null ? "Activity -" : formatPercent(screenshot.activity_percent_at_capture)}</small>
              </span>
            </button>
            {screenshot.signedUrl ? (
              <button className="download-chip" onClick={(event) => downloadFromClick(event, screenshot.signedUrl!, screenshot.storage_key)} type="button">
                <Download size={14} />
                Download
              </button>
            ) : null}
          </div>
        ))
      ) : (
        <EmptySmall icon={Camera} title="No screenshots found" text="Screenshots appear after the desktop agent uploads them." />
      )}
    </div>
  );
}

function EmptySmall({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="empty-small">
      <Icon size={22} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function ScreenshotLightbox({ screenshot, onClose, timezone }: { screenshot: Screenshot; onClose: () => void; timezone: string }) {
  return (
    <div className="modal-backdrop screenshot-lightbox-backdrop">
      <ModalFrame className="screenshot-lightbox">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Screenshot</p>
            <h3>{formatDateTimeFull(screenshot.captured_at, timezone)}</h3>
            <p className="subtle-line">
              {screenshot.activity_percent_at_capture === null ? "Activity -" : formatPercent(screenshot.activity_percent_at_capture)}
            </p>
          </div>
          <div className="lightbox-actions">
            {screenshot.signedUrl ? (
              <Button onClick={() => downloadScreenshot(screenshot.signedUrl!, screenshot.storage_key)} type="button" variant="secondary">
                <Download size={16} />
                Download
              </Button>
            ) : null}
            <button className="modal-close" onClick={onClose} type="button">
              <X size={18} />
            </button>
          </div>
        </div>
        {screenshot.signedUrl ? (
          <img alt="Full screenshot" className="lightbox-image" src={screenshot.signedUrl} />
        ) : (
          <div className="screenshot-missing lightbox-missing">Signed URL unavailable</div>
        )}
      </ModalFrame>
    </div>
  );
}

function buildActivityLogItems(detail: VaDetail | null): ActivityLogItem[] {
  if (!detail) return [];

  const segmentById = new Map(detail.timeline.map((segment) => [segment.id, segment]));
  const entries = [...detail.timeEntries].sort((first, second) => {
    const firstSegment = segmentById.get(first.id);
    const secondSegment = segmentById.get(second.id);
    return new Date(firstSegment?.displayStartedAt ?? first.started_at).getTime() - new Date(secondSegment?.displayStartedAt ?? second.started_at).getTime();
  });
  const items: ActivityLogItem[] = [];
  let previousEnd = detail.rangeStart;
  let previousEntry: VaDetail["timeEntries"][number] | null = null;

  for (const entry of entries) {
    const segment = segmentById.get(entry.id);
    if (!segment) continue;

    if (new Date(segment.displayStartedAt).getTime() - new Date(previousEnd).getTime() >= 60_000) {
      items.push(buildGapItem(previousEntry, previousEnd, segment.displayStartedAt, items.length));
    }

    items.push({
      id: entry.id,
      kind: "session",
      title: "Work Session",
      reason: stopReasonLabel(entry),
      startedAt: segment.displayStartedAt,
      endedAt: segment.displayStoppedAt,
      durationSeconds: segment.durationSeconds,
      tone: "work",
      session: entry,
    });
    previousEnd = segment.displayStoppedAt;
    previousEntry = entry;
  }

  if (!entries.length && new Date(detail.rangeEnd).getTime() - new Date(detail.rangeStart).getTime() >= 60_000) {
    items.push({
      id: "untracked-empty-range",
      kind: "untracked",
      title: "Untracked",
      reason: "No tracked session in this time window",
      startedAt: detail.rangeStart,
      endedAt: detail.rangeEnd,
      durationSeconds: Math.max(0, Math.floor((new Date(detail.rangeEnd).getTime() - new Date(detail.rangeStart).getTime()) / 1000)),
      tone: "neutral",
      session: null,
    });
  }

  if (entries.length && new Date(detail.rangeEnd).getTime() - new Date(previousEnd).getTime() >= 60_000) {
    items.push(buildGapItem(previousEntry, previousEnd, detail.rangeEnd, items.length));
  }

  return items;
}

function buildGapItem(
  previousEntry: VaDetail["timeEntries"][number] | null,
  startedAt: string,
  endedAt: string,
  index: number,
): ActivityLogItem {
  const durationSeconds = Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));

  if (!previousEntry) {
    return {
      id: `gap-${index}-untracked`,
      kind: "untracked",
      title: "Untracked",
      reason: "No tracked session",
      startedAt,
      endedAt,
      durationSeconds,
      tone: "neutral",
      session: null,
    };
  }

  if (previousEntry.stop_reason === "break") {
    return {
      id: `gap-${index}-break`,
      kind: "break",
      title: "Break",
      reason: "Break started",
      startedAt,
      endedAt,
      durationSeconds,
      tone: "break",
      session: null,
    };
  }

  if (previousEntry.stop_reason === "idle") {
    return {
      id: `gap-${index}-idle`,
      kind: "idle",
      title: "Idle",
      reason: "Idle timeout",
      startedAt,
      endedAt,
      durationSeconds,
      tone: "alert",
      session: null,
    };
  }

  if (previousEntry.stop_reason === "app_close" || previousEntry.stop_reason === "crash") {
    return {
      id: `gap-${index}-offline`,
      kind: "offline",
      title: "Disconnected",
      reason: previousEntry.stop_reason === "crash" ? "Possible crash" : "App closed",
      startedAt,
      endedAt,
      durationSeconds,
      tone: "alert",
      session: null,
    };
  }

  return {
    id: `gap-${index}-stopped`,
    kind: "stopped",
    title: "Stopped",
    reason: "Stopped by VA",
    startedAt,
    endedAt,
    durationSeconds,
    tone: "neutral",
    session: null,
  };
}

function groupScreenshotsBySession(detail: VaDetail | null, timezone: string): ScreenshotGroup[] {
  if (!detail?.screenshots.length) return [];

  const timelineById = new Map(detail.timeline.map((segment) => [segment.id, segment]));
  const sessionById = new Map(detail.timeEntries.map((entry) => [entry.id, entry]));
  const grouped = new Map<string, Screenshot[]>();

  for (const shot of detail.screenshots) {
    grouped.set(shot.time_entry_id, [...(grouped.get(shot.time_entry_id) ?? []), shot]);
  }

  return [...grouped.entries()]
    .map(([timeEntryId, shots]) => {
      const entry = sessionById.get(timeEntryId);
      const segment = timelineById.get(timeEntryId);
      const label = entry && segment
        ? `${entry.projectName}: ${formatDateTimeLabel(segment.displayStartedAt, timezone)} - ${formatDateTimeLabel(segment.displayStoppedAt, timezone)}`
        : "Session Screenshots";
      return {
        id: timeEntryId,
        label,
        shots,
      };
    })
    .sort((first, second) => new Date(second.shots[0]?.captured_at ?? 0).getTime() - new Date(first.shots[0]?.captured_at ?? 0).getTime());
}

function buildAppUsageFromLogs(logs: ActivityLog[]): VaDetail["appUsage"] {
  const usage = new Map<string, { minutes: number; activityTotal: number }>();

  for (const log of logs) {
    const appName = cleanAppName(log.active_app_name || log.active_window_title || "Unknown");
    const current = usage.get(appName) ?? { minutes: 0, activityTotal: 0 };
    current.minutes += 1;
    current.activityTotal += Number(log.activity_percent ?? 0);
    usage.set(appName, current);
  }

  return [...usage.entries()]
    .map(([appName, value]) => ({
      appName,
      minutes: value.minutes,
      averageActivityPercent: value.activityTotal / value.minutes,
    }))
    .sort((first, second) => second.minutes - first.minutes)
    .slice(0, 8);
}

function averageActivityFromLogs(logs: ActivityLog[]) {
  if (!logs.length) return null;
  return logs.reduce((sum, log) => sum + Number(log.activity_percent ?? 0), 0) / logs.length;
}

function productivityScore(activityPercent: number | null) {
  if (activityPercent === null) return 0;
  return Math.max(0, Math.min(100, Math.round(activityPercent)));
}

function totalBreakSeconds(items: ActivityLogItem[]) {
  return items.filter((item) => item.kind === "break").reduce((sum, item) => sum + item.durationSeconds, 0);
}

function stopReasonLabel(entry: VaDetail["timeEntries"][number]) {
  if (entry.is_manual) return "Manual entry";
  if (!entry.stopped_at) return "Running";
  if (entry.stop_reason === "manual") return "Stopped by VA";
  if (entry.stop_reason === "idle") return "Auto-stopped: idle timeout";
  if (entry.stop_reason === "app_close") return "App closed";
  if (entry.stop_reason === "crash") return "Auto-closed: possible crash";
  if (entry.stop_reason === "break") return "Break started";
  return "Stopped";
}

function sampleLogs(logs: ActivityLog[], maxBars: number) {
  if (logs.length <= maxBars) return logs;

  const bucketSize = Math.ceil(logs.length / maxBars);
  const sampled: ActivityLog[] = [];

  for (let index = 0; index < logs.length; index += bucketSize) {
    const bucket = logs.slice(index, index + bucketSize);
    const average = bucket.reduce((sum, log) => sum + Number(log.activity_percent ?? 0), 0) / bucket.length;
    sampled.push({
      ...bucket[0],
      id: bucket.map((log) => log.id).join("-"),
      activity_percent: average,
    });
  }

  return sampled;
}

function timelinePosition(startedAt: string, endedAt: string, rangeStart: string, rangeEnd: string) {
  const rangeStartMs = new Date(rangeStart).getTime();
  const rangeMs = Math.max(1, new Date(rangeEnd).getTime() - rangeStartMs);
  const startMs = new Date(startedAt).getTime() - rangeStartMs;
  const widthMs = Math.max(new Date(endedAt).getTime() - new Date(startedAt).getTime(), 5 * 60 * 1000);
  return {
    left: Math.max(0, Math.min(100, (startMs / rangeMs) * 100)),
    width: Math.max(1, Math.min(100, (widthMs / rangeMs) * 100)),
  };
}

function buildDateRange(mode: RangeMode, customStart: string, customEnd: string, timezone: string): DetailDateRange {
  if (mode === "last24h") {
    return {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      end: new Date().toISOString(),
    };
  }

  const todayInput = todayDateInputValue(timezone);
  let startInput = todayInput;
  let endInput = todayInput;

  if (mode === "week") {
    const startDate = dateFromInput(todayInput);
    const day = startDate.getDay();
    const daysSinceMonday = (day + 6) % 7;
    startDate.setDate(startDate.getDate() - daysSinceMonday);
    startInput = inputFromDate(startDate);
  }

  if (mode === "month") {
    const startDate = dateFromInput(todayInput);
    startDate.setDate(1);
    startInput = inputFromDate(startDate);
  }

  if (mode === "custom") {
    startInput = customStart;
    endInput = customEnd || customStart;
    return {
      start: startOfDayIso(startInput, timezone),
      end: endOfDayIso(endInput, timezone),
    };
  }

  return {
    start: startOfDayIso(startInput, timezone),
    end: mode === "today" ? new Date().toISOString() : endOfDayIso(endInput, timezone),
  };
}

function createManualEntryForm(date: string): ManualEntryForm {
  return {
    date,
    endTime: "17:00",
    note: "",
    projectId: "",
    startTime: "09:00",
  };
}

function parseUnproductiveApps(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item).trim().toLowerCase()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function appIsUnproductive(appName: string, unproductiveApps: string[]) {
  const normalized = appName.toLowerCase();
  return unproductiveApps.some((app) => normalized.includes(app));
}

function cleanAppName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 48 ? `${trimmed.slice(0, 45)}...` : trimmed || "Unknown";
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

function timelineAxisLabels(rangeStart: string, rangeEnd: string, timezone: string) {
  const start = new Date(rangeStart).getTime();
  const end = new Date(rangeEnd).getTime();
  const span = Math.max(1, end - start);
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => formatTime(new Date(start + span * ratio), timezone));
}

function activityAxisLabels(logs: ActivityLog[], timezone: string) {
  if (!logs.length) return [];
  const indexes = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.min(logs.length - 1, Math.round((logs.length - 1) * ratio)));
  return [...new Set(indexes)].map((index) => formatTime(logs[index].timestamp, timezone));
}

function rangeLabel(range: DetailDateRange, timezone: string) {
  return `${formatDate(range.start, timezone)} - ${formatDate(range.end, timezone)}`;
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

function earningsForSeconds(seconds: number, hourlyRate: number) {
  return Number(((seconds / 3600) * hourlyRate).toFixed(2));
}

function deviceLabel(hostname: string, osUsername: string | null | undefined) {
  return osUsername ? `${hostname} (${osUsername})` : hostname;
}

function downloadFromClick(event: MouseEvent<HTMLButtonElement>, url: string, storageKey: string) {
  event.preventDefault();
  event.stopPropagation();
  downloadScreenshot(url, storageKey);
}

function downloadScreenshot(url: string, storageKey: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = storageKey.split("/").pop() || "screenshot.jpg";
  link.click();
}

function formatDateTimeLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: timezone,
  }).format(new Date(value));
}
