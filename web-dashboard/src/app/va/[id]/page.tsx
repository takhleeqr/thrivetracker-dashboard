"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Activity, ArrowLeft, Camera, Clock3, Download, Monitor, Plus, RefreshCw, Rows3, TimerReset, X, type LucideIcon } from "lucide-react";
import { Button, Card, Input, ModalFrame, Select, Table, Tabs } from "@/components/ui";
import type { ActivityLog, DetailDateRange, Screenshot, TimelineSegment, VaDetail } from "@/lib/dashboard-data";
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

type RangeMode = "today" | "week" | "month" | "custom";
type ManualEntryForm = {
  date: string;
  endTime: string;
  note: string;
  projectId: string;
  startTime: string;
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
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualForm, setManualForm] = useState<ManualEntryForm>(() => createManualEntryForm(todayDateInputValue("Asia/Karachi")));
  const [manualError, setManualError] = useState("");
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [unproductiveApps, setUnproductiveApps] = useState<string[]>([]);

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
      setTimezone(settings.timezone);
      setUnproductiveApps(parseUnproductiveApps(settings.app_categories_unproductive));
      await refreshData(buildDateRange(rangeMode, customStart, customEnd, settings.timezone), settings.timezone);
    }

    boot();

    const intervalId = window.setInterval(() => refreshData(selectedRange), 30_000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [router, selectedRange, userId]);

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

  const breaks = useMemo(() => buildBreaks(detail?.timeline ?? []), [detail?.timeline]);
  const totalBreakSeconds = breaks.reduce((sum, item) => sum + item.durationSeconds, 0);

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
            <StatCard icon={Clock3} label="Hours Today" tone="hours" value={formatHours(detail.totalHoursTodaySeconds)} />
            <StatCard icon={Activity} label="Productivity Score" tone="score" value={String(detail.productivityScore)} />
            <StatCard icon={Camera} label="Screenshots" tone="screenshots" value={String(detail.screenshotCount)} />
            <StatCard icon={TimerReset} label="Break Time" tone="activity" value={formatHours(totalBreakSeconds)} />
            <StatCard icon={Clock3} label="Earnings This Week" tone="earnings" value={formatMoney(detail.earningsThisWeek)} />
            <StatCard icon={Clock3} label="Earnings This Month" tone="earnings" value={formatMoney(detail.earningsThisMonth)} />
          </section>
          <p className="metric-explainer">
            Productivity Score is 0-100 and is calculated from this VA&apos;s activity percentages across tracked sessions today.
          </p>

          <section className="detail-grid">
            <Card className="detail-card detail-main-card">
              <SectionTitle eyebrow="Today" title="Timeline" />
              <Timeline rangeEnd={detail.rangeEnd} rangeStart={detail.rangeStart} segments={detail.timeline} timezone={timezone} />
              <BreakList breaks={breaks} timezone={timezone} />
              <SectionTitle eyebrow="Activity" title="Minute Activity" />
              <ActivityChart logs={detail.activityLogs} timezone={timezone} />
            </Card>

            <Card className="detail-card">
              <SectionTitle eyebrow="Apps" title="Active Apps" />
              <div className="app-usage-list">
                {detail.appUsage.length ? (
                  detail.appUsage.map((app) => {
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
                  <EmptySmall icon={Monitor} title="No app data yet" text="Activity logs will populate this section." />
                )}
              </div>
            </Card>
          </section>

          <Card className="detail-card">
            <SectionTitle eyebrow="Payroll" title="Hours and Pay By Date" />
            <Table className="compact-table">
              <div className="table-row payroll-table-row table-head">
                <span>Date</span>
                <span>Hours Worked</span>
                <span>Payable</span>
              </div>
              {detail.dailyPay.length ? (
                detail.dailyPay.map((day) => (
                  <div className="table-row data-row payroll-table-row" key={day.date}>
                    <span>{day.date}</span>
                    <span>{formatHours(day.seconds)}</span>
                    <span>{formatMoney(day.earnings)}</span>
                  </div>
                ))
              ) : (
                <EmptySmall icon={Clock3} title="No payroll rows" text="Tracked or manual time entries create daily payroll rows." />
              )}
            </Table>
          </Card>

          <section className="detail-grid detail-grid-wide">
            <Card className="detail-card">
              <SectionTitle eyebrow="Visual Audit" title="Screenshots" />
              <div className="screenshot-grid">
                {detail.screenshots.length ? (
                  detail.screenshots.map((screenshot) => (
                    <div
                      className="screenshot-card"
                      key={screenshot.id}
                    >
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
                  <EmptySmall icon={Camera} title="No screenshots today" text="Screenshots appear after the desktop agent uploads them." />
                )}
              </div>
            </Card>

            <Card className="detail-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Time</p>
                  <h3>Time Entries</h3>
                </div>
                <Button onClick={openManualEntryModal} type="button" variant="secondary">
                  <Plus size={16} />
                  Add Manual Entry
                </Button>
              </div>
              <Table className="compact-table">
                <div className="table-row detail-table-head">
                  <span>Project</span>
                  <span>Start</span>
                  <span>Stop</span>
                  <span>Duration</span>
                  <span>Reason</span>
                </div>
                {detail.timeEntries.length ? (
                  detail.timeEntries.map((entry) => (
                    <div className="table-row data-row detail-table-row" key={entry.id}>
                      <span>{entry.projectName}</span>
                      <span>{formatInTimezone(entry.started_at, timezone)}</span>
                      <span>{entry.stopped_at ? formatInTimezone(entry.stopped_at, timezone) : "Running"}</span>
                      <span>{formatHours(entry.duration_seconds ?? runningDuration(entry.started_at, detail.lastSeenAt, detail.rangeEnd))}</span>
                      <span>
                        {entry.is_manual ? <b className="manual-badge">Manual</b> : null}
                        {entry.manual_note ?? entry.stop_reason ?? "running"}
                      </span>
                    </div>
                  ))
                ) : (
                  <EmptySmall icon={Clock3} title="No time entries today" text="The VA has not started tracking today." />
                )}
              </Table>
            </Card>
          </section>
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

function Timeline({
  rangeEnd,
  rangeStart,
  segments,
  timezone,
}: {
  rangeEnd: string;
  rangeStart: string;
  segments: TimelineSegment[];
  timezone: string;
}) {
  if (!segments.length) {
    return <EmptySmall icon={Rows3} title="No timeline yet" text="Time entries create the day timeline." />;
  }

  return (
    <div className="timeline">
      <div className="timeline-axis">
        <span>{formatDate(rangeStart, timezone)}</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>{formatDate(rangeEnd, timezone)}</span>
      </div>
      <div className="timeline-track">
        {segments.map((segment) => {
          const position = timelinePosition(segment, rangeStart, rangeEnd);
          return (
            <div
              className={`timeline-segment ${segment.isOpen ? "is-open" : ""}`}
              key={segment.id}
              style={{ left: `${position.left}%`, width: `${position.width}%` }}
              title={`${segment.projectName}: ${formatHours(segment.durationSeconds)}`}
            />
          );
        })}
      </div>
      <div className="timeline-list">
        {segments.map((segment) => (
            <div className="timeline-list-row" key={segment.id}>
              <span>
              <strong>
                {segment.projectName}
                {segment.isManual ? <b className="manual-badge">Manual</b> : null}
              </strong>
              <small>
                {formatInTimezone(segment.displayStartedAt, timezone)} - {segment.isOpen ? "Running" : formatInTimezone(segment.displayStoppedAt, timezone)}
              </small>
            </span>
            <b>{formatHours(segment.durationSeconds)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityChart({ logs, timezone }: { logs: ActivityLog[]; timezone: string }) {
  if (!logs.length) {
    return <EmptySmall icon={Activity} title="No activity logs yet" text="Minute activity appears while the desktop timer is running." />;
  }

  const sampledLogs = sampleLogs(logs, 72);

  return (
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
  );
}

function BreakList({ breaks, timezone }: { breaks: Array<{ durationSeconds: number; end: string; start: string }>; timezone: string }) {
  if (!breaks.length) {
    return <p className="subtle-line">No breaks detected between sessions in this range.</p>;
  }

  return (
    <div className="break-list">
      {breaks.map((item) => (
        <div className="break-row" key={`${item.start}-${item.end}`}>
          <span>
            <strong>Break</strong>
            <small>
              {formatInTimezone(item.start, timezone)} - {formatInTimezone(item.end, timezone)}
            </small>
          </span>
          <b>{formatHours(item.durationSeconds)}</b>
        </div>
      ))}
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

function timelinePosition(segment: TimelineSegment, rangeStart: string, rangeEnd: string) {
  const rangeStartMs = new Date(rangeStart).getTime();
  const rangeMs = Math.max(1, new Date(rangeEnd).getTime() - rangeStartMs);
  const startMs = new Date(segment.displayStartedAt).getTime() - rangeStartMs;
  const widthMs = Math.max(segment.durationSeconds * 1000, 5 * 60 * 1000);
  return {
    left: Math.max(0, Math.min(100, (startMs / rangeMs) * 100)),
    width: Math.max(1, Math.min(100, (widthMs / rangeMs) * 100)),
  };
}

function runningDuration(startedAt: string, lastSeenAt: string | null, rangeEnd: string) {
  const endAt = Math.min(lastSeenAt ? new Date(lastSeenAt).getTime() : Date.now(), new Date(rangeEnd).getTime());
  return Math.max(0, Math.floor((endAt - new Date(startedAt).getTime()) / 1000));
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

function buildBreaks(segments: TimelineSegment[]) {
  const sortedSegments = [...segments].sort((first, second) => new Date(first.displayStartedAt).getTime() - new Date(second.displayStartedAt).getTime());
  const breaks: Array<{ durationSeconds: number; end: string; start: string }> = [];

  for (let index = 1; index < sortedSegments.length; index += 1) {
    const previous = sortedSegments[index - 1];
    const current = sortedSegments[index];
    const startMs = new Date(previous.displayStoppedAt).getTime();
    const endMs = new Date(current.displayStartedAt).getTime();
    const durationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
    if (durationSeconds >= 60) {
      breaks.push({
        durationSeconds,
        end: current.displayStartedAt,
        start: previous.displayStoppedAt,
      });
    }
  }

  return breaks;
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

function buildDateRange(mode: RangeMode, customStart: string, customEnd: string, timezone: string): DetailDateRange {
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

function rangeLabel(range: DetailDateRange, timezone: string) {
  return `${formatDate(range.start, timezone)} - ${formatDate(range.end, timezone)}`;
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}
