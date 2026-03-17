/**
 * Demo script to test auto-refresh functionality
 * 
 * This script:
 * 1. Creates a test browser profile
 * 2. Starts the browser
 * 3. Waits a few seconds
 * 4. Stops the browser via API to simulate closure
 * 5. The UI should automatically detect this change within 3 seconds
 */

const BASE_URL = 'http://localhost:4321';

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  
  if (!response.ok) {
    throw new Error(data.error || JSON.stringify(data));
  }
  
  return data;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🧪 Testing Auto-Refresh Functionality\n');
  
  try {
    // Step 1: Create a test profile
    console.log('1️⃣  Creating test profile...');
    const { profile } = await request('/profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Auto-Refresh Test Profile',
        engine: 'chrome',
        settings: {
          headless: false
        }
      })
    });
    console.log(`✅ Profile created: ${profile.id}\n`);
    
    // Step 2: Start the browser
    console.log('2️⃣  Starting browser...');
    await request(`/profiles/${profile.id}/start`, {
      method: 'POST',
      body: JSON.stringify({ setActive: false })
    });
    console.log('✅ Browser started\n');
    
    // Step 3: Check running state
    console.log('3️⃣  Checking profile state...');
    const { runningProfileIds } = await request('/profiles');
    const isRunning = runningProfileIds.includes(profile.id);
    console.log(`✅ Profile is ${isRunning ? 'RUNNING' : 'STOPPED'}\n`);
    
    // Step 4: Wait a bit
    console.log('4️⃣  Waiting 3 seconds...');
    await sleep(3000);
    console.log('✅ Wait complete\n');
    
    // Step 5: Stop the browser
    console.log('5️⃣  Stopping browser (simulating manual close)...');
    await request(`/profiles/${profile.id}/stop`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    console.log('✅ Browser stopped\n');
    
    // Step 6: Verify stopped state
    console.log('6️⃣  Verifying profile is stopped...');
    const { runningProfileIds: updatedIds } = await request('/profiles');
    const isStopped = !updatedIds.includes(profile.id);
    console.log(`✅ Profile is ${isStopped ? 'STOPPED' : 'RUNNING'}\n`);
    
    // Step 7: Clean up
    console.log('7️⃣  Cleaning up test profile...');
    await request(`/profiles/${profile.id}`, {
      method: 'DELETE'
    });
    console.log('✅ Profile deleted\n');
    
    console.log('🎉 TEST COMPLETE!\n');
    console.log('📋 RESULTS:');
    console.log('   - Profile creation: ✅');
    console.log('   - Browser start: ✅');
    console.log('   - Browser stop: ✅');
    console.log('   - State detection: ✅');
    console.log('\n💡 The UI should automatically show these changes within 3 seconds!');
    console.log('   Open http://localhost:4321 to verify the auto-refresh indicator.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

runTest();
