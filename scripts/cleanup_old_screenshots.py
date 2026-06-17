import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

from supabase import create_client


def load_dotenv_file() -> None:
    env_path = ".env"
    if not os.path.exists(env_path):
        return

    with open(env_path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def get_retention_days(supabase, override_days: int | None) -> int:
    if override_days is not None:
        return override_days

    response = supabase.table("settings").select("value").eq("key", "data_retention_days").maybe_single().execute()
    value = response.data["value"] if response.data else "90"
    return int(value)


def fetch_old_screenshots(supabase, cutoff_iso: str, batch_size: int) -> list[dict]:
    response = (
        supabase.table("screenshots")
        .select("id,storage_key,captured_at")
        .lt("captured_at", cutoff_iso)
        .order("captured_at", desc=False)
        .limit(batch_size)
        .execute()
    )
    return list(response.data or [])


def remove_storage_objects(bucket, storage_keys: list[str], dry_run: bool) -> None:
    if dry_run or not storage_keys:
        return
    bucket.remove(storage_keys)


def remove_metadata_rows(supabase, row_ids: list[str], dry_run: bool) -> None:
    if dry_run or not row_ids:
        return
    supabase.table("screenshots").delete().in_("id", row_ids).execute()


def main() -> int:
    parser = argparse.ArgumentParser(description="Delete old ThriveTracker screenshots from Supabase Storage and metadata.")
    parser.add_argument("--days", type=int, default=None, help="Override settings.data_retention_days.")
    parser.add_argument("--batch-size", type=int, default=100, help="Maximum rows to inspect in one run.")
    parser.add_argument("--dry-run", action="store_true", help="Preview deletions without deleting anything.")
    parser.add_argument("--execute", action="store_true", help="Actually delete old screenshots.")
    args = parser.parse_args()

    if args.dry_run and args.execute:
        print("Use either --dry-run or --execute, not both.", file=sys.stderr)
        return 2

    dry_run = not args.execute
    load_dotenv_file()

    supabase_url = required_env("NEXT_PUBLIC_SUPABASE_URL")
    service_role_key = required_env("SUPABASE_SERVICE_ROLE_KEY")
    bucket_name = required_env("SUPABASE_STORAGE_BUCKET")

    supabase = create_client(supabase_url, service_role_key)
    retention_days = get_retention_days(supabase, args.days)
    if retention_days < 1:
        raise RuntimeError("Retention days must be 1 or greater.")

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    cutoff = now - timedelta(days=retention_days)
    cutoff = min(cutoff, today_start)
    cutoff_iso = cutoff.isoformat()

    old_rows = fetch_old_screenshots(supabase, cutoff_iso, args.batch_size)
    safe_rows = [row for row in old_rows if parse_timestamp(row["captured_at"]) < today_start]
    storage_keys = [row["storage_key"] for row in safe_rows]
    row_ids = [row["id"] for row in safe_rows]

    print(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")
    print(f"Retention days: {retention_days}")
    print(f"Cutoff: {cutoff_iso}")
    print(f"Rows eligible: {len(safe_rows)}")

    for row in safe_rows[:20]:
        print(f"- {row['captured_at']}  {row['storage_key']}")

    if len(safe_rows) > 20:
        print(f"...and {len(safe_rows) - 20} more")

    remove_storage_objects(supabase.storage.from_(bucket_name), storage_keys, dry_run)
    remove_metadata_rows(supabase, row_ids, dry_run)

    if dry_run:
        print("Dry run complete. Re-run with --execute to delete these files.")
    else:
        print(f"Deleted {len(safe_rows)} screenshot objects and metadata rows.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
