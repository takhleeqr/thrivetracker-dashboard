"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Activity, ArrowLeft, Camera, ChevronLeft, ChevronRight, Clock3, Download, Monitor, Plus, RefreshCw, Rows3, TimerReset, X, type LucideIcon } from "lucide-react";
import { Button, Card, Input, ModalFrame, Select, Table, Tabs } from "@/components/ui";
import type { ActivityLog, DetailDateRange, Screenshot, VaDetail } from "@/lib/dashboard-data";
import { loadAdminProfile, loadVaDetail } from "@/lib/dashboard-data";
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
  kind: "work" | "break" | "idle" | "offline" | "not_tracking";
  title: string;
  endedBy: string;
  explanation: string;
  appVersion: string | null;
  appVersionHint: string;
  projectLabel: string;
  deviceLabel: string;
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

type ActivitySummaryBucket = {
  kind: ActivityLogItem["kind"];
  title: string;
  tone: ActivityLogItem["tone"];
  totalSeconds: number;
};

export default function VaDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const [detail, setDetail] = useState<VaDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshNotice, setRefreshNotice] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [rangeMode, setRangeMode] = useState<RangeMode>("last24h");
  const [timezone, setTimezone] = useState("Asia/Karachi");
  const [customStart, setCustomStart] = useState(todayDateInputValue("Asia/Karachi"));
  const [customEnd, setCustomEnd] = useState(todayDateInputValue("Asia/Karachi"));
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);
  const [connectivityGraceMinutes, setConnectivityGraceMinutes] = useState("2");
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualForm, setManualForm] = useState<ManualEntryForm>(() => createManualEntryForm(todayDateInputValue("Asia/Karachi")));
  const [manualError, setManualError] = useState("");
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isForcingReauth, setIsForcingReauth] = useState(false);
  const [unproductiveApps, setUnproductiveApps] = useState<string[]>([]);
  const [isReady, setIsReady] = useState(false);
  const hasLoadedDetailRef = useRef(false);

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
      setConnectivityGraceMinutes(settings.connectivity_grace_minutes);
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
  }, [connectivityGraceMinutes, isReady, selectedRange, timezone]);

  useEffect(() => {
    if (!isReady) return;
    const intervalId = window.setInterval(() => refreshData(selectedRange, timezone, { background: true }), 30_000);
    return () => window.clearInterval(intervalId);
  }, [connectivityGraceMinutes, isReady, selectedRange, timezone]);

  async function refreshData(
    range = selectedRange,
    selectedTimezone = timezone,
    options: { background?: boolean } = {},
  ) {
    try {
      setError("");
      setMessage("");
      setRefreshNotice("");
      const nextDetail = await loadVaDetail(supabase, userId, range, selectedTimezone, { connectivity_grace_minutes: connectivityGraceMinutes });
      setDetail(nextDetail);
      hasLoadedDetailRef.current = true;
      setLastUpdatedAt(new Date());
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : "Could not load VA detail.";
      if (options.background && hasLoadedDetailRef.current) {
        setRefreshNotice("Live refresh is delayed. Showing the last loaded VA detail.");
        return;
      }
      setError(message);
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

  async function forceAgentRelogin() {
    if (!detail) return;
    const confirmed = window.confirm(`Require ${detail.profile.full_name} to sign in again on the desktop agent?`);
    if (!confirmed) return;

    try {
      setError("");
      setMessage("");
      setIsForcingReauth(true);
      const { error: rpcError } = await supabase.rpc("request_agent_force_reauth", {
        p_reason: "An admin asked you to sign in again.",
        p_user_id: userId,
      });
      if (rpcError) throw rpcError;
      setMessage("The desktop agent will ask this VA to sign in again on its next successful check-in.");
      await refreshData();
    } catch (reauthError) {
      setError(reauthError instanceof Error ? reauthError.message : "Could not require agent re-login.");
    } finally {
      setIsForcingReauth(false);
    }
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
  const isNonWorkSelection = Boolean(selectedActivity && !selectedSession);
  const wholeWindowPay = detail?.dailyPay.reduce((sum, day) => sum + day.earnings, 0) ?? 0;
  const scopedLogs = useMemo(
    () => (
      selectedSession
        ? detail?.activityLogs.filter(
            (log) =>
              log.time_entry_id === selectedSession.id &&
              isWithinSelectedWindow(log.timestamp, selectedActivity?.startedAt ?? selectedSession.started_at, selectedActivity?.endedAt ?? selectedSession.started_at),
          ) ?? []
        : isNonWorkSelection
          ? []
          : detail?.activityLogs ?? []
    ),
    [detail?.activityLogs, isNonWorkSelection, selectedActivity?.endedAt, selectedActivity?.startedAt, selectedSession],
  );
  const scopedScreenshots = useMemo(
    () => (
      selectedSession
        ? detail?.screenshots.filter(
            (shot) =>
              shot.time_entry_id === selectedSession.id &&
              isWithinSelectedWindow(shot.captured_at, selectedActivity?.startedAt ?? selectedSession.started_at, selectedActivity?.endedAt ?? selectedSession.started_at),
          ) ?? []
        : isNonWorkSelection
          ? []
          : detail?.screenshots ?? []
    ),
    [detail?.screenshots, isNonWorkSelection, selectedActivity?.endedAt, selectedActivity?.startedAt, selectedSession],
  );
  const scopedAppUsage = useMemo(
    () => (selectedSession ? buildAppUsageFromLogs(scopedLogs) : isNonWorkSelection ? [] : detail?.appUsage ?? []),
    [detail?.appUsage, isNonWorkSelection, scopedLogs, selectedSession],
  );
  const screenshotGroups = useMemo(
    () => (selectedActivity ? [] : groupScreenshotsBySession(detail, timezone)),
    [detail, selectedActivity, timezone],
  );
  const visibleScreenshots = useMemo(
    () => (selectedSession ? scopedScreenshots : selectedActivity ? [] : screenshotGroups.flatMap((group) => group.shots)),
    [scopedScreenshots, screenshotGroups, selectedActivity, selectedSession],
  );
  const selectedScreenshotIndex = useMemo(
    () => (selectedScreenshot ? visibleScreenshots.findIndex((shot) => shot.id === selectedScreenshot.id) : -1),
    [selectedScreenshot, visibleScreenshots],
  );
  const scopedKeystrokes = isNonWorkSelection ? 0 : scopedLogs.reduce((sum, log) => sum + Number(log.keystrokes_count ?? 0), 0);
  const scopedClicks = isNonWorkSelection ? 0 : scopedLogs.reduce((sum, log) => sum + Number(log.mouse_clicks_count ?? 0), 0);
  const scopedAverageActivity = selectedSession ? selectedSession.averageActivityPercent : isNonWorkSelection ? null : averageActivityFromLogs(scopedLogs);
  const scopedScore = selectedSession ? selectedSession.productivityScore : isNonWorkSelection ? null : productivityScore(scopedAverageActivity);
  const scopedIdleMinutes = selectedSession ? selectedSession.idleMinutes : isNonWorkSelection ? null : scopedLogs.filter((log) => Number(log.activity_percent ?? 0) === 0).length;
  const scopedDurationSeconds = selectedActivity ? selectedActivity.durationSeconds : detail?.totalHoursTodaySeconds ?? 0;
  const scopedPay = selectedSession ? earningsForSeconds(scopedDurationSeconds, Number(detail?.profile.hourly_rate ?? 0)) : isNonWorkSelection ? 0 : wholeWindowPay;
  const durationCardLabel = rangeMode === "today" ? "Hours Today" : rangeMode === "last24h" ? "Last 24 Hours" : "Tracked Hours";
  const activitySummary = useMemo(() => buildActivitySummary(activityItems), [activityItems]);

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
            {refreshNotice ? `, ${refreshNotice}` : ""}
          </p>
        </div>
        <div className="topbar-actions">
          <Button disabled={isForcingReauth || !detail} onClick={forceAgentRelogin} type="button" variant="secondary">
            <TimerReset size={16} />
            {isForcingReauth ? "Sending..." : "Require Re-login"}
          </Button>
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
          <button className={rangeMode === "last24h" ? "selected" : ""} onClick={() => setRangeMode("last24h")} type="button">
            Last 24 Hours
          </button>
          <button className={rangeMode === "today" ? "selected" : ""} onClick={() => setRangeMode("today")} type="button">
            Today
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
      {message ? <div className="toast success-toast">{message}</div> : null}

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
              <ActivitySummaryStrip summary={activitySummary} />
              <ActivityLogTable items={activityItems} onSelect={setSelectedActivityId} selectedId={selectedActivityId} timezone={timezone} />
            </Card>

            <Card className="detail-card detail-side-card">
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
                scopedScreenshotsCount={selectedSession ? scopedScreenshots.length : isNonWorkSelection ? 0 : detail.screenshotCount}
                selectedActivity={selectedActivity}
                selectedSession={selectedSession}
                timezone={timezone}
                unproductiveApps={unproductiveApps}
              />
            </Card>
          </section>

          <section className="detail-grid detail-grid-wide">
            <Card className="detail-card">
              <SectionTitle
                eyebrow="Activity"
                title={selectedSession ? "Minute Activity for Selected Work Session" : selectedActivity ? `Minute Activity for ${selectedActivity.title}` : "Minute Activity for Selected Time Window"}
              />
              <ActivityChart logs={scopedLogs} selectedActivity={selectedActivity} timezone={timezone} />
            </Card>

            <Card className="detail-card">
              <PayrollPanel detail={detail} selectedActivity={selectedActivity} selectedSession={selectedSession} timezone={timezone} />
            </Card>
          </section>

          <Card className="detail-card">
            <SectionTitle eyebrow="Visual Audit" title={selectedSession ? "Session Screenshots" : selectedActivity ? `Screenshots for ${selectedActivity.title}` : "Screenshots for Selected Time Window"} />
            <p className="subtle-line">
              {selectedSession
                ? "Only screenshots from the selected session are shown here."
                : selectedActivity
                  ? "Screenshots only exist while a work session is actively being tracked."
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
          {selectedScreenshot ? (
            <ScreenshotLightbox
              canGoNext={selectedScreenshotIndex >= 0 && selectedScreenshotIndex < visibleScreenshots.length - 1}
              canGoPrevious={selectedScreenshotIndex > 0}
              onClose={() => setSelectedScreenshot(null)}
              onNext={() => setSelectedScreenshot(visibleScreenshots[selectedScreenshotIndex + 1] ?? null)}
              onPrevious={() => setSelectedScreenshot(visibleScreenshots[selectedScreenshotIndex - 1] ?? null)}
              screenshot={selectedScreenshot}
              timezone={timezone}
            />
          ) : null}
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

function ActivitySummaryStrip({ summary }: { summary: ActivitySummaryBucket[] }) {
  return (
    <div className="activity-summary-strip">
      {summary.map((bucket) => (
        <div className={`activity-summary-card tone-${bucket.tone}`} key={bucket.kind}>
          <small>{bucket.title}</small>
          <strong>{displayDuration(bucket.totalSeconds)}</strong>
        </div>
      ))}
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
        <span>Ended By</span>
        <span>Project</span>
        <span>Device</span>
        <span className="metric-col">Activity</span>
        <span className="metric-col">Keys</span>
        <span className="metric-col">Clicks</span>
        <span className="metric-col">Screens</span>
        <span className="metric-col">Score</span>
      </div>
      {items.map((item) => (
        <button
          className={`activity-log-row tone-${item.tone} ${selectedId === item.id ? "is-selected" : ""}`}
          key={item.id}
          onClick={() => onSelect(item.id)}
          type="button"
        >
          <span className="activity-log-time">
            <strong>{formatInTimezone(item.startedAt, timezone)}</strong>
            <small>{formatInTimezone(item.endedAt, timezone)}</small>
          </span>
          <span className="activity-log-type">
            <strong>{item.title}</strong>
            {item.session?.is_manual ? <small className="manual-badge">Manual</small> : null}
          </span>
          <span>{displayDuration(item.durationSeconds)}</span>
          <span className="activity-log-reason" title={item.explanation}>
            <strong>{item.endedBy}</strong>
            <small>{item.kind === "work" ? "Hover for explanation" : "Not applicable"}</small>
          </span>
          <span className="activity-log-context" title={item.projectLabel}>
            <strong>{item.projectLabel}</strong>
            <small>Project</small>
          </span>
          <span className="activity-log-context" title={item.deviceLabel}>
            <strong>{item.deviceLabel}</strong>
            <small>Device</small>
          </span>
          <span className="metric-col">{item.session?.averageActivityPercent === null || item.session === null ? "-" : formatPercent(item.session.averageActivityPercent)}</span>
          <span className="metric-col">{item.session?.totalKeystrokes ?? "-"}</span>
          <span className="metric-col">{item.session?.totalMouseClicks ?? "-"}</span>
          <span className="metric-col">{item.session?.screenshotsTaken ?? "-"}</span>
          <span className="metric-col">{item.session?.productivityScore ?? "-"}</span>
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
  scopedIdleMinutes: number | null;
  scopedKeystrokes: number;
  scopedPay: number;
  scopedScore: number | null;
  scopedScreenshotsCount: number;
  selectedActivity: ActivityLogItem | null;
  selectedSession: VaDetail["timeEntries"][number] | null;
  timezone: string;
  unproductiveApps: string[];
}) {
  const isNonWorkSelection = Boolean(selectedActivity && !selectedSession);
  const nonWorkActivity = isNonWorkSelection ? selectedActivity : null;
  const versionInfo = describeSelectionVersion(detail, selectedActivity, selectedSession);
  const title = selectedSession ? "Selected Work Session" : selectedActivity ? `Selected ${selectedActivity.title}` : "Selected Time Window";
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
        <MetricCard label="Duration" tone="hours" value={displayDuration(scopedDurationSeconds)} />
        <MetricCard label="Payable" tone="earnings" value={isNonWorkSelection ? "Not applicable" : formatMoney(scopedPay)} />
        <MetricCard label="Avg Activity" tone="activity" value={isNonWorkSelection ? "Not applicable" : scopedAverageActivity === null ? "-" : formatPercent(scopedAverageActivity)} />
        <MetricCard label="Score" tone="score" value={isNonWorkSelection ? "Not applicable" : String(scopedScore ?? 0)} />
        <MetricCard label="Keystrokes" tone="work" value={isNonWorkSelection ? "Not applicable" : String(scopedKeystrokes)} />
        <MetricCard label="Clicks" tone="work" value={isNonWorkSelection ? "Not applicable" : String(scopedClicks)} />
        <MetricCard label="Idle Min" tone="alert" value={isNonWorkSelection ? "Not applicable" : String(scopedIdleMinutes ?? 0)} />
        <MetricCard label="Screenshots" tone="screenshots" value={isNonWorkSelection ? "Not applicable" : String(scopedScreenshotsCount)} />
      </div>

      {nonWorkActivity ? (
        <div className="selection-note">
          <strong>{nonWorkActivity.title}</strong>
          <p>{nonWorkActivity.explanation}</p>
        </div>
      ) : null}

      <div className="app-usage-list">
        <div className="app-usage-row">
          <span>
            <strong>{selectedSession ? "Ended by" : selectedActivity ? "Period type" : "Latest login device"}</strong>
            <small>
              {selectedSession
                ? stopReasonShortLabel(selectedSession)
                : selectedActivity
                  ? selectedActivity.title
                  : detail.lastDevice
                    ? deviceLabel(detail.lastDevice.hostname, detail.lastDevice.os_username)
                    : "No device recorded yet"}
            </small>
          </span>
          <b>{selectedSession ? "Reason" : selectedActivity ? "What this means" : "Access"}</b>
        </div>
        {selectedSession ? (
          <div className="app-usage-row">
            <span>
              <strong>Explanation</strong>
              <small>{stopReasonExplanation(selectedSession)}</small>
            </span>
            <b>Help</b>
          </div>
        ) : selectedActivity ? (
          <div className="app-usage-row">
            <span>
              <strong>Explanation</strong>
              <small>{selectedActivity.explanation}</small>
            </span>
            <b>Help</b>
          </div>
        ) : detail.lastDevice ? (
          <div className="app-usage-row">
            <span>
              <strong>Last heartbeat</strong>
              <small>{detail.latestAgentHealth?.last_health_ping_at ? formatDateTimeFull(detail.latestAgentHealth.last_health_ping_at, timezone) : detail.lastDevice.last_seen_at ? formatDateTimeFull(detail.lastDevice.last_seen_at, timezone) : "No heartbeat yet"}</small>
            </span>
            <b>Live</b>
          </div>
        ) : null}
        <div className="app-usage-row">
          <span>
            <strong>App version</strong>
            <small>{versionInfo.caption}</small>
          </span>
          <b>{versionInfo.value}</b>
        </div>
        {selectedSession ? (
          <div className="app-usage-row">
            <span>
              <strong>Session device</strong>
              <small>{selectedSession.device_hostname ? deviceLabel(selectedSession.device_hostname, selectedSession.device_os_username) : "Device not captured"}</small>
            </span>
            <b>PC</b>
          </div>
        ) : null}
      </div>

      <SectionTitle eyebrow="Apps" title={selectedSession ? "Apps in This Work Session" : selectedActivity ? `Apps During ${selectedActivity.title}` : "Apps in This Time Window"} />
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
          <EmptySmall
            icon={Monitor}
            title={selectedActivity && !selectedSession ? "No app data for this period" : "No app data yet"}
            text={selectedActivity && !selectedSession ? "Apps are only recorded during active work sessions." : "App activity appears for tracked work sessions only."}
          />
        )}
      </div>

      {!selectedActivity ? <AgentEventsPanel events={detail.agentEvents} timezone={timezone} /> : null}
    </>
  );
}

function AgentEventsPanel({ events, timezone }: { events: VaDetail["agentEvents"]; timezone: string }) {
  return (
    <>
      <SectionTitle eyebrow="Agent" title="Recent Agent Events" />
      <div className="app-usage-list">
        {events.length ? (
          events.map((event) => (
            <div className="app-usage-row" key={event.id}>
              <span>
                <strong>{humanizeAgentEvent(event.event_type)}</strong>
                <small>
                  {formatDateTimeFull(event.occurred_at, timezone)}
                  {event.hostname ? ` on ${event.hostname}` : ""}
                  {event.app_version ? `, v${event.app_version}` : ""}
                </small>
                <small>{event.message}</small>
              </span>
              <b>{event.severity}</b>
            </div>
          ))
        ) : (
          <EmptySmall icon={Monitor} title="No recent agent events" text="Login, connection, update, and recovery events will appear here." />
        )}
      </div>
    </>
  );
}

function MetricCard({ label, tone, value }: { label: string; tone: string; value: string }) {
  return (
    <div className={`detail-metric-card metric-tone-${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function humanizeAgentEvent(value: string) {
  const mapping: Record<string, string> = {
    force_reauth: "Admin required a fresh sign-in",
    login_failed: "Login failed",
    saved_session_restore_failed: "Saved session restore failed",
    session_refresh_failed: "Session refresh failed",
    tracking_started: "Tracking started",
    update_failed: "Desktop update failed",
    update_started: "Desktop update started",
  };
  return mapping[value] ?? value.replaceAll("_", " ");
}

function describeSelectionVersion(
  detail: VaDetail,
  selectedActivity: ActivityLogItem | null,
  selectedSession: VaDetail["timeEntries"][number] | null,
) {
  if (selectedSession?.appVersion) {
    return {
      value: formatVersionLabel(selectedSession.appVersion),
      caption: "Captured from activity and screenshot data recorded during this work session.",
    };
  }

  if (selectedActivity?.appVersion) {
    return {
      value: formatVersionLabel(selectedActivity.appVersion),
      caption: selectedActivity.appVersionHint,
    };
  }

  if (detail.latestAgentHealth?.app_version) {
    return {
      value: formatVersionLabel(detail.latestAgentHealth.app_version),
      caption: selectedActivity
        ? "This row does not have an exact stored app version yet, so this shows the latest version reported by the desktop agent."
        : "Latest version reported by the desktop agent.",
    };
  }

  return {
    value: "Version not recorded yet",
    caption: selectedActivity
      ? "This older row was captured before row-level app version tracking was available, or the agent did not report it."
      : "The desktop agent has not reported a version yet.",
  };
}

function ActivityChart({
  logs,
  selectedActivity,
  timezone,
}: {
  logs: ActivityLog[];
  selectedActivity: ActivityLogItem | null;
  timezone: string;
}) {
  if (!logs.length) {
    return (
      <EmptySmall
        icon={Activity}
        title={selectedActivity && !selectedActivity.session ? "No activity for this period" : "No activity logs yet"}
        text={selectedActivity && !selectedActivity.session ? "Minute-by-minute activity is only recorded during active work sessions." : "Minute activity appears while the desktop timer is running."}
      />
    );
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
            <span>{displayDuration(selectedActivity.durationSeconds)}</span>
            <span>{formatMoney(hourlyRate)}/hr</span>
            <span>{formatMoney(earningsForSeconds(selectedActivity.durationSeconds, hourlyRate))}</span>
          </div>
        </Table>
        <div className="selection-note">
          <strong>{formatDateTimeFull(selectedActivity.startedAt, timezone)}</strong>
          <p>{stopReasonExplanation(selectedSession)}</p>
        </div>
      </>
    );
  }

  if (selectedActivity && !selectedSession) {
    return (
      <>
        <SectionTitle eyebrow="Payroll" title={`${selectedActivity.title} Pay`} />
        <EmptySmall icon={Clock3} title="No payable time" text="Breaks, idle periods, offline gaps, and not-tracking periods do not create payroll." />
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
                <span>{displayDuration(day.seconds)}</span>
                <span>{formatMoney(day.earnings)}</span>
              </div>
            ))}
            <div className="table-row data-row payroll-table-row payroll-total-row">
              <span>Total</span>
              <span>{displayDuration(totalSeconds)}</span>
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
    return <EmptySmall icon={Camera} title="No screenshots for this period" text="Screenshots are only captured while a work session is actively being tracked." />;
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

function ScreenshotLightbox({
  screenshot,
  onClose,
  onNext,
  onPrevious,
  canGoNext,
  canGoPrevious,
  timezone,
}: {
  screenshot: Screenshot;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  canGoNext: boolean;
  canGoPrevious: boolean;
  timezone: string;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && canGoPrevious) onPrevious();
      if (event.key === "ArrowRight" && canGoNext) onNext();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canGoNext, canGoPrevious, onClose, onNext, onPrevious]);

  return (
    <div className="modal-backdrop screenshot-lightbox-backdrop" onClick={onClose}>
      <ModalFrame className="screenshot-lightbox" onClick={(event) => event.stopPropagation()}>
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
        <div className="lightbox-stage" onClick={(event) => event.stopPropagation()}>
          <button
            aria-label="Previous screenshot"
            className="lightbox-nav lightbox-nav-left"
            disabled={!canGoPrevious}
            onClick={onPrevious}
            type="button"
          >
            <ChevronLeft size={20} />
          </button>
          {screenshot.signedUrl ? (
            <img alt="Full screenshot" className="lightbox-image" src={screenshot.signedUrl} />
          ) : (
            <div className="screenshot-missing lightbox-missing">Signed URL unavailable</div>
          )}
          <button
            aria-label="Next screenshot"
            className="lightbox-nav lightbox-nav-right"
            disabled={!canGoNext}
            onClick={onNext}
            type="button"
          >
            <ChevronRight size={20} />
          </button>
        </div>
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
      kind: "work",
      title: "Work",
      endedBy: stopReasonShortLabel(entry),
      explanation: stopReasonExplanation(entry),
      appVersion: entry.appVersion,
      appVersionHint: entry.appVersion
        ? "Captured from activity and screenshot data recorded during this work session."
        : "This work session does not have a row-specific app version recorded yet.",
      projectLabel: entry.projectName,
      deviceLabel: entry.device_hostname ? deviceLabel(entry.device_hostname, entry.device_os_username) : "Device not captured",
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
      kind: "not_tracking",
      title: "Not Tracking",
      endedBy: "-",
      explanation: "No timer was running during this part of the selected time window.",
      appVersion: null,
      appVersionHint: "There was no active tracked session during this period, so no row-specific app version was captured.",
      projectLabel: "-",
      deviceLabel: "-",
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
      id: `gap-${index}-not-tracking`,
      kind: "not_tracking",
      title: "Not Tracking",
      endedBy: "-",
      explanation: "No timer was running during this part of the selected time window.",
      appVersion: null,
      appVersionHint: "There was no earlier tracked session in this selected window to attribute a desktop version to.",
      projectLabel: "-",
      deviceLabel: "-",
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
      endedBy: "-",
      explanation: "The VA paused tracked work and stayed on break until the next work session began.",
      appVersion: previousEntry.appVersion ?? null,
      appVersionHint: previousEntry.appVersion
        ? "Derived from the work session immediately before this break."
        : "The break came after a session that did not record a row-specific app version.",
      projectLabel: previousEntry.projectName,
      deviceLabel: previousEntry.device_hostname ? deviceLabel(previousEntry.device_hostname, previousEntry.device_os_username) : "Device not captured",
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
      endedBy: "-",
      explanation: "Tracking had already stopped because there was no keyboard or mouse activity for the idle limit.",
      appVersion: previousEntry.appVersion ?? null,
      appVersionHint: previousEntry.appVersion
        ? "Derived from the work session that ended because of inactivity."
        : "This idle period follows a session that did not record a row-specific app version.",
      projectLabel: previousEntry.projectName,
      deviceLabel: previousEntry.device_hostname ? deviceLabel(previousEntry.device_hostname, previousEntry.device_os_username) : "Device not captured",
      startedAt,
      endedAt,
      durationSeconds,
      tone: "alert",
      session: null,
    };
  }

  if (previousEntry.stop_reason === "app_close" || previousEntry.stop_reason === "crash" || previousEntry.stop_reason === "connection_lost") {
    return {
      id: `gap-${index}-offline`,
      kind: "offline",
      title: "Offline",
      endedBy: "-",
      explanation: previousEntry.stop_reason === "connection_lost"
        ? "The previous work session was closed automatically after the connection was lost."
        : previousEntry.stop_reason === "crash"
        ? "The previous work session was closed automatically after the connection or app was lost."
        : "The previous work session ended because the desktop app was closed.",
      appVersion: previousEntry.appVersion ?? null,
      appVersionHint: previousEntry.appVersion
        ? "Derived from the last tracked session before this offline period."
        : "This offline period follows a session that did not record a row-specific app version.",
      projectLabel: previousEntry.projectName,
      deviceLabel: previousEntry.device_hostname ? deviceLabel(previousEntry.device_hostname, previousEntry.device_os_username) : "Device not captured",
      startedAt,
      endedAt,
      durationSeconds,
      tone: "alert",
      session: null,
    };
  }

  if (!previousEntry.stopped_at) {
    return {
      id: `gap-${index}-offline-open`,
      kind: "offline",
      title: "Offline",
      endedBy: "-",
      explanation: "The timer is still open, but the desktop app stopped sending heartbeats. Any later work will appear after the desktop app reconnects and syncs.",
      appVersion: previousEntry.appVersion ?? null,
      appVersionHint: previousEntry.appVersion
        ? "Derived from the still-open work session that stopped sending heartbeats."
        : "The open session did not record a row-specific app version yet.",
      projectLabel: previousEntry.projectName,
      deviceLabel: previousEntry.device_hostname ? deviceLabel(previousEntry.device_hostname, previousEntry.device_os_username) : "Device not captured",
      startedAt,
      endedAt,
      durationSeconds,
      tone: "alert",
      session: null,
    };
  }

  return {
    id: `gap-${index}-not-tracking`,
    kind: "not_tracking",
    title: "Not Tracking",
    endedBy: "-",
    explanation: "The VA had stopped tracking, and no new work session had started yet.",
    appVersion: previousEntry.appVersion ?? null,
    appVersionHint: previousEntry.appVersion
      ? "Derived from the last tracked session before this non-tracking period."
      : "The earlier session in this window did not record a row-specific app version.",
    projectLabel: previousEntry.projectName,
    deviceLabel: previousEntry.device_hostname ? deviceLabel(previousEntry.device_hostname, previousEntry.device_os_username) : "Device not captured",
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

function isWithinSelectedWindow(value: string, startedAt: string, endedAt: string) {
  const timestamp = new Date(value).getTime();
  const start = new Date(startedAt).getTime();
  const end = Math.max(start, new Date(endedAt).getTime());
  return timestamp >= start && timestamp <= end;
}

function totalBreakSeconds(items: ActivityLogItem[]) {
  return items.filter((item) => item.kind === "break").reduce((sum, item) => sum + item.durationSeconds, 0);
}

function stopReasonShortLabel(entry: VaDetail["timeEntries"][number]) {
  if (entry.is_manual) return "Manual entry";
  if (!entry.stopped_at) return "Running";
  if (entry.stop_reason === "manual") return "User stopped";
  if (entry.stop_reason === "idle") return "Inactivity";
  if (entry.stop_reason === "app_close") return "App closed";
  if (entry.stop_reason === "connection_lost") return "Connection lost";
  if (entry.stop_reason === "crash") return "Connection lost";
  if (entry.stop_reason === "break") return "Break started";
  return "Stopped";
}

function stopReasonExplanation(entry: VaDetail["timeEntries"][number]) {
  if (entry.is_manual) return "This time was added manually by an admin as a correction or approved adjustment.";
  if (!entry.stopped_at) return "This work session is still running.";
  if (entry.stop_reason === "manual") return "The VA stopped this work session manually.";
  if (entry.stop_reason === "idle") return "This work session ended automatically after no keyboard or mouse activity was detected for the idle limit.";
  if (entry.stop_reason === "app_close") return "This work session ended because the desktop app was closed.";
  if (entry.stop_reason === "connection_lost") return "This work session was closed automatically after the desktop agent lost contact with the server.";
  if (entry.stop_reason === "crash") return "This work session was closed automatically after the connection or app was lost.";
  if (entry.stop_reason === "break") return "This work session ended because the VA started a break.";
  return "This work session ended.";
}

function buildActivitySummary(items: ActivityLogItem[]): ActivitySummaryBucket[] {
  const buckets = new Map<ActivityLogItem["kind"], ActivitySummaryBucket>([
    ["work", { kind: "work", title: "Work", tone: "work", totalSeconds: 0 }],
    ["break", { kind: "break", title: "Break", tone: "break", totalSeconds: 0 }],
    ["idle", { kind: "idle", title: "Idle", tone: "alert", totalSeconds: 0 }],
    ["offline", { kind: "offline", title: "Offline", tone: "alert", totalSeconds: 0 }],
    ["not_tracking", { kind: "not_tracking", title: "Not Tracking", tone: "neutral", totalSeconds: 0 }],
  ]);

  for (const item of items) {
    const bucket = buckets.get(item.kind);
    if (!bucket) continue;
    bucket.totalSeconds += item.durationSeconds;
  }

  return [...buckets.values()];
}

function displayDuration(seconds: number) {
  return seconds > 0 && seconds < 60 ? "<1m" : formatHours(seconds);
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

function formatVersionLabel(value: string) {
  const cleaned = value.trim();
  return cleaned.toLowerCase().startsWith("v") ? cleaned : `v${cleaned}`;
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
