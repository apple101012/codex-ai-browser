#!/usr/bin/env node

/**
 * Manual test for Firefox keyboard shortcuts
 * This test launches Firefox and provides instructions for manual verification
 * since browser-level shortcuts cannot be automated via Playwright API
 */

import { firefox } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function testFirefoxKeyboardShortcutsManual() {
  console.log('🧪 Firefox Keyboard Shortcuts - Manual Verification Test\n');
  console.log('=' .repeat(70));
  console.log('IMPORTANT: This test requires MANUAL verification');
  console.log('Browser-level shortcuts cannot be automated via Playwright');
  console.log('=' .repeat(70) + '\n');
  
  const testProfileDir = join(tmpdir(), `firefox-manual-test-${Date.now()}`);
  await mkdir(testProfileDir, { recursive: true });
  
  let context;
  
  try {
    console.log('1️⃣  Launching Firefox with keyboard shortcut fix enabled...\n');
    
    context = await firefox.launchPersistentContext(testProfileDir, {
      headless: false,
      firefoxUserPrefs: {
        // Disable WebDriver mode that blocks browser shortcuts
        "dom.webdriver.enabled": false,
        // Allow full browser functionality (not restricted automation mode)
        "marionette.webdriver": false,
        // Ensure keyboard shortcuts are enabled
        "browser.shortcuts.enabled": true,
        // Additional preferences for better compatibility
        "browser.tabs.remote.autostart": true,
        "browser.tabs.remote.autostart.2": true
      }
    });
    
    console.log('✅ Firefox launched successfully!\n');
    
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    
    console.log('📋 MANUAL TEST INSTRUCTIONS:');
    console.log('=' .repeat(70));
    console.log('Please test the following keyboard shortcuts IN THE FIREFOX WINDOW:\n');
    
    console.log('✓ Ctrl+T       - Open a new tab');
    console.log('✓ Ctrl+W       - Close current tab');
    console.log('✓ Ctrl+Shift+T - Reopen closed tab');
    console.log('✓ Ctrl+Tab     - Switch to next tab');
    console.log('✓ Ctrl+Shift+Tab - Switch to previous tab');
    console.log('✓ Ctrl+L       - Focus address bar');
    console.log('✓ Ctrl+F       - Open find dialog');
    console.log('✓ Ctrl+K       - Focus search bar');
    console.log('✓ Ctrl+N       - Open new window');
    console.log('✓ Ctrl+H       - Open history sidebar');
    console.log('✓ Ctrl+J       - Open downloads');
    console.log('✓ F5           - Refresh page');
    console.log('✓ Ctrl+R       - Refresh page');
    console.log('✓ Ctrl++       - Zoom in');
    console.log('✓ Ctrl+-       - Zoom out');
    console.log('✓ Ctrl+0       - Reset zoom\n');
    
    console.log('=' .repeat(70));
    console.log('\n⏳ Browser will stay open for 60 seconds for testing...');
    console.log('   Press Ctrl+C in this terminal to exit early\n');
    
    // Keep browser open for manual testing
    await page.waitForTimeout(60000);
    
    console.log('\n📝 RESULTS:');
    console.log('=' .repeat(70));
    console.log('Did the keyboard shortcuts work as expected?');
    console.log('If YES: The fix is successful! ✅');
    console.log('If NO:  There may be additional Firefox restrictions ❌');
    console.log('=' .repeat(70) + '\n');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    if (context) {
      console.log('🧹 Closing browser...');
      await context.close();
    }
    
    try {
      await rm(testProfileDir, { recursive: true, force: true });
      console.log('🧹 Cleaned up test profile\n');
    } catch (e) {
      console.warn('⚠️  Could not clean up test profile:', e.message);
    }
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Test interrupted by user');
  process.exit(0);
});

testFirefoxKeyboardShortcutsManual().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
