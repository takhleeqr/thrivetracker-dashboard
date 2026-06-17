"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { RefreshCw, Save, Settings2 } from "lucide-react";
import { Button, Card, Input, Select } from "@/components/ui";
import { loadAdminProfile, type Profile } from "@/lib/dashboard-data";
import { defaultSettings, loadSettings, saveSettings, type AppSettings } from "@/lib/settings-data";
import { supabase } from "@/lib/supabase";

const navItems = [
  { label: "Overview", href: "/" },
  { label: "Team", href: "/team" },
  { label: "Projects", href: "/projects" },
  { label: "Screenshots", href: "/screenshots" },
  { label: "Reports", href: "/reports" },
  { label: "Settings", href: "/settings" },
];

const timezones = ["UTC", "Asia/Karachi", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London"];

export default function SettingsPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
      await refreshSettings();
    }

    boot();
    return () => {
      isMounted = false;
    };
  }, [router]);

  async function refreshSettings() {
    try {
      setError("");
      setMessage("");
      setIsLoading(true);
      const nextSettings = await loadSettings(supabase);
      setSettings(nextSettings);
      setLastUpdatedAt(new Date());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not load settings.");
    } finally {
      setIsLoading(false);
    }
  }

  async function submitSettings() {
    try {
      setError("");
      setMessage("");
      setIsSaving(true);
      await saveSettings(supabase, settings);
      setMessage("Settings saved. Desktop agents will pick them up on their next 15-minute sync.");
      setLastUpdatedAt(new Date());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  function updateSetting(key: keyof AppSettings, value: string) {
    setSettings((current) => ({ ...current, [key]: value }));
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
            <Link className={item.label === "Settings" ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Company Controls</p>
            <h2>Settings</h2>
            <p className="subtle-line">
              {admin ? admin.full_name : "Checking session"}
              {lastUpdatedAt ? `, updated ${lastUpdatedAt.toLocaleTimeString()}` : ""}
            </p>
          </div>
          <div className="topbar-actions">
            <Button onClick={refreshSettings} type="button" variant="secondary">
              <RefreshCw size={16} />
              Refresh
            </Button>
            <Button disabled={isSaving} onClick={submitSettings} type="button">
              <Save size={16} />
              {isSaving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </header>

        {error ? <div className="toast">{error}</div> : null}
        {message ? <div className="toast success-toast">{message}</div> : null}

        <section className="settings-grid">
          <Card className="detail-card settings-card">
            <SectionTitle title="Tracking" />
            <SettingField label="Screenshot interval" suffix="minutes">
              <Input
                min="1"
                onChange={(event) => updateSetting("screenshot_interval_minutes", event.target.value)}
                type="number"
                value={settings.screenshot_interval_minutes}
              />
            </SettingField>
            <SettingField label="Idle timeout" suffix="minutes">
              <Input
                min="1"
                onChange={(event) => updateSetting("idle_timeout_minutes", event.target.value)}
                type="number"
                value={settings.idle_timeout_minutes}
              />
            </SettingField>
            <SettingField label="Max screenshots per day" suffix="per VA">
              <Input
                min="1"
                onChange={(event) => updateSetting("max_screenshots_per_day", event.target.value)}
                type="number"
                value={settings.max_screenshots_per_day}
              />
            </SettingField>
          </Card>

          <Card className="detail-card settings-card">
            <SectionTitle title="Quality and Alerts" />
            <SettingField label="Screenshot quality" suffix={`${settings.screenshot_quality}%`}>
              <Input
                max="100"
                min="1"
                onChange={(event) => updateSetting("screenshot_quality", event.target.value)}
                type="range"
                value={settings.screenshot_quality}
              />
            </SettingField>
            <SettingField label="Low activity threshold" suffix={`${settings.low_activity_threshold}%`}>
              <Input
                max="100"
                min="0"
                onChange={(event) => updateSetting("low_activity_threshold", event.target.value)}
                type="range"
                value={settings.low_activity_threshold}
              />
            </SettingField>
          </Card>

          <Card className="detail-card settings-card">
            <SectionTitle title="Schedule" />
            <SettingField label="Work start time">
              <Input onChange={(event) => updateSetting("work_start_time", event.target.value)} type="time" value={settings.work_start_time} />
            </SettingField>
            <SettingField label="Work end time">
              <Input onChange={(event) => updateSetting("work_end_time", event.target.value)} type="time" value={settings.work_end_time} />
            </SettingField>
            <SettingField label="Timezone">
              <Select onChange={(event) => updateSetting("timezone", event.target.value)} value={settings.timezone}>
                {timezones.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </Select>
            </SettingField>
          </Card>

          <Card className="detail-card settings-card">
            <SectionTitle title="Retention" />
            <SettingField label="Data retention" suffix="days">
              <Input
                min="1"
                onChange={(event) => updateSetting("data_retention_days", event.target.value)}
                type="number"
                value={settings.data_retention_days}
              />
            </SettingField>
            <div className="settings-note">
              <Settings2 size={18} />
              <p>Retention cleanup is planned next; this value is saved now so cleanup jobs can use it later.</p>
            </div>
          </Card>
        </section>

        {isLoading ? <p className="subtle-line">Loading settings...</p> : null}
      </section>
    </main>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">Settings</p>
        <h3>{title}</h3>
      </div>
    </div>
  );
}

function SettingField({ children, label, suffix }: { children: ReactNode; label: string; suffix?: string }) {
  return (
    <label className="setting-field">
      <span>
        {label}
        {suffix ? <em>{suffix}</em> : null}
      </span>
      {children}
    </label>
  );
}
