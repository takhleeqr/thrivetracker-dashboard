import argparse
import os
import sys
from io import BytesIO
from datetime import datetime, timezone
from pathlib import PurePosixPath
from uuid import UUID

from PIL import Image
from supabase import create_client


def make_test_jpeg() -> bytes:
    image = Image.new("RGB", (1, 1), color=(255, 255, 255))
    output = BytesIO()
    image.save(output, format="JPEG", quality=70)
    return output.getvalue()


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


def build_storage_key(user_id: str) -> str:
    UUID(user_id)
    captured_at = datetime.now(timezone.utc)
    return str(
        PurePosixPath(
            user_id,
            captured_at.strftime("%Y-%m-%d"),
            f"{captured_at.strftime('%H-%M-%S')}.jpg",
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload a tiny test JPEG to Supabase Storage.")
    parser.add_argument(
        "--user-id",
        default="00000000-0000-0000-0000-000000000000",
        help="UUID path prefix to use for the test object.",
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Keep the uploaded test object instead of deleting it.",
    )
    args = parser.parse_args()

    load_dotenv_file()

    supabase_url = required_env("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or required_env("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    bucket_name = required_env("SUPABASE_STORAGE_BUCKET")
    storage_key = build_storage_key(args.user_id)

    try:
        supabase = create_client(supabase_url, supabase_key)
        bucket = supabase.storage.from_(bucket_name)

        bucket.upload(
            path=storage_key,
            file=make_test_jpeg(),
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )

        parent_path = str(PurePosixPath(storage_key).parent)
        file_name = PurePosixPath(storage_key).name
        objects = bucket.list(parent_path)
        if not any(item.get("name") == file_name for item in objects):
            raise RuntimeError(f"Uploaded object was not found in bucket listing: {storage_key}")

        print(f"Uploaded and verified: {bucket_name}/{storage_key}")

        if not args.keep:
            bucket.remove([storage_key])
            print("Deleted test object.")

    except Exception as error:
        print(f"Supabase Storage smoke test failed: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
