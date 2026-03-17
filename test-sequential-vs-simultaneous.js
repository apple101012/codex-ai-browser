/**
 * Sequential vs Simultaneous Test
 * Tests if the issue is with concurrent starts or if multiple instances can exist
 */

const API_BASE = 'http://localhost:4321';

async function apiCall(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(`${API_BASE}${path}`, options);
  const text = await response.text();
  
  try {
    return JSON.parse(text);
  } catch {
    return { text, status: response.status };
  }
}

async function createProfile(name, engine) {
  const result = await apiCall('POST', '/profiles', {
    name,
    engine,
    settings: { headless: false }
  });
  return result.profile;
}

async function startProfile(profileId) {
  return await apiCall('POST', `/profiles/${profileId}/start`, {});
}

async function listProfiles() {
  return await apiCall('GET', '/profiles');
}

async function runCommands(profileId, commands) {
  return await apiCall('POST', `/profiles/${profileId}/commands`, { commands });
}

async function stopAll() {
  return await apiCall('POST', '/profiles/stop-all', {});
}

async function deleteProfile(profileId) {
  return await apiCall('DELETE', `/profiles/${profileId}`);
}

async function cleanup() {
  console.log('\n[Cleanup] Stopping all and removing test profiles...');
  await stopAll();
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const profiles = await listProfiles();
  for (const profile of profiles.profiles) {
    if (profile.name.startsWith('seq-test-')) {
      try {
        await deleteProfile(profile.id);
        console.log(`  Deleted: ${profile.name}`);
      } catch (error) {
        console.error(`  Failed to delete ${profile.name}`);
      }
    }
  }
}

async function testSequentialStart(engine, count) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEST 1: Sequential Start - ${count} ${engine.toUpperCase()} instances`);
  console.log('='.repeat(70));
  
  const profiles = [];
  
  // Create profiles
  console.log('\n[Step 1] Creating profiles...');
  for (let i = 1; i <= count; i++) {
    const name = `seq-test-${engine}-${i}-${Date.now()}`;
    const profile = await createProfile(name, engine);
    profiles.push(profile);
    console.log(`  Created: ${profile.name} (${profile.id})`);
  }
  
  // Start profiles sequentially
  console.log('\n[Step 2] Starting profiles SEQUENTIALLY (one after another)...');
  for (const profile of profiles) {
    console.log(`  Starting: ${profile.name}...`);
    try {
      await startProfile(profile.id);
      console.log(`    ✓ Started`);
      
      // Check how many are running after each start
      const status = await listProfiles();
      console.log(`    Running count: ${status.runningProfileIds.length}`);
      
      // Small delay between starts
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`    ✗ Failed: ${error.message}`);
    }
  }
  
  // Final check
  console.log('\n[Step 3] Final status check...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  const finalStatus = await listProfiles();
  const runningCount = finalStatus.runningProfileIds.length;
  console.log(`  Running profiles: ${runningCount}/${count}`);
  
  if (runningCount === count) {
    console.log(`  ✓ SUCCESS: All ${count} ${engine} instances are running simultaneously!`);
  } else if (runningCount > 0) {
    console.log(`  ⚠️  PARTIAL: Only ${runningCount}/${count} instances are running`);
  } else {
    console.log(`  ✗ FAIL: No instances are running`);
  }
  
  // Test commands on running instances
  console.log('\n[Step 4] Testing commands on running instances...');
  let commandsSuccessful = 0;
  for (const profile of profiles) {
    if (finalStatus.runningProfileIds.includes(profile.id)) {
      try {
        const result = await runCommands(profile.id, [
          { type: 'navigate', url: 'https://example.com' },
          { type: 'listTabs' }
        ]);
        if (result.results && result.results[0]?.success) {
          commandsSuccessful++;
          console.log(`  ✓ Commands work on: ${profile.name}`);
        }
      } catch (error) {
        console.log(`  ✗ Commands failed on: ${profile.name}`);
      }
    }
  }
  
  console.log(`\n  Commands successful: ${commandsSuccessful}/${runningCount}`);
  
  return {
    method: 'sequential',
    engine,
    created: profiles.length,
    running: runningCount,
    commandsWorking: commandsSuccessful,
    success: runningCount === count && commandsSuccessful === count
  };
}

async function testSimultaneousStart(engine, count) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEST 2: Simultaneous Start - ${count} ${engine.toUpperCase()} instances`);
  console.log('='.repeat(70));
  
  const profiles = [];
  
  // Create profiles
  console.log('\n[Step 1] Creating profiles...');
  for (let i = 1; i <= count; i++) {
    const name = `seq-test-${engine}-sim-${i}-${Date.now()}`;
    const profile = await createProfile(name, engine);
    profiles.push(profile);
    console.log(`  Created: ${profile.name} (${profile.id})`);
    await new Promise(resolve => setTimeout(resolve, 10)); // Ensure unique names
  }
  
  // Start profiles simultaneously
  console.log('\n[Step 2] Starting profiles SIMULTANEOUSLY (all at once)...');
  const startPromises = profiles.map(async (profile, index) => {
    console.log(`  [${index + 1}/${count}] Launching: ${profile.name}...`);
    try {
      const startTime = Date.now();
      await startProfile(profile.id);
      const elapsed = Date.now() - startTime;
      console.log(`    ✓ Started in ${elapsed}ms`);
      return { success: true, profile: profile.id };
    } catch (error) {
      console.error(`    ✗ Failed: ${error.message}`);
      return { success: false, profile: profile.id, error: error.message };
    }
  });
  
  const startResults = await Promise.all(startPromises);
  const successfulStarts = startResults.filter(r => r.success).length;
  console.log(`\n  Start results: ${successfulStarts}/${count} succeeded`);
  
  // Check status
  console.log('\n[Step 3] Checking status after simultaneous start...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  const finalStatus = await listProfiles();
  const runningCount = finalStatus.runningProfileIds.length;
  console.log(`  Running profiles: ${runningCount}/${count}`);
  
  if (runningCount === count) {
    console.log(`  ✓ SUCCESS: All ${count} ${engine} instances are running simultaneously!`);
  } else if (runningCount > 0) {
    console.log(`  ⚠️  PARTIAL: Only ${runningCount}/${count} instances are running`);
    console.log(`  Running IDs: ${finalStatus.runningProfileIds.join(', ')}`);
  } else {
    console.log(`  ✗ FAIL: No instances are running`);
  }
  
  // Test commands
  console.log('\n[Step 4] Testing commands on running instances...');
  let commandsSuccessful = 0;
  for (const profile of profiles) {
    if (finalStatus.runningProfileIds.includes(profile.id)) {
      try {
        const result = await runCommands(profile.id, [
          { type: 'listTabs' }
        ]);
        if (result.results && result.results[0]?.success) {
          commandsSuccessful++;
          console.log(`  ✓ Commands work on: ${profile.name}`);
        }
      } catch (error) {
        console.log(`  ✗ Commands failed on: ${profile.name}`);
      }
    }
  }
  
  console.log(`\n  Commands successful: ${commandsSuccessful}/${runningCount}`);
  
  return {
    method: 'simultaneous',
    engine,
    created: profiles.length,
    startRequests: successfulStarts,
    running: runningCount,
    commandsWorking: commandsSuccessful,
    success: runningCount === count && commandsSuccessful === count
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  Sequential vs Simultaneous Browser Instance Test                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  
  await cleanup();
  
  const results = [];
  
  // Test Chrome - Sequential
  const chromeSeq = await testSequentialStart('chrome', 3);
  results.push(chromeSeq);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await cleanup();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test Chrome - Simultaneous
  const chromeSim = await testSimultaneousStart('chrome', 3);
  results.push(chromeSim);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await cleanup();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test Edge - Sequential
  const edgeSeq = await testSequentialStart('msedge', 3);
  results.push(edgeSeq);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await cleanup();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test Edge - Simultaneous
  const edgeSim = await testSimultaneousStart('msedge', 3);
  results.push(edgeSim);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await cleanup();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test Firefox - Sequential
  const firefoxSeq = await testSequentialStart('firefox', 3);
  results.push(firefoxSeq);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await cleanup();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test Firefox - Simultaneous
  const firefoxSim = await testSimultaneousStart('firefox', 3);
  results.push(firefoxSim);
  
  // Final cleanup
  await cleanup();
  
  // Final Report
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  FINAL COMPARISON REPORT                                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  
  console.log('\nCHROME:');
  const chromeSeqResult = results.find(r => r.engine === 'chrome' && r.method === 'sequential');
  const chromeSimResult = results.find(r => r.engine === 'chrome' && r.method === 'simultaneous');
  console.log(`  Sequential:   ${chromeSeqResult?.running}/3 running, ${chromeSeqResult?.success ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Simultaneous: ${chromeSimResult?.running}/3 running, ${chromeSimResult?.success ? '✓ PASS' : '✗ FAIL'}`);
  
  console.log('\nEDGE:');
  const edgeSeqResult = results.find(r => r.engine === 'msedge' && r.method === 'sequential');
  const edgeSimResult = results.find(r => r.engine === 'msedge' && r.method === 'simultaneous');
  console.log(`  Sequential:   ${edgeSeqResult?.running}/3 running, ${edgeSeqResult?.success ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Simultaneous: ${edgeSimResult?.running}/3 running, ${edgeSimResult?.success ? '✓ PASS' : '✗ FAIL'}`);
  
  console.log('\nFIREFOX:');
  const firefoxSeqResult = results.find(r => r.engine === 'firefox' && r.method === 'sequential');
  const firefoxSimResult = results.find(r => r.engine === 'firefox' && r.method === 'simultaneous');
  console.log(`  Sequential:   ${firefoxSeqResult?.running}/3 running, ${firefoxSeqResult?.success ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Simultaneous: ${firefoxSimResult?.running}/3 running, ${firefoxSimResult?.success ? '✓ PASS' : '✗ FAIL'}`);
  
  console.log('\n' + '='.repeat(70));
  console.log('KEY FINDINGS:');
  console.log('='.repeat(70));
  
  const allSequentialSuccess = results.filter(r => r.method === 'sequential').every(r => r.success);
  const allSimultaneousSuccess = results.filter(r => r.method === 'simultaneous').every(r => r.success);
  
  if (allSequentialSuccess && allSimultaneousSuccess) {
    console.log('✓ Multiple instances work both sequentially AND simultaneously for all browsers');
  } else if (allSequentialSuccess && !allSimultaneousSuccess) {
    console.log('⚠️  Multiple instances work ONLY when started sequentially');
    console.log('   Issue: Simultaneous starts fail or cause conflicts');
    console.log('   Recommendation: Add locking/queueing mechanism for concurrent starts');
  } else if (!allSequentialSuccess) {
    console.log('✗ Multiple instances DO NOT work even when started sequentially');
    console.log('   Issue: Browser limitation or resource conflict');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
