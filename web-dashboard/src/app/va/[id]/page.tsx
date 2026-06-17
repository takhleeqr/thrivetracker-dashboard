"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Activity, ArrowLeft, Camera, Clock3, Download, Monitor, RefreshCw, Rows3, TimerReset, X, type LucideIcon } from "lucide-react";
import { Button, Card, Input, ModalFrame, Table, Tabs } from "@/components/ui";
import type { ActivityLog, DetailDateRange, Screenshot, TimelineSegment, VaDetail } from "@/lib/dashboard-data";
import { closeStaleTimeEntries, loadAdminProfile, loadVaDetail } from "@/lib/dashboard-data";
import { formatHours, formatPercent } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type RangeMode = "today" | "week" | "month" | "custom";

export default function VaDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const [detail, setDetail] = useState<VaDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customStart, setCustomStart] = useState(toDateInputValue(new Date()));
  const [customEnd, setCustomEnd] = useState(toDateInputValue(new Date()));
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);

  const selectedRange = useMemo(
    () => buildDateRange(rangeMode, customStart, customEnd),
    [rangeMode, customStart, customEnd],
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

      await refreshData(selectedRange);
    }

    boot();

    const intervalId = window.setInterval(() => refreshData(selectedRange), 30_000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [router, selectedRange, userId]);

  async function refreshData(range = selectedRange) {
    try {
      setError("");
      await closeStaleTimeEntries(supabase);
      const nextDetail = await loadVaDetail(supabase, userId, range);
      setDetail(nextDetail);
      setLastUpdatedAt(new Date());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not load VA detail.");
    } finally {
      setIsLoading(false);
    }
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
            {detail?.lastSeenAt ? `, last seen ${new Date(detail.lastSeenAt).toLocaleString()}` : ""}
            {lastUpdatedAt ? `, updated ${lastUpdatedAt.toLocaleTimeString()}` : ""}
          </p>
        </div>
        <Button onClick={() => refreshData()} type="button" variant="secondary">
          <RefreshCw size={16} />
          Refresh
        </Button>
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
          <strong>{rangeLabel(selectedRange)}</strong>
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
            <StatCard icon={Clock3} label="Hours Today" value={formatHours(detail.totalHoursTodaySeconds)} />
            <StatCard icon={Activity} label="Productivity Score" value={String(detail.productivityScore)} />
            <StatCard icon={Camera} label="Screenshots" value={String(detail.screenshotCount)} />
            <StatCard icon={TimerReset} label="Break Time" value={formatHours(totalBreakSeconds)} />
          </section>

          <section className="detail-grid">
            <Card className="detail-card detail-main-card">
              <SectionTitle eyebrow="Today" title="Timeline" />
              <Timeline rangeEnd={detail.rangeEnd} rangeStart={detail.rangeStart} segments={detail.timeline} />
              <BreakList breaks={breaks} />
              <SectionTitle eyebrow="Activity" title="Minute Activity" />
              <ActivityChart logs={detail.activityLogs} />
            </Card>

            <Card className="detail-card">
              <SectionTitle eyebrow="Apps" title="Active Apps" />
              <div className="app-usage-list">
                {detail.appUsage.length ? (
                  detail.appUsage.map((app) => (
                    <div className="app-usage-row" key={app.appName}>
                      <span>
                        <strong>{app.appName}</strong>
                        <small>{app.minutes} min tracked</small>
                      </span>
                      <b>{formatPercent(app.averageActivityPercent)}</b>
                    </div>
                  ))
                ) : (
                  <EmptySmall icon={Monitor} title="No app data yet" text="Activity logs will populate this section." />
                )}
              </div>
            </Card>
          </section>

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
                          <img alt={`Screenshot from ${new Date(screenshot.captured_at).toLocaleTimeString()}`} src={screenshot.signedUrl} />
                        ) : (
                          <div className="screenshot-missing">Signed URL unavailable</div>
                        )}
                        <span>
                          <strong>{new Date(screenshot.captured_at).toLocaleTimeString()}</strong>
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
              <SectionTitle eyebrow="Time" title="Time Entries" />
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
                      <span>{formatDateTime(entry.started_at)}</span>
                      <span>{entry.stopped_at ? formatDateTime(entry.stopped_at) : "Running"}</span>
                      <span>{formatHours(entry.duration_seconds ?? runningDuration(entry.started_at, detail.lastSeenAt, detail.rangeEnd))}</span>
                      <span>{entry.stop_reason ?? "running"}</span>
                    </div>
                  ))
                ) : (
                  <EmptySmall icon={Clock3} title="No time entries today" text="The VA has not started tracking today." />
                )}
              </Table>
            </Card>
          </section>
          {selectedScreenshot ? <ScreenshotLightbox screenshot={selectedScreenshot} onClose={() => setSelectedScreenshot(null)} /> : null}
        </>
      ) : null}
    </main>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <Card className="stat-card">
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

function Timeline({
  rangeEnd,
  rangeStart,
  segments,
}: {
  rangeEnd: string;
  rangeStart: string;
  segments: TimelineSegment[];
}) {
  if (!segments.length) {
    return <EmptySmall icon={Rows3} title="No timeline yet" text="Time entries create the day timeline." />;
  }

  return (
    <div className="timeline">
      <div className="timeline-axis">
        <span>{formatShortDateTime(rangeStart)}</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>{formatShortDateTime(rangeEnd)}</span>
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
              <strong>{segment.projectName}</strong>
              <small>
                {formatDateTime(segment.displayStartedAt)} - {segment.isOpen ? "Running" : formatDateTime(segment.displayStoppedAt)}
              </small>
            </span>
            <b>{formatHours(segment.durationSeconds)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityChart({ logs }: { logs: ActivityLog[] }) {
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
          title={`${new Date(log.timestamp).toLocaleTimeString()}: ${formatPercent(log.activity_percent)}`}
        />
      ))}
    </div>
  );
}

function BreakList({ breaks }: { breaks: Array<{ durationSeconds: number; end: string; start: string }> }) {
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
              {formatDateTime(item.start)} - {formatDateTime(item.end)}
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

function ScreenshotLightbox({ screenshot, onClose }: { screenshot: Screenshot; onClose: () => void }) {
  return (
    <div className="modal-backdrop screenshot-lightbox-backdrop">
      <ModalFrame className="screenshot-lightbox">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Screenshot</p>
            <h3>{new Date(screenshot.captured_at).toLocaleString()}</h3>
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

function buildDateRange(mode: RangeMode, customStart: string, customEnd: string): DetailDateRange {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (mode === "week") {
    const day = start.getDay();
    const daysSinceMonday = (day + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
  }

  if (mode === "month") {
    start.setDate(1);
  }

  if (mode === "custom") {
    const customStartDate = fromDateInputValue(customStart);
    const customEndDate = fromDateInputValue(customEnd || customStart);
    customEndDate.setHours(23, 59, 59, 999);
    return {
      start: customStartDate.toISOString(),
      end: customEndDate.toISOString(),
    };
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return {
    start: start.toISOString(),
    end: mode === "today" ? new Date().toISOString() : end.toISOString(),
  };
}

function fromDateInputValue(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date();
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangeLabel(range: DetailDateRange) {
  return `${new Date(range.start).toLocaleDateString()} - ${new Date(range.end).toLocaleDateString()}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
  });
}
