/**
 * Final comprehensive test with proper wait times
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

async function testComplete(engine, count) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`COMPREHENSIVE TEST: ${count} ${engine.toUpperCase()} instances`);
  console.log('='.repeat(70));
  
  // Create profiles
  console.log('\n[1] Creating profiles...');
  const profiles = [];
  for (let i = 1; i <= count; i++) {
    const name = `final-test-${engine}-${i}-${Date.now()}`;
    const result = await apiCall('POST', '/profiles', {
      name,
      engine,
      settings: { headless: false }
    });
    profiles.push(result.profile);
    console.log(`  ✓ ${result.profile.name} (${result.profile.id})`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  // Start simultaneously
  console.log('\n[2] Starting profiles simultaneously...');
  const startTime = Date.now();
  const startPromises = profiles.map((profile, index) => {
    return apiCall('POST', `/profiles/${profile.id}/start`, {})
      .then(result => {
        const elapsed = Date.now() - startTime;
        console.log(`  [${index + 1}/${count}] ✓ ${profile.name} (${elapsed}ms)`);
        return { success: true, profileId: profile.id };
      })
      .catch(error => {
        console.error(`  [${index + 1}/${count}] ✗ ${profile.name}: ${error.message}`);
        return { success: false, profileId: profile.id, error: error.message };
      });
  });
  
  const results = await Promise.all(startPromises);
  const successful = results.filter(r => r.success).length;
  const totalElapsed = Date.now() - startTime;
  console.log(`\n  Start requests: ${successful}/${count} succeeded (total time: ${totalElapsed}ms)`);
  
  // Wait for browsers to fully initialize
  console.log('\n[3] Waiting 8 seconds for browsers to fully initialize...');
  await new Promise(resolve => setTimeout(resolve, 8000));
  
  // Check which are running
  console.log('\n[4] Verifying running status...');
  const status = await apiCall('GET', '/profiles');
  const running = status.runningProfileIds.filter(id => 
    profiles.some(p => p.id === id)
  );
  
  console.log(`  Running profiles: ${running.length}/${count}`);
  for (const profile of profiles) {
    const isRunning = running.includes(profile.id);
    console.log(`    ${isRunning ? '✓' : '✗'} ${profile.name}`);
  }
  
  // Test commands on each
  console.log('\n[5] Testing commands on each running instance...');
  let commandsSuccessful = 0;
  const commandResults = [];
  
  for (const profile of profiles) {
    if (running.includes(profile.id)) {
      try {
        console.log(`  Testing ${profile.name}...`);
        const cmdResult = await apiCall('POST', `/profiles/${profile.id}/commands`, {
          commands: [
            { type: 'navigate', url: 'https://example.com' },
            { type: 'listTabs' }
          ]
        });
        
        if (cmdResult.results) {
          const navSuccess = cmdResult.results[0]?.success;
          const tabsSuccess = cmdResult.results[1]?.success;
          
          if (navSuccess && tabsSuccess) {
            commandsSuccessful++;
            console.log(`    ✓ Navigate: OK, ListTabs: OK`);
            commandResults.push({ profile: profile.name, success: true });
          } else {
            console.log(`    ✗ Navigate: ${navSuccess ? 'OK' : 'FAIL'}, ListTabs: ${tabsSuccess ? 'OK' : 'FAIL'}`);
            if (!navSuccess) {
              console.log(`      Navigate error: ${cmdResult.results[0]?.error || 'Unknown'}`);
            }
            if (!tabsSuccess) {
              console.log(`      ListTabs error: ${cmdResult.results[1]?.error || 'Unknown'}`);
            }
            commandResults.push({ profile: profile.name, success: false, details: cmdResult.results });
          }
        } else {
          console.log(`    ✗ Unexpected response format`);
          console.log(`      Response: ${JSON.stringify(cmdResult).substring(0, 200)}`);
          commandResults.push({ profile: profile.name, success: false, error: 'Unexpected response' });
        }
      } catch (error) {
        console.log(`    ✗ Error: ${error.message}`);
        commandResults.push({ profile: profile.name, success: false, error: error.message });
      }
    }
  }
  
  console.log(`\n  Commands successful: ${commandsSuccessful}/${running.length}`);
  
  // Visual verification prompt
  console.log('\n[6] Visual verification...');
  console.log(`  You should see ${running.length} ${engine} browser windows open.`);
  console.log(`  Waiting 5 seconds for visual inspection...`);
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Cleanup
  console.log('\n[7] Cleaning up...');
  for (const id of running) {
    try {
      await apiCall('POST', `/profiles/${id}/stop`, {});
      console.log(`  ✓ Stopped ${id}`);
    } catch (error) {
      console.log(`  ✗ Failed to stop ${id}: ${error.message}`);
    }
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  for (const profile of profiles) {
    try {
      await apiCall('DELETE', `/profiles/${profile.id}`);
      console.log(`  ✓ Deleted ${profile.name}`);
    } catch (error) {
      console.log(`  ✗ Failed to delete ${profile.name}: ${error.message}`);
    }
  }
  
  // Summary
  const allSuccess = running.length === count && commandsSuccessful === count;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${engine.toUpperCase()} SUMMARY:`);
  console.log(`  Profiles created: ${profiles.length}/${count}`);
  console.log(`  Start requests succeeded: ${successful}/${count}`);
  console.log(`  Actually running: ${running.length}/${count}`);
  console.log(`  Commands working: ${commandsSuccessful}/${running.length}`);
  console.log(`  Overall: ${allSuccess ? '✓ PASS' : '✗ FAIL'}`);
  console.log('='.repeat(70));
  
  return {
    engine,
    count,
    created: profiles.length,
    startRequests: successful,
    actuallyRunning: running.length,
    commandsWorking: commandsSuccessful,
    success: allSuccess
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  FINAL COMPREHENSIVE MULTI-INSTANCE TEST                           ║');
  console.log('║  Chrome, Edge, and Firefox - 3 instances each                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  
  const results = [];
  
  // Chrome
  console.log('\n\n>>> TESTING CHROME <<<');
  results.push(await testComplete('chrome', 3));
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Edge
  console.log('\n\n>>> TESTING EDGE <<<');
  results.push(await testComplete('msedge', 3));
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Firefox
  console.log('\n\n>>> TESTING FIREFOX <<<');
  results.push(await testComplete('firefox', 3));
  
  // Final report
  console.log('\n\n\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  FINAL TEST RESULTS                                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  
  for (const result of results) {
    const status = result.success ? '✓ PASS' : '✗ FAIL';
    console.log(`${result.engine.toUpperCase()}: ${status}`);
    console.log(`  Created:          ${result.created}/${result.count}`);
    console.log(`  Started:          ${result.startRequests}/${result.count}`);
    console.log(`  Running:          ${result.actuallyRunning}/${result.count}`);
    console.log(`  Commands working: ${result.commandsWorking}/${result.actuallyRunning}`);
    console.log();
  }
  
  console.log('='.repeat(70));
  console.log('CONCLUSION:');
  console.log('='.repeat(70));
  
  const allPass = results.every(r => r.success);
  const allRunning = results.every(r => r.actuallyRunning === r.count);
  
  if (allPass) {
    console.log('✓ ALL TESTS PASSED');
    console.log('  Multiple instances work perfectly for Chrome, Edge, and Firefox');
  } else if (allRunning) {
    console.log('⚠️  PARTIAL SUCCESS');
    console.log('  Multiple instances start and run, but some command issues exist');
    console.log('  This may be due to timing/initialization issues');
  } else {
    console.log('✗ TESTS FAILED');
    console.log('  Multiple instances cannot run simultaneously');
    
    for (const result of results) {
      if (result.actuallyRunning < result.count) {
        console.log(`  ${result.engine}: Only ${result.actuallyRunning}/${result.count} running`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(70));
}

main().catch(error => {
  console.error('Fatal error:', error);
  console.error(error.stack);
  process.exit(1);
});
