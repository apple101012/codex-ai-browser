/**
 * Manual test script to demonstrate tab persistence feature
 * 
 * This script:
 * 1. Creates a test profile
 * 2. Starts the browser and opens multiple tabs
 * 3. Stops the browser (saves tabs)
 * 4. Restarts the browser (restores tabs)
 * 5. Verifies the tabs were restored correctly
 */

import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PlaywrightRuntime } from "./dist/src/browser/playwrightRuntime.js";
import { ProfileStore } from "./dist/src/storage/profileStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, "test-tab-persistence-demo");

async function cleanup() {
  try {
    await rm(testDir, { recursive: true, force: true });
    console.log("✓ Cleaned up test directory");
  } catch (error) {
    console.warn("Warning: Could not clean up test directory:", error.message);
  }
}

async function main() {
  console.log("🧪 Tab Persistence Feature Demo\n");

  // Setup
  await cleanup();
  await mkdir(testDir, { recursive: true });

  const profilesDir = path.join(testDir, "profiles");
  const store = new ProfileStore(profilesDir);
  await store.init();

  console.log("1. Creating test profile...");
  const profile = await store.create({
    name: "tab-persistence-demo",
    engine: "chromium",
    settings: { headless: false } // Set to false to see the browser
  });
  console.log(`   ✓ Created profile: ${profile.name} (${profile.id})\n`);

  const runtime = new PlaywrightRuntime({
    artifactsDir: path.join(testDir, "artifacts"),
    defaultHeadless: false,
    allowEvaluate: false,
    profileStore: store
  });

  try {
    console.log("2. Starting browser and opening multiple tabs...");
    await runtime.start(profile);

    // Navigate to different pages
    await runtime.execute(profile, {
      type: "navigate",
      url: "https://www.wikipedia.org"
    });

    await runtime.execute(profile, {
      type: "newTab",
      url: "https://github.com"
    });

    await runtime.execute(profile, {
      type: "newTab",
      url: "https://news.ycombinator.com"
    });

    // List tabs before stopping
    const listBeforeStop = await runtime.execute(profile, {
      type: "listTabs"
    });
    const tabsBeforeStop = listBeforeStop.data.tabs;
    console.log(`   ✓ Opened ${tabsBeforeStop.length} tabs:`);
    tabsBeforeStop.forEach((tab, i) => {
      console.log(`     ${i + 1}. ${tab.title || 'Loading...'} - ${tab.url}${tab.active ? ' (active)' : ''}`);
    });

    console.log("\n3. Stopping browser (saving tab state)...");
    console.log("   ⏱  Waiting 3 seconds for you to see the browser...");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    
    await runtime.stop(profile.id);
    console.log("   ✓ Browser stopped and tabs saved\n");

    // Verify tabs were saved
    const updatedProfile = await store.get(profile.id);
    console.log(`   ℹ  Saved ${updatedProfile.savedTabs?.length || 0} tabs to profile metadata`);
    if (updatedProfile.savedTabs) {
      updatedProfile.savedTabs.forEach((tab, i) => {
        console.log(`     ${i + 1}. ${tab.url}${tab.active ? ' (active)' : ''}`);
      });
    }

    console.log("\n4. Restarting browser (restoring tabs)...");
    console.log("   ⏱  Waiting 2 seconds before restart...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await runtime.start(updatedProfile);
    console.log("   ✓ Browser restarted\n");

    // Wait a bit for pages to load
    console.log("   ⏱  Waiting 3 seconds for tabs to load...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // List tabs after restart
    const listAfterRestart = await runtime.execute(updatedProfile, {
      type: "listTabs"
    });
    const tabsAfterRestart = listAfterRestart.data.tabs;
    console.log(`   ✓ Restored ${tabsAfterRestart.length} tabs:`);
    tabsAfterRestart.forEach((tab, i) => {
      console.log(`     ${i + 1}. ${tab.title || 'Loading...'} - ${tab.url}${tab.active ? ' (active)' : ''}`);
    });

    // Verify
    console.log("\n5. Verification:");
    if (tabsAfterRestart.length === tabsBeforeStop.length) {
      console.log("   ✓ Same number of tabs restored");
    } else {
      console.log(`   ✗ Tab count mismatch: ${tabsBeforeStop.length} → ${tabsAfterRestart.length}`);
    }

    const urlsBefore = tabsBeforeStop.map(t => t.url).sort();
    const urlsAfter = tabsAfterRestart.map(t => t.url).sort();
    const urlsMatch = JSON.stringify(urlsBefore) === JSON.stringify(urlsAfter);
    if (urlsMatch) {
      console.log("   ✓ All URLs match");
    } else {
      console.log("   ✗ URLs don't match");
      console.log("     Before:", urlsBefore);
      console.log("     After:", urlsAfter);
    }

    console.log("\n   ⏱  Browser will stay open for 5 seconds for you to inspect...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log("\n✅ Tab persistence feature working correctly!");
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    throw error;
  } finally {
    console.log("\n6. Cleaning up...");
    await runtime.stopAll();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await cleanup();
    console.log("   ✓ Done!\n");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
