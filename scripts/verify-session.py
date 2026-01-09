#!/usr/bin/env python3
"""
Self-verification script for Claude sessions.
Run after making changes to verify everything works.

Usage:
    python scripts/verify-session.py [--screenshots] [--full]
"""

import subprocess
import sys
import os
import json
from pathlib import Path
from datetime import datetime

# Change to project root
PROJECT_ROOT = Path(__file__).parent.parent
os.chdir(PROJECT_ROOT)

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'

def run(cmd, cwd=None, timeout=300):
    """Run command and return (success, output)"""
    try:
        result = subprocess.run(
            cmd, shell=True, cwd=cwd,
            capture_output=True, text=True, timeout=timeout
        )
        return result.returncode == 0, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return False, "Command timed out"
    except Exception as e:
        return False, str(e)

def check(name, cmd, cwd=None):
    """Run check and print result"""
    print(f"  {name}...", end=" ", flush=True)
    success, output = run(cmd, cwd)
    if success:
        print(f"{Colors.GREEN}✓{Colors.END}")
    else:
        print(f"{Colors.RED}✗{Colors.END}")
        # Print first few lines of error
        for line in output.strip().split('\n')[:5]:
            print(f"    {line}")
    return success

def main():
    args = sys.argv[1:]
    do_screenshots = '--screenshots' in args or '--full' in args

    print(f"\n{Colors.BLUE}═══ VERIFICATION STARTED ═══{Colors.END}\n")

    results = {}

    # 1. TypeScript Check
    print(f"{Colors.YELLOW}[1/5] TypeScript{Colors.END}")
    results['typescript'] = check(
        "Type check",
        "npx tsc --noEmit",
        cwd="dashboard"
    )

    # 2. Build Check
    print(f"\n{Colors.YELLOW}[2/5] Build{Colors.END}")
    results['build'] = check(
        "Next.js build",
        "npm run build",
        cwd="dashboard"
    )

    # 3. Python Syntax
    print(f"\n{Colors.YELLOW}[3/5] Python{Colors.END}")
    results['python'] = check(
        "Syntax check",
        "source .venv/bin/activate && python -m py_compile backend/server.py backend/database.py"
    )

    # 4. API Health (if server running)
    print(f"\n{Colors.YELLOW}[4/5] API Health{Colors.END}")
    api_checks = [
        ("Dashboard", "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 | grep -q 200"),
        ("API athletes", "curl -s http://localhost:3000/api/pipeline/athletes?stage=approval | grep -q athlete"),
    ]
    results['api'] = True
    for name, cmd in api_checks:
        if not check(name, cmd):
            results['api'] = False

    # 5. Screenshots (optional)
    if do_screenshots:
        print(f"\n{Colors.YELLOW}[5/5] Screenshots{Colors.END}")
        screenshot_script = '''
import asyncio
from playwright.async_api import async_playwright

async def take_screenshots():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})

        pages = [
            ('/', 'dashboard'),
            ('/pipeline', 'pipeline'),
            ('/athletes', 'athletes'),
            ('/analytics', 'analytics'),
            ('/inbox', 'inbox'),
            ('/messages/approval', 'messages-approval'),
            ('/pipeline/appointment', 'appointments'),
        ]

        for path, name in pages:
            try:
                await page.goto(f'http://localhost:3000{path}', wait_until='networkidle', timeout=10000)
                await page.screenshot(path=f'screenshots/{name}.png')
                print(f'  {name}: captured')
            except Exception as e:
                print(f'  {name}: FAILED - {e}')

        await browser.close()

asyncio.run(take_screenshots())
'''
        os.makedirs('screenshots', exist_ok=True)
        success, output = run(
            f'source .venv/bin/activate && python -c "{screenshot_script}"'
        )
        results['screenshots'] = success
        print(output)
    else:
        print(f"\n{Colors.YELLOW}[5/5] Screenshots{Colors.END}")
        print("  Skipped (use --screenshots to enable)")
        results['screenshots'] = None

    # Summary
    print(f"\n{Colors.BLUE}═══ SUMMARY ═══{Colors.END}")
    passed = sum(1 for v in results.values() if v is True)
    failed = sum(1 for v in results.values() if v is False)
    skipped = sum(1 for v in results.values() if v is None)

    for name, result in results.items():
        if result is True:
            print(f"  {Colors.GREEN}✓{Colors.END} {name}")
        elif result is False:
            print(f"  {Colors.RED}✗{Colors.END} {name}")
        else:
            print(f"  {Colors.YELLOW}○{Colors.END} {name} (skipped)")

    print(f"\n  Passed: {passed} | Failed: {failed} | Skipped: {skipped}")

    if failed > 0:
        print(f"\n{Colors.RED}VERIFICATION FAILED{Colors.END}")
        sys.exit(1)
    else:
        print(f"\n{Colors.GREEN}VERIFICATION PASSED{Colors.END}")
        sys.exit(0)

if __name__ == '__main__':
    main()
