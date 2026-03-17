/**
 * Test script for multiple browser instances
 * Tests Chrome, Edge, and Firefox with multiple simultaneous instances
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
  
  const response = await fetch(`${API_BASE}${path}`, options);
  const text = await response.text();
  
  try {
    return JSON.parse(text);
  } catch {
    return { text, status: response.status };
  }
}

async function createProfile(name, engine) {
  console.log(`Creating profile: ${name} (${engine})`);
  return await apiCall('POST', '/profiles', {
    name,
    engine,
    settings: {
      headless: false
    }
  });
}

async function startProfile(profileId) {
  console.log(`Starting profile: ${profileId}`);
  return await apiCall('POST', `/profiles/${profileId}/start`);
}

async function runCommands(profileId, commands) {
  console.log(`Running commands on profile: ${profileId}`);
  return await apiCall('POST', `/profiles/${profileId}/commands`, { commands });
}

async function stopProfile(profileId) {
  console.log(`Stopping profile: ${profileId}`);
  return await apiCall('POST', `/profiles/${profileId}/stop`);
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
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${count} simultaneous ${engine.toUpperCase()} instances`);
  console.log('='.repeat(60));
  
  const profiles = [];
  const results = {
    engine,
    count,
    profilesCreated: [],
    profilesStarted: [],
    commandsSuccessful: [],
    errors: []
  };
  
  try {
    // Step 1: Create profiles
    console.log(`\n[Step 1] Creating ${count} ${engine} profiles...`);
    for (let i = 1; i <= count; i++) {
      const name = `test-${engine}-${i}`;
      try {
        const profile = await createProfile(name, engine);
        profiles.push(profile);
        results.profilesCreated.push(profile.id);
        console.log(`✓ Created: ${name} (ID: ${profile.id})`);
      } catch (error) {
        const err = `Failed to create ${name}: ${error.message}`;
        console.error(`✗ ${err}`);
        results.errors.push(err);
      }
    }
    
    // Step 2: Start all profiles simultaneously
    console.log(`\n[Step 2] Starting all ${engine} profiles simultaneously...`);
    const startPromises = profiles.map(async (profile) => {
      try {
        const startTime = Date.now();
        await startProfile(profile.id);
        const elapsed = Date.now() - startTime;
        results.profilesStarted.push(profile.id);
        console.log(`✓ Started: ${profile.name} (took ${elapsed}ms)`);
        return { success: true, profile: profile.id, elapsed };
      } catch (error) {
        const err = `Failed to start ${profile.name}: ${error.message}`;
        console.error(`✗ ${err}`);
        results.errors.push(err);
        return { success: false, profile: profile.id, error: error.message };
      }
    });
    
    const startResults = await Promise.allSettled(startPromises);
    console.log(`\nStart results: ${startResults.filter(r => r.status === 'fulfilled' && r.value.success).length}/${count} succeeded`);
    
    // Wait a bit for browsers to fully initialize
    console.log('\n[Step 3] Waiting 3 seconds for browsers to initialize...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 4: Test basic commands on each running instance
    console.log(`\n[Step 4] Testing basic commands on each ${engine} instance...`);
    const commandPromises = profiles.map(async (profile) => {
      try {
        const commands = [
          { type: 'navigate', url: 'https://example.com' },
          { type: 'listTabs' }
        ];
        const result = await runCommands(profile.id, commands);
        results.commandsSuccessful.push(profile.id);
        console.log(`✓ Commands successful on: ${profile.name}`);
        return { success: true, profile: profile.id, result };
      } catch (error) {
        const err = `Commands failed on ${profile.name}: ${error.message}`;
        console.error(`✗ ${err}`);
        results.errors.push(err);
        return { success: false, profile: profile.id, error: error.message };
      }
    });
    
    const commandResults = await Promise.allSettled(commandPromises);
    console.log(`\nCommand results: ${commandResults.filter(r => r.status === 'fulfilled' && r.value.success).length}/${profiles.length} succeeded`);
    
    // Step 5: Check if all instances are still running
    console.log(`\n[Step 5] Checking if all ${engine} instances are still running...`);
    const allProfiles = await listProfiles();
    const runningProfiles = allProfiles.profiles.filter(p => p.running);
    console.log(`Running profiles: ${runningProfiles.length}/${profiles.length}`);
    
    // Wait before cleanup
    console.log('\n[Step 6] Waiting 2 seconds before cleanup...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 7: Stop all profiles
    console.log(`\n[Step 7] Stopping all ${engine} profiles...`);
    for (const profile of profiles) {
      try {
        await stopProfile(profile.id);
        console.log(`✓ Stopped: ${profile.name}`);
      } catch (error) {
        console.error(`✗ Failed to stop ${profile.name}: ${error.message}`);
      }
    }
    
    // Step 8: Delete test profiles
    console.log(`\n[Step 8] Cleaning up ${engine} test profiles...`);
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
    results.errors.push(error.message);
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${engine.toUpperCase()} Test Summary`);
  console.log('='.repeat(60));
  console.log(`Profiles Created: ${results.profilesCreated.length}/${count}`);
  console.log(`Profiles Started: ${results.profilesStarted.length}/${count}`);
  console.log(`Commands Successful: ${results.commandsSuccessful.length}/${count}`);
  console.log(`Errors: ${results.errors.length}`);
  
  if (results.errors.length > 0) {
    console.log('\nError Details:');
    results.errors.forEach((err, i) => {
      console.log(`  ${i + 1}. ${err}`);
    });
  }
  
  return results;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Multiple Browser Instances Test                          ║');
  console.log('║  Testing Chrome, Edge, and Firefox                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  const testResults = {
    chrome: null,
    msedge: null,
    firefox: null
  };
  
  try {
    // Test Chrome (3 instances)
    testResults.chrome = await testMultipleInstances('chrome', 3);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test Edge (3 instances)
    testResults.msedge = await testMultipleInstances('msedge', 3);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test Firefox (3 instances)
    testResults.firefox = await testMultipleInstances('firefox', 3);
    
  } catch (error) {
    console.error(`\n✗ Test suite failed: ${error.message}`);
    console.error(error.stack);
  }
  
  // Final Report
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  FINAL TEST REPORT                                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  for (const [engine, result] of Object.entries(testResults)) {
    if (!result) continue;
    
    const success = result.profilesStarted.length === result.count && 
                   result.commandsSuccessful.length === result.count;
    const status = success ? '✓ PASS' : '✗ FAIL';
    
    console.log(`\n${engine.toUpperCase()}: ${status}`);
    console.log(`  Created: ${result.profilesCreated.length}/${result.count}`);
    console.log(`  Started: ${result.profilesStarted.length}/${result.count}`);
    console.log(`  Commands OK: ${result.commandsSuccessful.length}/${result.count}`);
    console.log(`  Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log('  Error samples:');
      result.errors.slice(0, 3).forEach(err => {
        console.log(`    - ${err.substring(0, 80)}${err.length > 80 ? '...' : ''}`);
      });
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Test completed!');
  console.log('='.repeat(60));
}

// Run the tests
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
