"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Edit3, MonitorCheck, Plus, RefreshCw, Trash2, UsersRound, type LucideIcon } from "lucide-react";
import { Button, Card, Input, ModalFrame, Table, Tabs } from "@/components/ui";
import { loadAdminProfile, type Profile } from "@/lib/dashboard-data";
import { formatHours } from "@/lib/format";
import { deactivateVa, loadTeamManagement, saveVa, type ManagedVa, type TeamProjectOption, type VaFormInput } from "@/lib/team-data";
import { supabase } from "@/lib/supabase";

const navItems = [
  { label: "Overview", href: "/" },
  { label: "Team", href: "/team" },
  { label: "Projects", href: "/projects" },
  { label: "Screenshots", href: "/screenshots" },
  { label: "Reports", href: "/reports" },
  { label: "Settings", href: "/settings" },
];

const emptyForm: VaFormInput = {
  fullName: "",
  email: "",
  password: "",
  isActive: true,
  assignedProjectIds: [],
};

export default function TeamPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<Profile | null>(null);
  const [team, setTeam] = useState<ManagedVa[]>([]);
  const [projects, setProjects] = useState<TeamProjectOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<VaFormInput | null>(null);
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
      await refreshData();
    }

    boot();
    return () => {
      isMounted = false;
    };
  }, [router]);

  async function refreshData() {
    try {
      setError("");
      const data = await loadTeamManagement(supabase);
      setTeam(data.team);
      setProjects(data.projects);
      setLastUpdatedAt(new Date());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not load team data.");
    } finally {
      setIsLoading(false);
    }
  }

  async function submitVa() {
    if (!form || !admin) return;

    try {
      setIsSaving(true);
      setError("");
      await saveVa(form);
      setForm(null);
      await refreshData();
    } catch (saveError) {
      const msg = saveError instanceof Error ? saveError.message : "Could not save VA.";
      setError(msg);
      alert(msg);
    } finally {
      setIsSaving(false);
    }
  }

  async function archiveVa(va: ManagedVa) {
    const confirmed = window.confirm(`Deactivate "${va.full_name}"? They will no longer be able to log in.`);
    if (!confirmed) return;

    try {
      setError("");
      await deactivateVa(va.id);
      await refreshData();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Could not deactivate VA.");
    }
  }

  const visibleVas = useMemo(() => {
    if (statusFilter === "all") return team;
    return team.filter((va) => va.is_active);
  }, [team, statusFilter]);

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">ThriveTracker</p>
          <h1>Operations Desk</h1>
        </div>
        <nav className="nav-list" aria-label="Dashboard sections">
          {navItems.map((item) => (
            <Link className={item.label === "Team" ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Work Setup</p>
            <h2>Team</h2>
            <p className="subtle-line">
              {admin ? admin.full_name : "Checking session"}
              {lastUpdatedAt ? `, updated ${lastUpdatedAt.toLocaleTimeString()}` : ""}
            </p>
          </div>
          <div className="topbar-actions">
            <Button onClick={refreshData} type="button" variant="secondary">
              <RefreshCw size={16} />
              Refresh
            </Button>
            <Button onClick={() => setForm(emptyForm)} type="button">
              <Plus size={16} />
              New VA
            </Button>
          </div>
        </header>

        {error ? <div className="toast">{error}</div> : null}

        <section className="stats-grid" aria-label="Team stats">
          <TeamStat icon={UsersRound} label="Active VAs" value={String(team.filter((va) => va.is_active).length)} />
          <TeamStat icon={MonitorCheck} label="All VAs" value={String(team.length)} />
        </section>

        <section className="work-area">
          <Card className="wide-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Team List</p>
                <h3>Virtual Assistants</h3>
              </div>
              <Tabs>
                <button className={statusFilter === "active" ? "selected" : ""} onClick={() => setStatusFilter("active")} type="button">
                  Active
                </button>
                <button className={statusFilter === "all" ? "selected" : ""} onClick={() => setStatusFilter("all")} type="button">
                  All
                </button>
              </Tabs>
            </div>

            <Table className="projects-table">
              <div className="table-row project-table-row table-head">
                <span>VA</span>
                <span>Projects</span>
                <span>Weekly Hours</span>
                <span>Last Seen</span>
                <span>Status</span>
                <span>Actions</span>
              </div>
              {visibleVas.length ? (
                visibleVas.map((va) => (
                  <div className="table-row data-row project-table-row" key={va.id}>
                    <span className="project-name-cell">
                      <span>
                        <strong>{va.full_name}</strong>
                        <small>{va.email}</small>
                      </span>
                    </span>
                    <span>{va.assignedProjects.length ? va.assignedProjects.join(", ") : "Unassigned"}</span>
                    <span>{formatHours(va.totalHoursSeconds)}</span>
                    <span>{va.lastSeenAt ? new Date(va.lastSeenAt).toLocaleString() : "-"}</span>
                    <span>
                      <span className={`status-pill ${va.is_active ? "status-online" : "status-offline"}`}>
                        {va.is_active ? "active" : "inactive"}
                      </span>
                    </span>
                    <span className="row-actions">
                      <Button onClick={() => setForm(vaToForm(va))} type="button" variant="secondary">
                        <Edit3 size={15} />
                        Edit
                      </Button>
                      {va.is_active ? (
                        <Button onClick={() => archiveVa(va)} type="button" variant="ghost">
                          <Trash2 size={15} />
                          Deactivate
                        </Button>
                      ) : null}
                    </span>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <UsersRound size={28} />
                  <strong>{isLoading ? "Loading team" : "No VAs yet"}</strong>
                  <p>Create a VA account so they can log into the desktop app.</p>
                </div>
              )}
            </Table>
          </Card>
        </section>

        {form ? (
          <VaEditor
            form={form}
            isSaving={isSaving}
            onCancel={() => setForm(null)}
            onChange={setForm}
            onSubmit={submitVa}
            projects={projects}
          />
        ) : null}
      </section>
    </main>
  );
}

function VaEditor({
  form,
  isSaving,
  onCancel,
  onChange,
  onSubmit,
  projects,
}: {
  form: VaFormInput;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (form: VaFormInput) => void;
  onSubmit: () => void;
  projects: TeamProjectOption[];
}) {
  function toggleAssigned(projectId: string) {
    const assigned = new Set(form.assignedProjectIds);
    if (assigned.has(projectId)) {
      assigned.delete(projectId);
    } else {
      assigned.add(projectId);
    }
    onChange({ ...form, assignedProjectIds: [...assigned] });
  }

  return (
    <div className="modal-backdrop">
      <ModalFrame className="project-editor">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{form.id ? "Edit VA" : "New VA"}</p>
            <h3>{form.id ? form.fullName : "Create Virtual Assistant"}</h3>
          </div>
          <button className="modal-close" onClick={onCancel} type="button">
            ×
          </button>
        </div>

        <div className="editor-grid" style={{ gridTemplateColumns: "1fr", gap: "16px", padding: "0 24px 24px" }}>
          <label>
            Full Name
            <Input onChange={(event) => onChange({ ...form, fullName: event.target.value })} placeholder="John Doe" value={form.fullName} />
          </label>
          <label>
            Email
            <Input
              onChange={(event) => onChange({ ...form, email: event.target.value })}
              placeholder="va@example.com"
              value={form.email}
              type="email"
            />
          </label>
          <label>
            {form.id ? "Reset Password (Optional)" : "Password"}
            <Input
              onChange={(event) => onChange({ ...form, password: event.target.value })}
              placeholder="Min 6 characters"
              value={form.password || ""}
              type="password"
            />
          </label>
          <label>
            Status
            <select
              className="field"
              onChange={(event) => onChange({ ...form, isActive: event.target.value === "active" })}
              value={form.isActive ? "active" : "inactive"}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>

        <div className="assignment-box">
          <p className="eyebrow">Assign Projects</p>
          {projects.length ? (
            projects.map((project) => (
              <label className="assignment-row" key={project.id}>
                <input checked={form.assignedProjectIds.includes(project.id)} onChange={() => toggleAssigned(project.id)} type="checkbox" />
                <span>
                  <strong>{project.name}</strong>
                  <small>Visible in the VA desktop app</small>
                </span>
              </label>
            ))
          ) : (
            <p className="subtle-line">No projects found yet.</p>
          )}
        </div>

        <div className="modal-actions">
          <Button onClick={onCancel} type="button" variant="secondary">
            Cancel
          </Button>
          <Button disabled={isSaving} onClick={onSubmit} type="button">
            {isSaving ? "Saving..." : "Save VA"}
          </Button>
        </div>
      </ModalFrame>
    </div>
  );
}

function TeamStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
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

function vaToForm(va: ManagedVa): VaFormInput {
  return {
    id: va.id,
    fullName: va.full_name,
    email: va.email,
    password: "", // Never fetch password, only allow reset
    isActive: va.is_active,
    assignedProjectIds: va.assignedProjectIds,
  };
}
