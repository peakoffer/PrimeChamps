#!/usr/bin/env python3
"""
Import seed data from Google Sheets into Supabase.

Usage:
    python scripts/import_seed_data.py

Or with a CSV file:
    python scripts/import_seed_data.py --csv data/athletes.csv
"""

import sys
import re
import argparse
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.config import config
from backend.database import db, Athlete, AthleteSource, EnrichmentStatus


# Seed data from Google Sheets
SEED_DATA = [
    {
        "name": "Mary Brascia",
        "sport": "Pickleball",
        "instagram_url": "https://www.instagram.com/marybrascia.pickleball/",
        "email": "brascia@mac.com",
        "profile_url": "Mary Brascia | PPA Tour",
        "notes": None
    },
    {
        "name": "Linn M Grant",
        "sport": "Golf",
        "instagram_url": "https://www.instagram.com/linngrant/",
        "email": "pelle@creekhousemanagement.com",
        "profile_url": "Linn Grant - Wikipedia",
        "notes": None
    },
    {
        "name": "William Emard",
        "sport": "Gymnastics",
        "instagram_url": "https://www.instagram.com/will_gymnast/",
        "email": None,
        "profile_url": "William Émard - Wikipedia",
        "notes": None
    },
    {
        "name": "Catherine Parenteau",
        "sport": "Pickleball",
        "instagram_url": "https://www.instagram.com/catherineparenteau.pb/",
        "email": "catherine.partnerships@gmail.com",
        "profile_url": "Catherine Parenteau - Wikipedia",
        "notes": None
    },
    {
        "name": "Marlies Van Baalen",
        "sport": "Equestrian",
        "instagram_url": "https://www.instagram.com/marliesvanbaalen/",
        "email": None,
        "profile_url": "Marlies van Baalen - Wikipedia",
        "notes": None
    },
    {
        "name": "Conor Swail",
        "sport": "Equestrian",
        "instagram_url": "https://www.instagram.com/conor.swail/",
        "email": None,
        "profile_url": "Conor Swail (10001018) | FEI.org",
        "notes": None
    },
    {
        "name": "Егорова Анна (Anya)",
        "sport": "Swimming",
        "instagram_url": "https://www.instagram.com/any_3105/",
        "email": "anya31051998@gmail.com",
        "profile_url": "Anna Egorova - Wikipedia",
        "notes": "check if dual-citizen"
    },
    {
        "name": "Annabella Pidgley",
        "sport": "Equestrian",
        "instagram_url": "https://www.instagram.com/pidgleydressage/?img_index=1",
        "email": "equestrianmanagementagency",
        "profile_url": "Annabella Pidgley (10148383) | FEI.org",
        "notes": None
    },
    {
        "name": "Drew Kibler",
        "sport": "Swimming",
        "instagram_url": "https://www.instagram.com/drew_kibler/",
        "email": None,
        "profile_url": "Drew Kibler - Wikipedia",
        "notes": None
    },
    {
        "name": "Regan Smith",
        "sport": "Swimming",
        "instagram_url": "https://www.instagram.com/regansmith4/",
        "email": None,
        "profile_url": "Regan Smith (swimmer) - Wikipedia",
        "notes": "has a Cameo"
    },
    {
        "name": "Stacey Fluhler Waaka",
        "sport": "Rugby",
        "instagram_url": "https://www.instagram.com/staceywaaka/",
        "email": "graeme.phillips@teamwass.com",
        "profile_url": "Stacey Fluhler - Wikipedia",
        "notes": None
    },
    {
        "name": "Andrew Porter",
        "sport": "Rugby",
        "instagram_url": "https://www.instagram.com/andrewporter___/",
        "email": None,
        "profile_url": "Andrew Porter (rugby union) - Wikipedia",
        "notes": None
    },
    {
        "name": "Jack Hastings",
        "sport": "Rugby",
        "instagram_url": "https://www.instagram.com/jackohastings31/",
        "email": None,
        "profile_url": "Jackson Hastings - Wikipedia",
        "notes": None
    },
    {
        "name": "Romain Taofifenua",
        "sport": "Rugby",
        "instagram_url": "https://www.instagram.com/romaintaofifenua/",
        "email": None,
        "profile_url": "Romain Taofifénua - Wikipedia",
        "notes": None
    },
    {
        "name": "Ana Bogdan",
        "sport": "Tennis",
        "instagram_url": "https://www.instagram.com/_ana.bogdan_/",
        "email": None,
        "profile_url": "Ana Bogdan - Wikipedia",
        "notes": None
    }
]


def extract_instagram_handle(url: str) -> str | None:
    """Extract Instagram handle from URL."""
    if not url:
        return None
    patterns = [
        r"instagram\.com/([^/?]+)",
        r"@([a-zA-Z0-9_.]+)"
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            handle = match.group(1).rstrip("/")
            if handle not in ["p", "reel", "stories", "explore"]:
                return handle
    return None


def clean_email(email: str | None) -> str | None:
    """Clean and validate email."""
    if not email or email.upper() == "N/A":
        return None
    # Basic email validation
    if "@" in email and "." in email:
        return email.lower().strip()
    return None


def import_seed_data():
    """Import seed data into Supabase."""
    print("=" * 50)
    print("Prime Champs - Seed Data Import")
    print("=" * 50)

    # Check Supabase connection
    if not config.supabase.url or not config.supabase.service_key:
        print("\n❌ Error: Supabase credentials not configured.")
        print("Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env file.")
        return False

    print(f"\n📦 Importing {len(SEED_DATA)} athletes...")

    success_count = 0
    skip_count = 0
    error_count = 0

    for i, data in enumerate(SEED_DATA, 1):
        try:
            # Extract Instagram handle
            handle = extract_instagram_handle(data.get("instagram_url", ""))

            # Check if already exists
            if handle:
                existing = db.get_athlete_by_instagram(handle)
                if existing:
                    print(f"  [{i}/{len(SEED_DATA)}] ⏭️  {data['name']} (already exists)")
                    skip_count += 1
                    continue

            # Create athlete record
            athlete = Athlete(
                name=data["name"],
                sport=data["sport"],
                instagram_url=data.get("instagram_url"),
                instagram_handle=handle,
                email=clean_email(data.get("email")),
                profile_url=data.get("profile_url"),
                notes=data.get("notes"),
                source=AthleteSource.SEED_DATA,
                enrichment_status=EnrichmentStatus.PENDING
            )

            result = db.create_athlete(athlete)

            if result:
                print(f"  [{i}/{len(SEED_DATA)}] ✅ {data['name']}")
                success_count += 1
            else:
                print(f"  [{i}/{len(SEED_DATA)}] ❌ {data['name']} (insert failed)")
                error_count += 1

        except Exception as e:
            print(f"  [{i}/{len(SEED_DATA)}] ❌ {data['name']} - Error: {str(e)}")
            error_count += 1

    # Summary
    print("\n" + "=" * 50)
    print("Import Summary")
    print("=" * 50)
    print(f"  ✅ Imported: {success_count}")
    print(f"  ⏭️  Skipped:  {skip_count}")
    print(f"  ❌ Errors:   {error_count}")
    print(f"  📊 Total:    {len(SEED_DATA)}")

    return error_count == 0


def main():
    parser = argparse.ArgumentParser(description="Import seed data into Prime Champs database")
    parser.add_argument("--csv", type=str, help="Path to CSV file (optional, uses embedded data if not provided)")
    args = parser.parse_args()

    if args.csv:
        print(f"CSV import not yet implemented. Using embedded seed data.")
        # TODO: Implement CSV import

    success = import_seed_data()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
