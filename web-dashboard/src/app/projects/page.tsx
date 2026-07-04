"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Edit3, FolderKanban, Plus, RefreshCw, Trash2, UsersRound, type LucideIcon } from "lucide-react";
import { Button, Card, Input, ModalFrame, Table, Tabs } from "@/components/ui";
import { loadAdminProfile, type Profile } from "@/lib/dashboard-data";
import { formatHours } from "@/lib/format";
import { loadSettings } from "@/lib/settings-data";
import {
  deactivateProject,
  loadProjectsManagement,
  saveProject,
  type ManagedProject,
  type ProjectFormInput,
  type VaOption,
} from "@/lib/projects-data";
import { supabase } from "@/lib/supabase";
import { formatDateTimeFull, formatTime } from "@/lib/timezone";

const colorChoices = ["#2563EB", "#16A34A", "#D97706", "#DC2626", "#7C3AED", "#0F766E"];
const navItems = [
  { label: "Overview", href: "/" },
  { label: "Team", href: "/team" },
  { label: "Projects", href: "/projects" },
  { label: "Screenshots", href: "/screenshots" },
  { label: "Reports", href: "/reports" },
  { label: "Settings", href: "/settings" },
];

const emptyForm: ProjectFormInput = {
  name: "",
  description: "",
  color: "#2563EB",
  isActive: true,
  assignedUserIds: [],
};

export default function ProjectsPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<Profile | null>(null);
  const [projects, setProjects] = useState<ManagedProject[]>([]);
  const [vas, setVas] = useState<VaOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<ProjectFormInput | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [timezone, setTimezone] = useState("Asia/Karachi");

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
      const data = await loadProjectsManagement(supabase);
      setProjects(data.projects);
      setVas(data.vas);
      setLastUpdatedAt(new Date());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not load projects.");
    } finally {
      setIsLoading(false);
    }
  }

  async function submitProject() {
    if (!form || !admin) return;

    try {
      setIsSaving(true);
      setError("");
      await saveProject(supabase, form, admin.id);
      setForm(null);
      await refreshData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save project.");
    } finally {
      setIsSaving(false);
    }
  }

  async function archiveProject(project: ManagedProject) {
    const confirmed = window.confirm(`Deactivate "${project.name}"? VAs will no longer see it in the desktop app.`);
    if (!confirmed) return;

    try {
      setError("");
      await deactivateProject(supabase, project.id);
      await refreshData();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Could not deactivate project.");
    }
  }

  const visibleProjects = useMemo(() => {
    if (statusFilter === "all") return projects;
    return projects.filter((project) => project.is_active);
  }, [projects, statusFilter]);

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Magik Tracker</p>
          <h1>Operations Desk</h1>
        </div>
        <nav className="nav-list" aria-label="Dashboard sections">
          {navItems.map((item) => (
            <Link className={item.label === "Projects" ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Work Setup</p>
            <h2>Projects</h2>
            <p className="subtle-line">
              {admin ? admin.full_name : "Checking session"}
              {lastUpdatedAt ? `, updated ${formatTime(lastUpdatedAt, timezone)}` : ""}
            </p>
          </div>
          <div className="topbar-actions">
            <Button onClick={refreshData} type="button" variant="secondary">
              <RefreshCw size={16} />
              Refresh
            </Button>
            <Button onClick={() => setForm(emptyForm)} type="button">
              <Plus size={16} />
              New Project
            </Button>
          </div>
        </header>

        {error ? <div className="toast">{error}</div> : null}

        <section className="stats-grid" aria-label="Project stats">
          <ProjectStat icon={FolderKanban} label="Active Projects" value={String(projects.filter((project) => project.is_active).length)} />
          <ProjectStat icon={UsersRound} label="Assigned VAs" value={String(new Set(projects.flatMap((project) => project.assignedUserIds)).size)} />
          <ProjectStat icon={FolderKanban} label="All Projects" value={String(projects.length)} />
          <ProjectStat icon={UsersRound} label="Available VAs" value={String(vas.filter((va) => va.is_active).length)} />
        </section>

        <section className="work-area">
          <Card className="wide-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Project List</p>
                <h3>Assignments and Activity</h3>
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
                <span>Project</span>
                <span>VAs</span>
                <span>Total Hours</span>
                <span>Last Activity</span>
                <span>Status</span>
                <span>Actions</span>
              </div>
              {visibleProjects.length ? (
                visibleProjects.map((project) => (
                  <div className="table-row data-row project-table-row" key={project.id}>
                    <span className="project-name-cell">
                      <i style={{ background: project.color }} />
                      <span>
                        <strong>{project.name}</strong>
                        <small>{project.description || "No description"}</small>
                      </span>
                    </span>
                    <span>{project.assignedNames.length ? project.assignedNames.join(", ") : "Unassigned"}</span>
                    <span>{formatHours(project.totalHoursSeconds)}</span>
                    <span>{formatDateTimeFull(project.lastActivityAt, timezone)}</span>
                    <span>
                      <span className={`status-pill ${project.is_active ? "status-online" : "status-offline"}`}>
                        {project.is_active ? "active" : "inactive"}
                      </span>
                    </span>
                    <span className="row-actions">
                      <Button onClick={() => setForm(projectToForm(project))} type="button" variant="secondary">
                        <Edit3 size={15} />
                        Edit
                      </Button>
                      {project.is_active ? (
                        <Button onClick={() => archiveProject(project)} type="button" variant="ghost">
                          <Trash2 size={15} />
                          Deactivate
                        </Button>
                      ) : null}
                    </span>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <FolderKanban size={28} />
                  <strong>{isLoading ? "Loading projects" : "No projects yet"}</strong>
                  <p>Create a project and assign VAs so the desktop app can track work against it.</p>
                </div>
              )}
            </Table>
          </Card>
        </section>

        {form ? (
          <ProjectEditor
            form={form}
            isSaving={isSaving}
            onCancel={() => setForm(null)}
            onChange={setForm}
            onSubmit={submitProject}
            vas={vas}
          />
        ) : null}
      </section>
    </main>
  );
}

function ProjectEditor({
  form,
  isSaving,
  onCancel,
  onChange,
  onSubmit,
  vas,
}: {
  form: ProjectFormInput;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (form: ProjectFormInput) => void;
  onSubmit: () => void;
  vas: VaOption[];
}) {
  function toggleAssigned(userId: string) {
    const assigned = new Set(form.assignedUserIds);
    if (assigned.has(userId)) {
      assigned.delete(userId);
    } else {
      assigned.add(userId);
    }
    onChange({ ...form, assignedUserIds: [...assigned] });
  }

  return (
    <div className="modal-backdrop">
      <ModalFrame className="project-editor">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{form.id ? "Edit Project" : "New Project"}</p>
            <h3>{form.id ? form.name : "Create project"}</h3>
          </div>
          <button className="modal-close" onClick={onCancel} type="button">
            ×
          </button>
        </div>

        <div className="editor-grid">
          <label>
            Project name
            <Input onChange={(event) => onChange({ ...form, name: event.target.value })} placeholder="Client Work" value={form.name} />
          </label>
          <label>
            Description
            <Input
              onChange={(event) => onChange({ ...form, description: event.target.value })}
              placeholder="What this project is used for"
              value={form.description}
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

        <div className="color-picker-row" aria-label="Project color">
          {colorChoices.map((color) => (
            <button
              aria-label={`Use color ${color}`}
              className={form.color === color ? "selected" : ""}
              key={color}
              onClick={() => onChange({ ...form, color })}
              style={{ background: color }}
              type="button"
            />
          ))}
        </div>

        <div className="assignment-box">
          <p className="eyebrow">Assign VAs</p>
          {vas.length ? (
            vas.map((va) => (
              <label className="assignment-row" key={va.id}>
                <input checked={form.assignedUserIds.includes(va.id)} onChange={() => toggleAssigned(va.id)} type="checkbox" />
                <span>
                  <strong>{va.full_name}</strong>
                  <small>{va.email}</small>
                </span>
                {!va.is_active ? <em>Inactive</em> : null}
              </label>
            ))
          ) : (
            <p className="subtle-line">No VA users found yet.</p>
          )}
        </div>

        <div className="modal-actions">
          <Button onClick={onCancel} type="button" variant="secondary">
            Cancel
          </Button>
          <Button disabled={isSaving} onClick={onSubmit} type="button">
            {isSaving ? "Saving..." : "Save Project"}
          </Button>
        </div>
      </ModalFrame>
    </div>
  );
}

function ProjectStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
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

function projectToForm(project: ManagedProject): ProjectFormInput {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? "",
    color: project.color,
    isActive: project.is_active,
    assignedUserIds: project.assignedUserIds,
  };
}
