#!/usr/bin/env python3
"""Run SQL migration against Supabase database."""

import os
import sys
from pathlib import Path

# Load env
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

import httpx

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

# Read the migration SQL
migration_file = Path(__file__).parent / "migration_v6_instagram_dm.sql"
if not migration_file.exists():
    print(f"Error: Migration file not found: {migration_file}")
    sys.exit(1)

sql_content = migration_file.read_text()

# Split into individual statements (rough split on semicolons)
# Need to be careful with function bodies that contain semicolons
statements = []
current_statement = []
in_function = False

for line in sql_content.split('\n'):
    stripped = line.strip()

    # Skip empty lines and comments at statement boundaries
    if not stripped or stripped.startswith('--'):
        if current_statement:
            current_statement.append(line)
        continue

    current_statement.append(line)

    # Track function body boundaries
    if '$$' in line:
        in_function = not in_function

    # End of statement (semicolon outside function body)
    if stripped.endswith(';') and not in_function:
        statement = '\n'.join(current_statement).strip()
        if statement and not statement.startswith('--'):
            statements.append(statement)
        current_statement = []

# Execute each statement via Supabase's SQL endpoint
# Using the PostgREST rpc endpoint isn't suitable for DDL
# We'll use the direct database connection approach

print(f"Found {len(statements)} SQL statements to execute")
print(f"Supabase URL: {SUPABASE_URL}")

# Try using supabase-py's execute method
from supabase import create_client

client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# The supabase-py client doesn't support raw SQL execution directly
# We need to use the REST API or the Postgres connection

# Let's try via the Supabase SQL HTTP API endpoint
# POST to /rest/v1/rpc with function that executes SQL

# Actually, let's check if there's an exec_sql function or create one first
# For now, let's try individual table creation via client

print("\nAttempting to run migration...")
print("Note: DDL statements may need to be run via Supabase Dashboard SQL editor")
print()

# Try to execute via httpx to the database REST API
# Supabase doesn't expose raw SQL execution via REST for security
# The proper way is to use:
# 1. Supabase CLI: supabase db push
# 2. Dashboard SQL editor
# 3. Direct psycopg2 connection with database password

# Let's check if tables already exist by trying to query them
try:
    result = client.table("instagram_config").select("*").limit(1).execute()
    print("✓ instagram_config table exists")
    print(f"  Found {len(result.data)} config entries")
except Exception as e:
    if "does not exist" in str(e):
        print("✗ instagram_config table does not exist - migration needed")
    else:
        print(f"? Error checking table: {e}")

try:
    result = client.table("instagram_sessions").select("*").limit(1).execute()
    print("✓ instagram_sessions table exists")
except Exception as e:
    if "does not exist" in str(e):
        print("✗ instagram_sessions table does not exist - migration needed")
    else:
        print(f"? Error checking table: {e}")

try:
    result = client.table("instagram_conversations").select("*").limit(1).execute()
    print("✓ instagram_conversations table exists")
except Exception as e:
    if "does not exist" in str(e):
        print("✗ instagram_conversations table does not exist - migration needed")
    else:
        print(f"? Error checking table: {e}")

try:
    result = client.table("instagram_messages").select("*").limit(1).execute()
    print("✓ instagram_messages table exists")
except Exception as e:
    if "does not exist" in str(e):
        print("✗ instagram_messages table does not exist - migration needed")
    else:
        print(f"? Error checking table: {e}")

try:
    result = client.table("dm_sync_log").select("*").limit(1).execute()
    print("✓ dm_sync_log table exists")
except Exception as e:
    if "does not exist" in str(e):
        print("✗ dm_sync_log table does not exist - migration needed")
    else:
        print(f"? Error checking table: {e}")

print()
print("=" * 60)
print("To run the migration, please:")
print("1. Go to https://supabase.com/dashboard")
print("2. Select your project: rmxuwyxpoazsuqvdadlo")
print("3. Go to SQL Editor")
print("4. Paste and run the contents of:")
print(f"   {migration_file}")
print("=" * 60)
