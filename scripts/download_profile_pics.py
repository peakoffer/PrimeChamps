"""Download Instagram profile pictures and store in Supabase Storage."""

import os
import sys
import httpx
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

# Load environment
load_dotenv(Path(__file__).parent.parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
BUCKET_NAME = "profile-pics"

def get_supabase():
    """Get Supabase client with service key for storage access."""
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

def ensure_bucket_exists(supabase):
    """Create the profile-pics bucket if it doesn't exist."""
    try:
        # Try to get bucket info
        supabase.storage.get_bucket(BUCKET_NAME)
        print(f"Bucket '{BUCKET_NAME}' already exists")
    except Exception:
        # Create bucket with public access
        try:
            supabase.storage.create_bucket(
                BUCKET_NAME,
                options={"public": True}
            )
            print(f"Created bucket '{BUCKET_NAME}'")
        except Exception as e:
            if "already exists" in str(e).lower():
                print(f"Bucket '{BUCKET_NAME}' already exists")
            else:
                print(f"Error creating bucket: {e}")

def download_image(url: str) -> bytes | None:
    """Download an image from URL."""
    try:
        response = httpx.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            },
            timeout=30,
            follow_redirects=True
        )
        if response.status_code == 200:
            return response.content
        else:
            print(f"  Failed to download: HTTP {response.status_code}")
            return None
    except Exception as e:
        print(f"  Download error: {e}")
        return None

def upload_to_storage(supabase, athlete_id: str, image_data: bytes) -> str | None:
    """Upload image to Supabase storage and return public URL."""
    try:
        file_path = f"{athlete_id}.jpg"

        # Upload the image
        supabase.storage.from_(BUCKET_NAME).upload(
            file_path,
            image_data,
            file_options={"content-type": "image/jpeg", "upsert": "true"}
        )

        # Get public URL
        public_url = supabase.storage.from_(BUCKET_NAME).get_public_url(file_path)
        return public_url
    except Exception as e:
        print(f"  Upload error: {e}")
        return None

def process_athletes(limit: int = 300):
    """Download and store profile pics for all athletes with Instagram pics."""
    supabase = get_supabase()

    # Ensure bucket exists
    ensure_bucket_exists(supabase)

    # Get athletes with Instagram profile pics that haven't been stored yet
    result = supabase.table("athletes").select(
        "id, name, instagram_handle, profile_pic_url"
    ).eq(
        "is_historical", True
    ).not_.is_(
        "profile_pic_url", "null"
    ).limit(limit).execute()

    athletes = result.data or []
    print(f"\nFound {len(athletes)} athletes with profile pictures")

    updated = 0
    failed = 0
    skipped = 0

    for i, athlete in enumerate(athletes):
        name = athlete["name"]
        pic_url = athlete["profile_pic_url"]
        athlete_id = athlete["id"]

        # Skip if already a Supabase URL
        if "supabase" in pic_url:
            skipped += 1
            continue

        print(f"[{i+1}/{len(athletes)}] {name}...")

        # Download image
        image_data = download_image(pic_url)
        if not image_data:
            failed += 1
            continue

        # Upload to Supabase
        new_url = upload_to_storage(supabase, athlete_id, image_data)
        if not new_url:
            failed += 1
            continue

        # Update athlete record
        try:
            supabase.table("athletes").update({
                "profile_pic_url": new_url
            }).eq("id", athlete_id).execute()
            updated += 1
            print(f"  Stored!")
        except Exception as e:
            print(f"  DB update error: {e}")
            failed += 1

    print(f"\n{'='*50}")
    print(f"Results:")
    print(f"  Updated: {updated}")
    print(f"  Failed: {failed}")
    print(f"  Skipped (already stored): {skipped}")
    print(f"{'='*50}")

if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    process_athletes(limit)
