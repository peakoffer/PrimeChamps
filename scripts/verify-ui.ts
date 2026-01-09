/**
 * UI Verification Script for Claude Autonomous Sessions
 *
 * Takes screenshots of specified pages and saves them for Claude to analyze.
 * Usage: npx ts-node scripts/verify-ui.ts [page-name]
 *
 * Pages: dashboard, pipeline, athletes, approval, messages
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, '../.claude/screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

interface PageConfig {
  url: string;
  name: string;
  waitFor?: string; // CSS selector to wait for
  actions?: Array<{ type: 'click' | 'scroll' | 'wait'; target?: string; value?: number }>;
}

const PAGES: Record<string, PageConfig> = {
  dashboard: {
    url: '/',
    name: 'dashboard',
    waitFor: '[data-testid="stats-card"], .stats-card, main'
  },
  pipeline: {
    url: '/pipeline',
    name: 'pipeline',
    waitFor: '[data-testid="pipeline-board"], .pipeline-board, main'
  },
  athletes: {
    url: '/athletes',
    name: 'athletes',
    waitFor: '[data-testid="athletes-table"], table, main'
  },
  approval: {
    url: '/pipeline/approval',
    name: 'approval',
    waitFor: '[data-testid="approval-queue"], main'
  },
  messages: {
    url: '/pipeline/reach_out',
    name: 'messages',
    waitFor: '[data-testid="message-queue"], main'
  },
  inbox: {
    url: '/inbox',
    name: 'inbox',
    waitFor: '[data-testid="inbox"], main'
  },
  'message-approval': {
    url: '/messages/approval',
    name: 'message-approval',
    waitFor: 'main'
  },
  'send-queue': {
    url: '/messages/queue',
    name: 'send-queue',
    waitFor: 'main'
  }
};

async function takeScreenshot(browser: Browser, config: PageConfig): Promise<string> {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  try {
    console.log(`📸 Navigating to ${config.url}...`);
    await page.goto(`${BASE_URL}${config.url}`, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for key element
    if (config.waitFor) {
      try {
        await page.waitForSelector(config.waitFor, { timeout: 10000 });
      } catch {
        console.log(`⚠️  Selector ${config.waitFor} not found, continuing anyway`);
      }
    }

    // Execute any actions
    if (config.actions) {
      for (const action of config.actions) {
        if (action.type === 'click' && action.target) {
          await page.click(action.target);
        } else if (action.type === 'scroll') {
          await page.evaluate((y) => window.scrollBy(0, y), action.value || 500);
        } else if (action.type === 'wait') {
          await page.waitForTimeout(action.value || 1000);
        }
      }
    }

    // Small delay for animations
    await page.waitForTimeout(500);

    // Take screenshot
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${config.name}-${timestamp}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);

    await page.screenshot({ path: filepath, fullPage: false });
    console.log(`✅ Screenshot saved: ${filepath}`);

    // Also check for console errors
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    if (consoleErrors.length > 0) {
      console.log(`⚠️  Console errors found:`);
      consoleErrors.forEach(err => console.log(`   - ${err}`));
    }

    return filepath;
  } finally {
    await page.close();
  }
}

async function verifyPage(pageName: string): Promise<void> {
  const config = PAGES[pageName];
  if (!config) {
    console.error(`❌ Unknown page: ${pageName}`);
    console.log(`Available pages: ${Object.keys(PAGES).join(', ')}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    await takeScreenshot(browser, config);
  } finally {
    await browser.close();
  }
}

async function verifyAll(): Promise<void> {
  console.log('🔍 Running full UI verification...\n');

  const browser = await chromium.launch({ headless: true });
  const results: { page: string; success: boolean; file?: string; error?: string }[] = [];

  try {
    for (const [name, config] of Object.entries(PAGES)) {
      try {
        const file = await takeScreenshot(browser, config);
        results.push({ page: name, success: true, file });
      } catch (error) {
        results.push({ page: name, success: false, error: String(error) });
      }
    }
  } finally {
    await browser.close();
  }

  // Summary
  console.log('\n📊 Verification Summary:');
  console.log('========================');
  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${result.page}: ${result.success ? result.file : result.error}`);
  }

  const failed = results.filter(r => !r.success).length;
  if (failed > 0) {
    console.log(`\n⚠️  ${failed} page(s) failed verification`);
    process.exit(1);
  } else {
    console.log(`\n✅ All ${results.length} pages verified successfully`);
  }
}

// Main
const args = process.argv.slice(2);
const pageName = args[0];

if (!pageName || pageName === 'all') {
  verifyAll();
} else {
  verifyPage(pageName);
}
