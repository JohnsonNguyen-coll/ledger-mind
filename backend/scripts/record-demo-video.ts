import { chromium, type Page } from 'playwright-core';
import { existsSync, unlinkSync, rmSync, mkdirSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { readConfig } from '../src/config.js';
import { startSystem } from '../src/system.js';

async function showModal(page: Page, modalId: string) {
  await page.evaluate((id) => {
    const m = document.getElementById(id);
    if (m) {
      m.hidden = false;
      m.style.zIndex = '3000';
    }
  }, modalId);
  await page.waitForTimeout(400);
}

async function hideModal(page: Page, modalId: string) {
  await page.evaluate((id) => {
    const m = document.getElementById(id);
    if (m) m.hidden = true;
  }, modalId);
  await page.waitForTimeout(300);
}

async function main() {
  console.log('=== LedgerMind LIVE Hackathon Demo Recorder (Port 3001) ===');

  // 1. Load live environment (.env.live)
  const envLivePath = resolve('.env.live');
  if (!existsSync(envLivePath)) {
    throw new Error('.env.live not found!');
  }
  dotenv.config({ path: envLivePath, override: true });



  console.log('Starting LedgerMind LIVE server on port 3001...');
  const config = readConfig();
  const system = await startSystem(config);
  console.log('Live server started at:', system.url);

  const outputDir = resolve('demo-recordings');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  console.log('Launching Edge browser with screen recording...');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: [
      '--window-size=1920,1080',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: outputDir,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();

  console.log('Navigating to', system.url, '...');
  await page.goto(system.url, { waitUntil: 'networkidle' });

  // Hide initial modal to show clean office
  await hideModal(page, 'modal-task');

  // =========================================================================
  // SCENE 1: Introduction & The Pixel Office (Exactly 5s as requested)
  // =========================================================================
  console.log('Scene 1: Showcasing The Pixel Office (5s)...');
  await page.hover('.crypto-ticker-stack');
  await page.waitForTimeout(2500);
  await page.hover('#win-status');
  await page.waitForTimeout(2500);

  // =========================================================================
  // SCENE 2: Task Dispatch LIVE (0.01 Budget & Binance Agentic Wallet consent)
  // =========================================================================
  console.log('Scene 2: Task Dispatch LIVE with $0.01 budget...');
  await page.click('#nav-tasks');
  await showModal(page, 'modal-task');
  await page.waitForTimeout(1000);

  // Set prompt
  const promptInput = page.locator('#prompt');
  await promptInput.fill('');
  await promptInput.pressSequentially('Research ETH: read Binance market and CoinMarketCap quote', { delay: 25 });
  await page.waitForTimeout(1000);

  // Select $0.01 quick chip
  console.log('Selecting $0.01 live budget chip...');
  const chip001 = page.locator('.preset-chips button[data-budget="0.01"]');
  if (await chip001.isVisible()) {
    await chip001.click();
  } else {
    await page.locator('#budget').fill('0.01');
  }
  await page.waitForTimeout(800);

  // Authorize real payments checkbox
  const consentRow = page.locator('#consent-row');
  const consentCheck = page.locator('#real-consent');
  if (await consentRow.isVisible()) {
    console.log('Checking Authorize real payments consent...');
    await consentCheck.check();
    await page.waitForTimeout(800);
  }

  // Click Run agent
  console.log('Dispatching LIVE agent task...');
  await page.click('#run');
  await page.waitForTimeout(2000);

  // Close modal to see the agents in meeting room
  await hideModal(page, 'modal-task');
  console.log('Watching agents walk to meeting room and process live data...');
  await page.waitForTimeout(16000);

  // =========================================================================
  // SCENE 3: The Vault & 4-Tier Budget Guardrails (Live Limits)
  // =========================================================================
  console.log('Scene 3: The Vault & 4-Tier Budget Guardrails (Live Mode)...');
  await page.click('#nav-vault');
  await showModal(page, 'modal-vault');
  await page.waitForTimeout(2000);

  // Hover on vault cards to show details
  await page.hover('#wallet');
  await page.waitForTimeout(1500);
  await page.hover('#daily');
  await page.waitForTimeout(1500);
  await page.hover('#max-payment');
  await page.waitForTimeout(1500);
  await page.hover('#integration');
  await page.waitForTimeout(2500);
  await hideModal(page, 'modal-vault');
  await page.waitForTimeout(1000);

  // =========================================================================
  // SCENE 4: Cryptographic Audit Log & Finished Report
  // =========================================================================
  console.log('Scene 4: Cryptographic Audit Log & Live Report...');
  await page.click('#nav-audit');
  await showModal(page, 'modal-audit');
  await page.waitForTimeout(3000);
  await page.hover('#events');
  await page.waitForTimeout(2500);
  await hideModal(page, 'modal-audit');
  await page.waitForTimeout(1000);

  // Open Intelligence Report
  await page.click('#nav-report');
  await showModal(page, 'modal-report');
  await page.waitForTimeout(4000);
  await page.hover('#report');
  await page.waitForTimeout(2000);
  await hideModal(page, 'modal-report');
  await page.waitForTimeout(1000);

  // =========================================================================
  // SCENE 5: LedgerMind Copilot (Multi-Chain RPC Scan + Groq LPU for ultra-fast AI)
  // =========================================================================
  console.log('Scene 5: LedgerMind Copilot & Multi-Chain Intelligence...');
  await page.click('#nav-it');
  await showModal(page, 'modal-it');
  await page.waitForTimeout(2000);

  // Click on treasury preset
  console.log('Selecting Treasury preset...');
  await page.click('[data-preset="dumper"]');
  await page.waitForTimeout(1500);

  // Click Analyze (0.01 USDC)
  console.log('Running 8-chain multi-RPC scan...');
  await page.click('#btn-run-profiler');
  await page.waitForTimeout(5000); // wait for RPC results to render

  // Switch to Treasury Radar tab
  console.log('Switching to Treasury Radar tab...');
  await page.click('#it-tab-btn-radar');
  await page.waitForTimeout(1500);

  console.log('Using Groq LPU for ultra-fast inference...');

  // Click query preset
  await page.click('[data-query="Watch SOL for me"]');
  await page.waitForTimeout(1200);

  // Submit query
  console.log('Submitting natural language inquiry to LedgerMind Copilot (Groq Llama 3.3)...');
  await page.click('#btn-submit-nl');
  await page.waitForTimeout(4000); // Groq returns rapidly

  // Hover over the action card
  await page.hover('#it-action-card');
  await page.waitForTimeout(4000);

  // Close Copilot
  await hideModal(page, 'modal-it');
  await page.waitForTimeout(2000);

  // Return to full canvas
  console.log('Finishing video recording...');
  const video = page.video();
  await page.close();
  await context.close();
  await browser.close();

  await system.close();

  if (video) {
    const videoPath = await video.path();
    const finalPath = resolve(outputDir, 'ledgermind-demo.webm');
    if (existsSync(finalPath)) unlinkSync(finalPath);
    await rename(videoPath, finalPath);
    console.log('\n>>> SUCCESS! LIVE Demo video recorded and saved to:');
    console.log(finalPath);
  }

  console.log('All live recording steps completed successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Recording failed:', err);
  process.exit(1);
});
