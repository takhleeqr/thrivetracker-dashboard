delete from public.project_assignments assignment
using public.projects project
where assignment.project_id = project.id
  and project.is_active = false;

create or replace function public.cleanup_inactive_project_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_active is distinct from false and new.is_active = false then
    delete from public.project_assignments
    where project_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_cleanup_inactive_project_assignments on public.projects;

create trigger trg_cleanup_inactive_project_assignments
after update of is_active on public.projects
for each row
when (old.is_active is distinct from new.is_active)
execute function public.cleanup_inactive_project_assignments();
