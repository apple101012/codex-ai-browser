#!/usr/bin/env node

/**
 * Test Firefox keyboard shortcuts using the actual PlaywrightRuntime
 * This tests the real implementation from playwrightRuntime.ts
 */

import { PlaywrightRuntime } from './dist/src/browser/playwrightRuntime.js';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function testWithPlaywrightRuntime() {
  console.log('🧪 Testing Firefox Keyboard Shortcuts with PlaywrightRuntime\n');
  console.log('=' .repeat(70));
  
  const testDataDir = join(tmpdir(), `firefox-runtime-test-${Date.now()}`);
  const artifactsDir = join(testDataDir, 'artifacts');
  
  await mkdir(testDataDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });
  
  const runtime = new PlaywrightRuntime({
    artifactsDir,
    defaultHeadless: false,
    allowEvaluate: true
  });
  
  const testProfile = {
    id: 'firefox-test',
    name: 'Firefox Keyboard Test',
    engine: 'firefox',
    dataDir: join(testDataDir, 'profile'),
    settings: {
      headless: false
    },
    createdAt: new Date().toISOString()
  };
  
  try {
    console.log('1️⃣  Starting Firefox profile with PlaywrightRuntime...\n');
    await runtime.start(testProfile);
    console.log('✅ Firefox started successfully!\n');
    
    console.log('2️⃣  Navigating to test page...\n');
    await runtime.execute(testProfile, {
      type: 'navigate',
      url: 'https://example.com'
    });
    console.log('✅ Navigation complete!\n');
    
    console.log('3️⃣  Getting current tab state...\n');
    const result = await runtime.execute(testProfile, {
      type: 'listTabs'
    });
    
    if (result.ok && result.data) {
      console.log(`   Current tabs: ${result.data.tabs.length}`);
      result.data.tabs.forEach((tab, i) => {
        console.log(`   Tab ${i}: ${tab.title} - ${tab.url}`);
      });
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('📋 MANUAL VERIFICATION REQUIRED');
    console.log('='.repeat(70));
    console.log('\nPlease test these keyboard shortcuts in the Firefox window:\n');
    
    console.log('Essential shortcuts to test:');
    console.log('  ✓ Ctrl+T       - Open new tab');
    console.log('  ✓ Ctrl+W       - Close current tab');
    console.log('  ✓ Ctrl+L       - Focus address bar');
    console.log('  ✓ Ctrl+F       - Find dialog');
    console.log('  ✓ Ctrl+Tab     - Switch tabs');
    console.log('  ✓ F5 / Ctrl+R - Refresh page\n');
    
    console.log('The browser will stay open for 60 seconds...');
    console.log('Press Ctrl+C to exit early\n');
    console.log('='.repeat(70) + '\n');
    
    // Wait for manual testing
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    console.log('\n4️⃣  Getting final tab state...\n');
    const finalResult = await runtime.execute(testProfile, {
      type: 'listTabs'
    });
    
    if (finalResult.ok && finalResult.data) {
      console.log(`   Final tab count: ${finalResult.data.tabs.length}`);
      console.log('\n   If you created/closed tabs, this number should reflect that.');
    }
    
    console.log('\n✅ Test complete!\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    console.log('🧹 Cleaning up...');
    await runtime.stop(testProfile.id);
    await runtime.stopAll();
    
    try {
      await rm(testDataDir, { recursive: true, force: true });
      console.log('🧹 Cleaned up test data\n');
    } catch (e) {
      console.warn('⚠️  Could not clean up:', e.message);
    }
  }
  
  console.log('=' .repeat(70));
  console.log('Did Firefox keyboard shortcuts work?');
  console.log('If YES: Fix is successful! ✅');
  console.log('If NO:  Additional investigation needed ❌');
  console.log('=' .repeat(70) + '\n');
}

process.on('SIGINT', () => {
  console.log('\n\n⚠️  Interrupted by user');
  process.exit(0);
});

testWithPlaywrightRuntime().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
