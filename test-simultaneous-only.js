/**
 * Focused test: Simultaneous starts only
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

async function testSimultaneousStart(engine, count) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Testing simultaneous start: ${count} ${engine.toUpperCase()} instances`);
  console.log('='.repeat(70));
  
  // Create profiles
  console.log('\n[1] Creating profiles...');
  const profiles = [];
  for (let i = 1; i <= count; i++) {
    const name = `test-${engine}-${i}-${Date.now()}`;
    const result = await apiCall('POST', '/profiles', {
      name,
      engine,
      settings: { headless: false }
    });
    profiles.push(result.profile);
    console.log(`  ✓ Created: ${result.profile.name}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  // Start simultaneously
  console.log('\n[2] Starting ALL at once (simultaneous)...');
  const startTime = Date.now();
  const startPromises = profiles.map((profile, index) => {
    return apiCall('POST', `/profiles/${profile.id}/start`, {})
      .then(result => {
        console.log(`  [${index + 1}] ✓ Start request succeeded for ${profile.name}`);
        return { success: true, profile: profile.id };
      })
      .catch(error => {
        console.error(`  [${index + 1}] ✗ Start request failed for ${profile.name}: ${error.message}`);
        return { success: false, profile: profile.id, error: error.message };
      });
  });
  
  const results = await Promise.all(startPromises);
  const elapsed = Date.now() - startTime;
  const successful = results.filter(r => r.success).length;
  console.log(`\n  Results: ${successful}/${count} start requests succeeded (took ${elapsed}ms)`);
  
  // Check status
  console.log('\n[3] Checking which are actually running...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const status = await apiCall('GET', '/profiles');
  const running = status.runningProfileIds.filter(id => 
    profiles.some(p => p.id === id)
  );
  
  console.log(`  Running: ${running.length}/${count}`);
  
  for (const profile of profiles) {
    const isRunning = running.includes(profile.id);
    console.log(`    ${isRunning ? '✓' : '✗'} ${profile.name}`);
  }
  
  // Test commands
  console.log('\n[4] Testing commands...');
  let commandsWork = 0;
  for (const profile of profiles) {
    if (running.includes(profile.id)) {
      try {
        const result = await apiCall('POST', `/profiles/${profile.id}/commands`, {
          commands: [{ type: 'listTabs' }]
        });
        if (result.results?.[0]?.success) {
          commandsWork++;
          console.log(`  ✓ Commands work on ${profile.name}`);
        } else {
          console.log(`  ✗ Commands failed on ${profile.name}`);
        }
      } catch (error) {
        console.log(`  ✗ Commands error on ${profile.name}: ${error.message}`);
      }
    }
  }
  
  // Cleanup
  console.log('\n[5] Cleanup...');
  for (const id of running) {
    await apiCall('POST', `/profiles/${id}/stop`, {});
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  for (const profile of profiles) {
    await apiCall('DELETE', `/profiles/${profile.id}`);
  }
  
  return {
    engine,
    count,
    startRequests: successful,
    actuallyRunning: running.length,
    commandsWorking: commandsWork,
    success: running.length === count && commandsWork === count
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  Simultaneous Start Test for Multiple Browser Instances           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  
  const results = [];
  
  // Chrome
  results.push(await testSimultaneousStart('chrome', 3));
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Edge
  results.push(await testSimultaneousStart('msedge', 3));
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Firefox
  results.push(await testSimultaneousStart('firefox', 3));
  
  // Report
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  FINAL REPORT                                                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  
  for (const result of results) {
    console.log(`\n${result.engine.toUpperCase()}:`);
    console.log(`  Start requests: ${result.startRequests}/${result.count}`);
    console.log(`  Actually running: ${result.actuallyRunning}/${result.count}`);
    console.log(`  Commands working: ${result.commandsWorking}/${result.count}`);
    console.log(`  Result: ${result.success ? '✓ PASS' : '✗ FAIL'}`);
  }
  
  console.log('\n' + '='.repeat(70));
  
  const allPass = results.every(r => r.success);
  if (allPass) {
    console.log('✓ All browsers support simultaneous multiple instances');
  } else {
    console.log('⚠️  Some browsers have issues with simultaneous starts');
    
    const partialSuccess = results.filter(r => r.actuallyRunning > 0 && r.actuallyRunning < r.count);
    if (partialSuccess.length > 0) {
      console.log('\nNote: Some instances start but not all - possible race condition');
    }
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
