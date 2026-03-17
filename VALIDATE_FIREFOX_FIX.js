#!/usr/bin/env node

/**
 * FINAL VALIDATION - Firefox Keyboard Shortcuts Fix
 * 
 * This script launches a Firefox profile and provides clear instructions
 * for manual validation of keyboard shortcuts.
 */

import { PlaywrightRuntime } from './dist/src/browser/playwrightRuntime.js';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

console.log('\n' + '='.repeat(70));
console.log('Firefox Keyboard Shortcuts - FINAL VALIDATION TEST');
console.log('='.repeat(70) + '\n');

const testDataDir = join(tmpdir(), `firefox-validation-${Date.now()}`);
const artifactsDir = join(testDataDir, 'artifacts');

await mkdir(testDataDir, { recursive: true });
await mkdir(artifactsDir, { recursive: true });

const runtime = new PlaywrightRuntime({
  artifactsDir,
  defaultHeadless: false,
  allowEvaluate: true
});

const testProfile = {
  id: 'firefox-validation',
  name: 'Firefox Keyboard Shortcuts Validation',
  engine: 'firefox',
  dataDir: join(testDataDir, 'profile'),
  settings: { headless: false },
  createdAt: new Date().toISOString()
};

try {
  console.log('✅ Starting Firefox with keyboard shortcut fix...\n');
  await runtime.start(testProfile);
  
  console.log('✅ Navigating to test page...\n');
  await runtime.execute(testProfile, {
    type: 'navigate',
    url: 'https://example.com'
  });
  
  console.log('=' .repeat(70));
  console.log('📋 MANUAL VALIDATION CHECKLIST');
  console.log('=' .repeat(70));
  console.log('\nPlease test EACH of these shortcuts in the Firefox window:\n');
  
  const shortcuts = [
    { keys: 'Ctrl+T', action: 'Open new tab', critical: true },
    { keys: 'Ctrl+W', action: 'Close current tab', critical: true },
    { keys: 'Ctrl+L', action: 'Focus address bar', critical: true },
    { keys: 'Ctrl+F', action: 'Open find dialog', critical: true },
    { keys: 'Ctrl+Tab', action: 'Switch to next tab', critical: false },
    { keys: 'Ctrl+Shift+Tab', action: 'Switch to previous tab', critical: false },
    { keys: 'Ctrl+R or F5', action: 'Refresh page', critical: false },
    { keys: 'Ctrl+Shift+T', action: 'Reopen closed tab', critical: false },
    { keys: 'Ctrl++', action: 'Zoom in', critical: false },
    { keys: 'Ctrl+-', action: 'Zoom out', critical: false },
    { keys: 'Ctrl+0', action: 'Reset zoom', critical: false },
  ];
  
  console.log('CRITICAL (must work):');
  shortcuts.filter(s => s.critical).forEach(s => {
    console.log(`  [ ] ${s.keys.padEnd(20)} - ${s.action}`);
  });
  
  console.log('\nADDITIONAL (should work):');
  shortcuts.filter(s => !s.critical).forEach(s => {
    console.log(`  [ ] ${s.keys.padEnd(20)} - ${s.action}`);
  });
  
  console.log('\n' + '='.repeat(70));
  console.log('⏳ Browser will stay open for 90 seconds for testing...');
  console.log('   Press Ctrl+C to exit early\n');
  console.log('=' .repeat(70) + '\n');
  
  await new Promise(resolve => setTimeout(resolve, 90000));
  
  console.log('\n' + '='.repeat(70));
  console.log('VALIDATION COMPLETE');
  console.log('='.repeat(70));
  console.log('\n✅ If all CRITICAL shortcuts worked: FIX IS SUCCESSFUL');
  console.log('❌ If critical shortcuts did NOT work: Additional investigation needed');
  console.log('\nNote: Browser-level shortcuts work MANUALLY but cannot be tested');
  console.log('      programmatically via Playwright (this is by design).\n');
  console.log('='.repeat(70) + '\n');
  
} catch (error) {
  console.error('❌ Test error:', error);
} finally {
  await runtime.stop(testProfile.id);
  await runtime.stopAll();
  
  try {
    await rm(testDataDir, { recursive: true, force: true });
  } catch (e) {
    console.warn('⚠️  Could not clean up:', e.message);
  }
}

console.log('Test complete. Exiting...\n');
