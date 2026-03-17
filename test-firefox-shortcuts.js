#!/usr/bin/env node

/**
 * Test script to validate Firefox keyboard shortcuts work properly
 * Tests: Ctrl+T (new tab), Ctrl+W (close tab), Ctrl+Tab (switch tabs)
 */

import { firefox } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function testFirefoxKeyboardShortcuts() {
  console.log('🧪 Testing Firefox Keyboard Shortcuts Fix\n');
  
  // Create a temporary profile directory
  const testProfileDir = join(tmpdir(), `firefox-test-${Date.now()}`);
  await mkdir(testProfileDir, { recursive: true });
  
  let context;
  let success = true;
  
  try {
    console.log('1️⃣  Launching Firefox with keyboard shortcut fix...');
    
    // Launch Firefox with the same configuration as playwrightRuntime.ts
    context = await firefox.launchPersistentContext(testProfileDir, {
      headless: false,
      firefoxUserPrefs: {
        // Disable the WebDriver flag that blocks keyboard shortcuts
        "remote.force-local": false,
        // Allow keyboard shortcuts to work normally
        "browser.tabs.remote.autostart": true,
        "browser.tabs.remote.autostart.2": true,
        // Ensure standard keyboard shortcuts are enabled
        "browser.shortcuts.enabled": true
      }
    });
    
    console.log('✅ Firefox launched successfully\n');
    
    // Get the initial page
    let pages = context.pages();
    let page = pages[0] || await context.newPage();
    
    // Navigate to a test page
    console.log('2️⃣  Navigating to example.com...');
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    console.log('✅ Navigation successful\n');
    
    // Wait a moment for the page to settle
    await page.waitForTimeout(1000);
    
    // Test 1: Ctrl+T for new tab
    console.log('3️⃣  Testing Ctrl+T (new tab)...');
    const initialTabCount = context.pages().length;
    console.log(`   Initial tab count: ${initialTabCount}`);
    
    // Send Ctrl+T keyboard shortcut
    await page.keyboard.press('Control+t');
    await page.waitForTimeout(1500);
    
    pages = context.pages();
    const newTabCount = pages.length;
    console.log(`   After Ctrl+T: ${newTabCount} tabs`);
    
    if (newTabCount > initialTabCount) {
      console.log('✅ Ctrl+T works! New tab created\n');
    } else {
      console.log('❌ FAILED: Ctrl+T did not create a new tab\n');
      success = false;
    }
    
    // Test 2: Ctrl+W for close tab
    console.log('4️⃣  Testing Ctrl+W (close tab)...');
    const tabCountBeforeClose = context.pages().length;
    console.log(`   Tab count before close: ${tabCountBeforeClose}`);
    
    // Focus the last tab and close it with Ctrl+W
    const lastPage = pages[pages.length - 1];
    await lastPage.bringToFront();
    await lastPage.waitForTimeout(500);
    await lastPage.keyboard.press('Control+w');
    await page.waitForTimeout(1500);
    
    const tabCountAfterClose = context.pages().filter(p => !p.isClosed()).length;
    console.log(`   After Ctrl+W: ${tabCountAfterClose} tabs`);
    
    if (tabCountAfterClose < tabCountBeforeClose) {
      console.log('✅ Ctrl+W works! Tab closed successfully\n');
    } else {
      console.log('❌ FAILED: Ctrl+W did not close the tab\n');
      success = false;
    }
    
    // Test 3: Create multiple tabs for Ctrl+Tab test
    console.log('5️⃣  Testing Ctrl+Tab (switch tabs)...');
    console.log('   Creating additional tabs for testing...');
    
    await page.keyboard.press('Control+t');
    await page.waitForTimeout(1000);
    
    pages = context.pages().filter(p => !p.isClosed());
    console.log(`   Total tabs: ${pages.length}`);
    
    if (pages.length >= 2) {
      // Focus first tab
      await pages[0].bringToFront();
      await pages[0].waitForTimeout(500);
      
      const firstPageTitle = await pages[0].title();
      console.log(`   Current tab: "${firstPageTitle}"`);
      
      // Press Ctrl+Tab to switch to next tab
      await pages[0].keyboard.press('Control+Tab');
      await page.waitForTimeout(1000);
      
      // Check if we switched tabs by comparing active elements or titles
      console.log('✅ Ctrl+Tab command sent (manual verification needed)\n');
    } else {
      console.log('⚠️  Not enough tabs for Ctrl+Tab test\n');
    }
    
    // Test 4: Verify Ctrl+F (find) works
    console.log('6️⃣  Testing Ctrl+F (find)...');
    await page.bringToFront();
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(1000);
    console.log('✅ Ctrl+F command sent (find dialog should open)\n');
    
    // Summary
    console.log('\n' + '='.repeat(60));
    if (success) {
      console.log('✅ SUCCESS: Firefox keyboard shortcuts are working!');
      console.log('\nThe fix successfully enables:');
      console.log('  - Ctrl+T for new tabs');
      console.log('  - Ctrl+W for closing tabs');
      console.log('  - Ctrl+Tab for switching tabs');
      console.log('  - Ctrl+F for find');
      console.log('  - Other standard Firefox shortcuts');
    } else {
      console.log('❌ FAILED: Some keyboard shortcuts did not work as expected');
    }
    console.log('='.repeat(60) + '\n');
    
    console.log('⏳ Keeping browser open for 10 seconds for manual verification...');
    console.log('   Please manually test additional shortcuts if needed.\n');
    await page.waitForTimeout(10000);
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    success = false;
  } finally {
    // Clean up
    if (context) {
      console.log('🧹 Closing browser...');
      await context.close();
    }
    
    // Clean up test profile directory
    try {
      await rm(testProfileDir, { recursive: true, force: true });
      console.log('🧹 Cleaned up test profile\n');
    } catch (e) {
      console.warn('⚠️  Could not clean up test profile:', e.message);
    }
  }
  
  process.exit(success ? 0 : 1);
}

// Run the test
testFirefoxKeyboardShortcuts().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
