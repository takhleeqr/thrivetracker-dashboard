"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Camera, Download, Filter, RefreshCw, X } from "lucide-react";
import { Button, Card, Input, ModalFrame, Select } from "@/components/ui";
import { loadAdminProfile, type Profile } from "@/lib/dashboard-data";
import { formatPercent } from "@/lib/format";
import { loadSettings } from "@/lib/settings-data";
import {
  loadScreenshotFilters,
  loadScreenshots,
  type ScreenshotBrowserItem,
  type ScreenshotOption,
} from "@/lib/screenshots-data";
import { supabase } from "@/lib/supabase";
import { formatDateTimeFull, formatTime, todayDateInputValue } from "@/lib/timezone";

const PAGE_SIZE = 24;
const navItems = [
  { label: "Overview", href: "/" },
  { label: "Team", href: "/team" },
  { label: "Projects", href: "/projects" },
  { label: "Screenshots", href: "/screenshots" },
  { label: "Reports", href: "/reports" },
  { label: "Settings", href: "/settings" },
];

export default function ScreenshotsPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<Profile | null>(null);
  const [vas, setVas] = useState<ScreenshotOption[]>([]);
  const [projects, setProjects] = useState<ScreenshotOption[]>([]);
  const [items, setItems] = useState<ScreenshotBrowserItem[]>([]);
  const [selected, setSelected] = useState<ScreenshotBrowserItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [timezone, setTimezone] = useState("Asia/Karachi");
  const [date, setDate] = useState(todayDateInputValue("Asia/Karachi"));
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

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
      const settings = await loadSettings(supabase);
      setTimezone(settings.timezone);
      const filters = await loadScreenshotFilters(supabase);
      if (!isMounted) return;
      setVas(filters.vas);
      setProjects(filters.projects);
      await refreshScreenshots(0, settings.timezone);
    }

    boot();
    return () => {
      isMounted = false;
    };
  }, [router]);

  const currentFilter = useMemo(
    () => ({
      date,
      endTime: endTime || undefined,
      limit: PAGE_SIZE,
      offset: 0,
      projectId: projectId || undefined,
      startTime: startTime || undefined,
      timezone,
      userId: userId || undefined,
    }),
    [date, endTime, projectId, startTime, timezone, userId],
  );

  async function refreshScreenshots(offset: number, selectedTimezone = timezone) {
    try {
      setError("");
      if (offset === 0) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      const result = await loadScreenshots(supabase, {
        ...currentFilter,
        offset,
        timezone: selectedTimezone,
      });

      setItems((previous) => (offset === 0 ? result.items : [...previous, ...result.items]));
      setHasMore(result.hasMore);
      setLastUpdatedAt(new Date());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not load screenshots.");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
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
            <Link className={item.label === "Screenshots" ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Visual Audit</p>
            <h2>Screenshots</h2>
            <p className="subtle-line">
              {admin ? admin.full_name : "Checking session"}
              {lastUpdatedAt ? `, updated ${formatTime(lastUpdatedAt, timezone)}` : ""}
            </p>
          </div>
          <div className="topbar-actions">
            <Button onClick={() => refreshScreenshots(0)} type="button" variant="secondary">
              <RefreshCw size={16} />
              Refresh
            </Button>
          </div>
        </header>

        {error ? <div className="toast">{error}</div> : null}

        <Card className="detail-card screenshot-filter-card">
          <div className="filter-title">
            <Filter size={17} />
            <strong>Filters</strong>
          </div>
          <div className="screenshot-filters">
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
            <label>
              Date
              <Input onChange={(event) => setDate(event.target.value)} type="date" value={date} />
            </label>
            <label>
              Start
              <Input onChange={(event) => setStartTime(event.target.value)} type="time" value={startTime} />
            </label>
            <label>
              End
              <Input onChange={(event) => setEndTime(event.target.value)} type="time" value={endTime} />
            </label>
            <Button onClick={() => refreshScreenshots(0)} type="button">
              Apply
            </Button>
          </div>
        </Card>

        <section className="browser-grid" aria-label="Screenshot results">
          {items.length ? (
            items.map((item) => (
              <button className="browser-shot-card" key={item.id} onClick={() => setSelected(item)} type="button">
                {item.signedUrl ? (
                  <img alt={`Screenshot by ${item.vaName}`} src={item.signedUrl} />
                ) : (
                  <div className="screenshot-missing">Signed URL unavailable</div>
                )}
                <span>
                  <strong>{item.vaName}</strong>
                  <small>{item.projectName}</small>
                </span>
                <span>
                  <small>{formatDateTimeFull(item.captured_at, timezone)}</small>
                  <small>{item.activity_percent_at_capture === null ? "Activity -" : formatPercent(item.activity_percent_at_capture)}</small>
                </span>
              </button>
            ))
          ) : (
            <Card className="detail-card empty-state browser-empty">
              <Camera size={28} />
              <strong>{isLoading ? "Loading screenshots" : "No screenshots found"}</strong>
              <p>Try a different VA, project, date, or time range.</p>
            </Card>
          )}
        </section>

        {hasMore ? (
          <div className="load-more-row">
            <Button disabled={isLoadingMore} onClick={() => refreshScreenshots(items.length)} type="button" variant="secondary">
              {isLoadingMore ? "Loading..." : "Load More"}
            </Button>
          </div>
        ) : null}
      </section>

      {selected ? <ScreenshotLightbox item={selected} onClose={() => setSelected(null)} timezone={timezone} /> : null}
    </main>
  );
}

function ScreenshotLightbox({ item, onClose, timezone }: { item: ScreenshotBrowserItem; onClose: () => void; timezone: string }) {
  return (
    <div className="modal-backdrop screenshot-lightbox-backdrop">
      <ModalFrame className="screenshot-lightbox">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{item.vaName}</p>
            <h3>{item.projectName}</h3>
            <p className="subtle-line">
              {formatDateTimeFull(item.captured_at, timezone)} -{" "}
              {item.activity_percent_at_capture === null ? "Activity -" : formatPercent(item.activity_percent_at_capture)}
            </p>
          </div>
          <div className="lightbox-actions">
            {item.signedUrl ? (
              <Button onClick={() => downloadScreenshot(item.signedUrl!, item.storage_key)} type="button" variant="secondary">
                <Download size={16} />
                Download
              </Button>
            ) : null}
            <button className="modal-close" onClick={onClose} type="button">
              <X size={18} />
            </button>
          </div>
        </div>
        {item.signedUrl ? (
          <img alt={`Screenshot by ${item.vaName}`} className="lightbox-image" src={item.signedUrl} />
        ) : (
          <div className="screenshot-missing lightbox-missing">Signed URL unavailable</div>
        )}
      </ModalFrame>
    </div>
  );
}

function downloadScreenshot(url: string, storageKey: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = storageKey.split("/").pop() || "screenshot.jpg";
  link.click();
}

