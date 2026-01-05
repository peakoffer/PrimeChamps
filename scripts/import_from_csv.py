#!/usr/bin/env python3
"""
Import athlete data from CSV file into Supabase.

Usage:
    python scripts/import_from_csv.py data/final_data.csv
    python scripts/import_from_csv.py data/final_data.csv --clear  # Clear existing data first

Expected CSV columns (from Google Sheets "Final Data" tab):
    Year, Name, Sport, Division, OF Username, Contract End Date, IG Handle, IG Link, OF Link, Extra Info
"""

import sys
import re
import csv
import argparse
from pathlib import Path
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.config import config
from backend.database import db, Athlete, AthleteSource, EnrichmentStatus


def extract_instagram_handle(url_or_handle: str) -> str | None:
    """Extract Instagram handle from URL or raw handle."""
    if not url_or_handle:
        return None

    url_or_handle = str(url_or_handle).strip()

    # If it's already a handle (no URL), clean it
    if not url_or_handle.startswith("http"):
        handle = url_or_handle.lstrip("@").strip()
        if handle and handle.lower() not in ["n/a", "na", "-", "—", ""]:
            return handle
        return None

    # Extract from URL
    patterns = [
        r"instagram\.com/([^/?]+)",
        r"@([a-zA-Z0-9_.]+)"
    ]
    for pattern in patterns:
        match = re.search(pattern, url_or_handle)
        if match:
            handle = match.group(1).rstrip("/")
            if handle not in ["p", "reel", "stories", "explore"]:
                return handle
    return None


def clean_value(value: str | None) -> str | None:
    """Clean a value, returning None for empty/NA values."""
    if not value:
        return None
    value = str(value).strip()
    if value.lower() in ["n/a", "na", "-", "—", "", "none"]:
        return None
    return value


def parse_year(value: str | None) -> int | None:
    """Parse year from value."""
    if not value:
        return None
    value = str(value).strip()
    # Handle "2023", "2024", etc.
    match = re.search(r"20\d{2}", value)
    if match:
        return int(match.group())
    return None


def import_csv(csv_path: str, clear_existing: bool = False):
    """Import athletes from CSV file."""
    print("=" * 60)
    print("Prime Champs - CSV Import")
    print("=" * 60)

    # Check file exists
    csv_file = Path(csv_path)
    if not csv_file.exists():
        print(f"\n❌ Error: File not found: {csv_path}")
        return False

    # Check Supabase connection
    if not config.supabase.url or not config.supabase.service_key:
        print("\n❌ Error: Supabase credentials not configured.")
        print("Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env file.")
        return False

    # Clear existing data if requested
    if clear_existing:
        print("\n🗑️  Clearing existing athlete data...")
        try:
            # Delete all athletes (cascades to enrichment data)
            result = db.client.table("athletes").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            print(f"   Deleted {len(result.data) if result.data else 0} existing records")
        except Exception as e:
            print(f"   Warning: Could not clear data: {e}")

    # Read CSV file
    print(f"\n📂 Reading: {csv_path}")

    athletes_data = []
    with open(csv_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        # Print detected columns
        print(f"   Columns found: {reader.fieldnames}")

        for row in reader:
            athletes_data.append(row)

    print(f"   Rows found: {len(athletes_data)}")

    if not athletes_data:
        print("\n❌ No data found in CSV")
        return False

    # Map column names (handle variations)
    def get_value(row, *keys):
        """Get value from row, trying multiple possible column names."""
        for key in keys:
            if key in row:
                return clean_value(row[key])
        return None

    # Import athletes
    print(f"\n📦 Importing {len(athletes_data)} athletes...")

    success_count = 0
    skip_count = 0
    error_count = 0
    seen_handles = set()  # Track duplicates within this import

    for i, row in enumerate(athletes_data, 1):
        try:
            # Extract data with column name variations
            name = get_value(row, "Name", "name", "Athlete Name", "Athlete")
            if not name:
                skip_count += 1
                continue

            sport = get_value(row, "Sport", "sport", "Sport Type", "Category")
            if not sport:
                sport = "Unknown"

            # Get Instagram handle
            ig_handle = get_value(row, "IG Handle", "ig_handle", "Instagram Handle", "Instagram")
            ig_link = get_value(row, "IG Link", "ig_link", "Instagram Link", "Instagram URL")

            instagram_handle = extract_instagram_handle(ig_handle) or extract_instagram_handle(ig_link)

            # Skip duplicates based on name + year (allow same athlete in different years)
            year = parse_year(get_value(row, "Year", "year", "Contract Year"))
            dedup_key = f"{name.lower()}_{year or 'unknown'}"

            if instagram_handle:
                dedup_key = f"{instagram_handle.lower()}_{year or 'unknown'}"

            if dedup_key in seen_handles:
                skip_count += 1
                continue
            seen_handles.add(dedup_key)

            # Build athlete record
            athlete = Athlete(
                name=name,
                sport=sport,
                instagram_handle=instagram_handle,
                instagram_url=ig_link,
                contract_year=year,
                division=get_value(row, "Division", "division", "Weight Class", "Class"),
                of_username=get_value(row, "OF Username", "of_username", "OnlyFans Username", "OF Handle"),
                of_url=get_value(row, "OF Link", "of_link", "OnlyFans Link", "OF URL"),
                contract_end_date=get_value(row, "Contract End Date", "contract_end_date", "End Date"),
                notes=get_value(row, "Extra Info", "extra_info", "Notes", "Extra"),
                source=AthleteSource.SEED_DATA,
                enrichment_status=EnrichmentStatus.PENDING
            )

            result = db.create_athlete(athlete)

            if result:
                if i % 50 == 0 or i == len(athletes_data):
                    print(f"   [{i}/{len(athletes_data)}] Imported {success_count + 1} athletes...")
                success_count += 1
            else:
                error_count += 1

        except Exception as e:
            print(f"   [{i}/{len(athletes_data)}] ❌ Error: {str(e)[:50]}")
            error_count += 1

    # Summary
    print("\n" + "=" * 60)
    print("Import Summary")
    print("=" * 60)
    print(f"  ✅ Imported: {success_count}")
    print(f"  ⏭️  Skipped:  {skip_count} (duplicates or empty)")
    print(f"  ❌ Errors:   {error_count}")
    print(f"  📊 Total:    {len(athletes_data)}")

    # Show breakdown by sport
    print("\n📊 By Sport:")
    result = db.client.table("athletes").select("sport").execute()
    if result.data:
        sports = {}
        for r in result.data:
            sport = r.get("sport", "Unknown")
            sports[sport] = sports.get(sport, 0) + 1
        for sport, count in sorted(sports.items(), key=lambda x: -x[1]):
            print(f"   {sport}: {count}")

    return error_count == 0


def main():
    parser = argparse.ArgumentParser(description="Import athlete data from CSV")
    parser.add_argument("csv_file", help="Path to CSV file")
    parser.add_argument("--clear", action="store_true", help="Clear existing data before import")
    args = parser.parse_args()

    success = import_csv(args.csv_file, clear_existing=args.clear)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
