/**
 * Enhanced test script for multiple browser instances
 * Tests Chrome, Edge, and Firefox with multiple simultaneous instances
 * Includes detailed error checking and browser process verification
 */

const API_BASE = 'http://localhost:4321';

// Utility functions
async function apiCall(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(`${API_BASE}${path}`, options);
    const text = await response.text();
    
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { text, status: response.status };
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
    }
    
    return data;
  } catch (error) {
    console.error(`API call failed: ${method} ${path}`);
    console.error(`Error: ${error.message}`);
    throw error;
  }
}

async function createProfile(name, engine) {
  console.log(`Creating profile: ${name} (${engine})`);
  const result = await apiCall('POST', '/profiles', {
    name,
    engine,
    settings: {
      headless: false
    }
  });
  return result.profile; // Extract profile from response
}

async function startProfile(profileId) {
  console.log(`Starting profile: ${profileId}`);
  const result = await apiCall('POST', `/profiles/${profileId}/start`);
  return result;
}

async function runCommands(profileId, commands) {
  console.log(`Running commands on profile: ${profileId}`);
  const result = await apiCall('POST', `/profiles/${profileId}/commands`, { commands });
  return result;
}

async function stopProfile(profileId) {
  console.log(`Stopping profile: ${profileId}`);
  const result = await apiCall('POST', `/profiles/${profileId}/stop`);
  return result;
}

async function listProfiles() {
  return await apiCall('GET', '/profiles');
}

async function deleteProfile(profileId) {
  console.log(`Deleting profile: ${profileId}`);
  return await apiCall('DELETE', `/profiles/${profileId}`);
}

// Test functions
async function testMultipleInstances(engine, count) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Testing ${count} simultaneous ${engine.toUpperCase()} instances`);
  console.log('='.repeat(70));
  
  const profiles = [];
  const results = {
    engine,
    count,
    profilesCreated: [],
    profilesStarted: [],
    commandsSuccessful: [],
    errors: [],
    startTimes: [],
    detailedErrors: []
  };
  
  try {
    // Step 1: Create profiles
    console.log(`\n[Step 1] Creating ${count} ${engine} profiles...`);
    for (let i = 1; i <= count; i++) {
      const name = `test-${engine}-${i}-${Date.now()}`;
      try {
        const profile = await createProfile(name, engine);
        profiles.push(profile);
        results.profilesCreated.push({ id: profile.id, name: profile.name });
        console.log(`✓ Created: ${profile.name} (ID: ${profile.id})`);
      } catch (error) {
        const err = `Failed to create ${name}: ${error.message}`;
        console.error(`✗ ${err}`);
        results.errors.push(err);
        results.detailedErrors.push({
          step: 'create',
          profile: name,
          error: error.message,
          stack: error.stack
        });
      }
    }
    
    if (profiles.length === 0) {
      throw new Error('No profiles were created successfully');
    }
    
    // Step 2: Start all profiles simultaneously
    console.log(`\n[Step 2] Starting all ${engine} profiles simultaneously...`);
    console.log('This is the critical test - can multiple instances launch at once?');
    
    const startPromises = profiles.map(async (profile, index) => {
      try {
        const startTime = Date.now();
        console.log(`[${index + 1}/${profiles.length}] Launching ${profile.name}...`);
        const startResult = await startProfile(profile.id);
        const elapsed = Date.now() - startTime;
        results.profilesStarted.push({ id: profile.id, name: profile.name });
        results.startTimes.push(elapsed);
        console.log(`✓ Started: ${profile.name} (took ${elapsed}ms)`);
        return { success: true, profile: profile.id, elapsed, result: startResult };
      } catch (error) {
        const err = `Failed to start ${profile.name}: ${error.message}`;
        console.error(`✗ ${err}`);
        results.errors.push(err);
        results.detailedErrors.push({
          step: 'start',
          profile: profile.name,
          error: error.message,
          stack: error.stack
        });
        return { success: false, profile: profile.id, error: error.message };
      }
    });
    
    const startResults = await Promise.allSettled(startPromises);
    const successfulStarts = startResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
    console.log(`\nStart results: ${successfulStarts}/${count} succeeded`);
    
    if (successfulStarts === 0) {
      throw new Error('All browser start attempts failed');
    }
    
    // Step 3: Wait for browsers to fully initialize
    console.log('\n[Step 3] Waiting 5 seconds for browsers to fully initialize...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Step 4: Verify profiles are actually running
    console.log(`\n[Step 4] Verifying ${engine} profiles are running...`);
    const allProfiles = await listProfiles();
    const runningProfiles = allProfiles.profiles.filter(p => 
      profiles.some(profile => profile.id === p.id) && allProfiles.runningProfileIds.includes(p.id)
    );
    console.log(`Running profiles: ${runningProfiles.length}/${profiles.length}`);
    
    if (runningProfiles.length === 0) {
      console.error('⚠️  WARNING: No profiles are showing as running!');
      results.errors.push('No profiles running after start commands');
    }
    
    for (const rp of runningProfiles) {
      console.log(`  ✓ ${rp.name} (${rp.id})`);
    }
    
    // Step 5: Test basic commands on each running instance
    console.log(`\n[Step 5] Testing basic commands on each ${engine} instance...`);
    const commandPromises = profiles.map(async (profile) => {
      try {
        const commands = [
          { type: 'navigate', url: 'https://example.com' },
          { type: 'listTabs' }
        ];
        const result = await runCommands(profile.id, commands);
        results.commandsSuccessful.push({ id: profile.id, name: profile.name });
        console.log(`✓ Commands successful on: ${profile.name}`);
        console.log(`  Navigate result: ${result.results?.[0]?.success ? 'OK' : 'FAILED'}`);
        console.log(`  ListTabs result: ${result.results?.[1]?.success ? 'OK' : 'FAILED'}`);
        return { success: true, profile: profile.id, result };
      } catch (error) {
        const err = `Commands failed on ${profile.name}: ${error.message}`;
        console.error(`✗ ${err}`);
        results.errors.push(err);
        results.detailedErrors.push({
          step: 'commands',
          profile: profile.name,
          error: error.message,
          stack: error.stack
        });
        return { success: false, profile: profile.id, error: error.message };
      }
    });
    
    const commandResults = await Promise.allSettled(commandPromises);
    const successfulCommands = commandResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
    console.log(`\nCommand results: ${successfulCommands}/${profiles.length} succeeded`);
    
    // Step 6: Final status check
    console.log(`\n[Step 6] Final status check...`);
    const finalStatus = await listProfiles();
    const stillRunning = finalStatus.profiles.filter(p => 
      profiles.some(profile => profile.id === p.id) && finalStatus.runningProfileIds.includes(p.id)
    );
    console.log(`Still running: ${stillRunning.length}/${profiles.length}`);
    
    // Wait before cleanup
    console.log('\n[Step 7] Waiting 3 seconds before cleanup...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 8: Stop all profiles
    console.log(`\n[Step 8] Stopping all ${engine} profiles...`);
    for (const profile of profiles) {
      try {
        await stopProfile(profile.id);
        console.log(`✓ Stopped: ${profile.name}`);
      } catch (error) {
        console.error(`✗ Failed to stop ${profile.name}: ${error.message}`);
      }
    }
    
    // Step 9: Delete test profiles
    console.log(`\n[Step 9] Cleaning up ${engine} test profiles...`);
    for (const profile of profiles) {
      try {
        await deleteProfile(profile.id);
        console.log(`✓ Deleted: ${profile.name}`);
      } catch (error) {
        console.error(`✗ Failed to delete ${profile.name}: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error(`\n✗ Test failed with error: ${error.message}`);
    console.error(error.stack);
    results.errors.push(error.message);
    results.detailedErrors.push({
      step: 'overall',
      error: error.message,
      stack: error.stack
    });
  }
  
  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${engine.toUpperCase()} Test Summary`);
  console.log('='.repeat(70));
  console.log(`Profiles Created: ${results.profilesCreated.length}/${count}`);
  console.log(`Profiles Started: ${results.profilesStarted.length}/${count}`);
  console.log(`Commands Successful: ${results.commandsSuccessful.length}/${count}`);
  console.log(`Errors: ${results.errors.length}`);
  
  if (results.startTimes.length > 0) {
    const avgStartTime = results.startTimes.reduce((a, b) => a + b, 0) / results.startTimes.length;
    const maxStartTime = Math.max(...results.startTimes);
    const minStartTime = Math.min(...results.startTimes);
    console.log(`\nStart Times: avg=${avgStartTime.toFixed(0)}ms, min=${minStartTime}ms, max=${maxStartTime}ms`);
  }
  
  if (results.detailedErrors.length > 0) {
    console.log('\n⚠️  Detailed Error Information:');
    results.detailedErrors.forEach((err, i) => {
      console.log(`\n  Error ${i + 1} [${err.step}]:`);
      console.log(`  Profile: ${err.profile || 'N/A'}`);
      console.log(`  Message: ${err.error}`);
      if (err.stack) {
        console.log(`  Stack: ${err.stack.substring(0, 200)}...`);
      }
    });
  }
  
  return results;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  Multiple Browser Instances Test - Enhanced Version               ║');
  console.log('║  Testing Chrome, Edge, and Firefox                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  
  const testResults = {
    chrome: null,
    msedge: null,
    firefox: null
  };
  
  try {
    // Clean up any existing test profiles first
    console.log('\n[Cleanup] Removing any existing test profiles...');
    const existing = await listProfiles();
    for (const profile of existing.profiles) {
      if (profile.name.startsWith('test-')) {
        try {
          if (existing.runningProfileIds.includes(profile.id)) {
            await stopProfile(profile.id);
          }
          await deleteProfile(profile.id);
          console.log(`Cleaned up: ${profile.name}`);
        } catch (error) {
          console.error(`Failed to cleanup ${profile.name}: ${error.message}`);
        }
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test Chrome (3 instances)
    testResults.chrome = await testMultipleInstances('chrome', 3);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test Edge (3 instances)
    testResults.msedge = await testMultipleInstances('msedge', 3);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test Firefox (3 instances)
    testResults.firefox = await testMultipleInstances('firefox', 3);
    
  } catch (error) {
    console.error(`\n✗ Test suite failed: ${error.message}`);
    console.error(error.stack);
  }
  
  // Final Report
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  FINAL TEST REPORT                                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  
  for (const [engine, result] of Object.entries(testResults)) {
    if (!result) {
      console.log(`\n${engine.toUpperCase()}: ⚠️  NO TEST DATA`);
      continue;
    }
    
    const allSuccess = result.profilesCreated.length === result.count && 
                       result.profilesStarted.length === result.count && 
                       result.commandsSuccessful.length === result.count;
    const partialSuccess = result.profilesStarted.length > 0;
    const status = allSuccess ? '✓ PASS' : (partialSuccess ? '⚠️  PARTIAL' : '✗ FAIL');
    
    console.log(`\n${engine.toUpperCase()}: ${status}`);
    console.log(`  Created:     ${result.profilesCreated.length}/${result.count}`);
    console.log(`  Started:     ${result.profilesStarted.length}/${result.count}`);
    console.log(`  Commands OK: ${result.commandsSuccessful.length}/${result.count}`);
    console.log(`  Errors:      ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log('\n  Recent errors:');
      result.errors.slice(-3).forEach(err => {
        console.log(`    - ${err.substring(0, 100)}${err.length > 100 ? '...' : ''}`);
      });
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('Test completed!');
  console.log('='.repeat(70));
  
  // Conclusion
  console.log('\n📊 CONCLUSIONS:');
  for (const [engine, result] of Object.entries(testResults)) {
    if (!result) continue;
    
    if (result.profilesStarted.length === result.count) {
      console.log(`✓ ${engine.toUpperCase()}: Can run ${result.count} simultaneous instances`);
    } else if (result.profilesStarted.length > 0) {
      console.log(`⚠️  ${engine.toUpperCase()}: Partial success (${result.profilesStarted.length}/${result.count} instances)`);
    } else {
      console.log(`✗ ${engine.toUpperCase()}: Cannot run multiple instances simultaneously`);
    }
  }
}

// Run the tests
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
