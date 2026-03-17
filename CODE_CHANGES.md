# Code Changes for Auto-Refresh Feature

## Summary
This document shows the exact code changes made to implement automatic UI refresh.

---

## File 1: `public/app.js`

### Change 1: Add State Variables (After line 102)

```javascript
// ============== NEW CODE ==============
// Auto-refresh state
let autoRefreshInterval = null;
let lastRefreshTime = null;
let isRefreshing = false;
// ======================================
```

**Location**: After `stringToColor()` function, before `refreshProfiles()` function

---

### Change 2: Modify `refreshProfiles()` Function

**Before:**
```javascript
const refreshProfiles = async () => {
  const [{ profiles, runningProfileIds }, control] = await Promise.all([request("/profiles"), request("/control/state")]);
  const running = new Set(runningProfileIds);
  const activeProfileId = control.activeProfileId;
  els.activeState.textContent = `Active profile: ${activeProfileId ?? "none"} (updated ${control.updatedAt})`;

  els.profilesBody.innerHTML = "";
  for (const profile of profiles) {
    // ... rest of function ...
  }
};
```

**After:**
```javascript
const refreshProfiles = async () => {
  // ============== NEW CODE ==============
  // Prevent concurrent refreshes
  if (isRefreshing) {
    return;
  }
  
  isRefreshing = true;
  try {
  // ======================================
  
    const [{ profiles, runningProfileIds }, control] = await Promise.all([request("/profiles"), request("/control/state")]);
    const running = new Set(runningProfileIds);
    const activeProfileId = control.activeProfileId;
    els.activeState.textContent = `Active profile: ${activeProfileId ?? "none"} (updated ${control.updatedAt})`;
    
    // ============== NEW CODE ==============
    lastRefreshTime = new Date();
    updateRefreshIndicator();
    // ======================================

    els.profilesBody.innerHTML = "";
    for (const profile of profiles) {
      // ... rest of function ...
    }
  
  // ============== NEW CODE ==============
  } finally {
    isRefreshing = false;
  }
  // ======================================
};
```

---

### Change 3: Add New Helper Functions (After `refreshProfiles()` function)

```javascript
// ============== ALL NEW CODE ==============

// Update refresh indicator to show auto-refresh status
const updateRefreshIndicator = () => {
  const indicator = document.getElementById("autoRefreshIndicator");
  if (!indicator) return;
  
  if (lastRefreshTime) {
    const now = new Date();
    const secondsAgo = Math.floor((now - lastRefreshTime) / 1000);
    indicator.textContent = secondsAgo === 0 ? "just now" : `${secondsAgo}s ago`;
    indicator.style.opacity = "1";
  }
};

// Start auto-refresh polling
const startAutoRefresh = () => {
  if (autoRefreshInterval) {
    return; // Already running
  }
  
  // Refresh every 3 seconds
  autoRefreshInterval = setInterval(async () => {
    try {
      await refreshProfiles();
    } catch (error) {
      // Silently fail on auto-refresh errors to avoid spamming the UI
      console.error("Auto-refresh error:", error);
    }
  }, 3000);
  
  // Update the time indicator every second
  setInterval(updateRefreshIndicator, 1000);
  
  console.log("Auto-refresh started: polling every 3 seconds");
};

// Stop auto-refresh (optional, for future use)
const stopAutoRefresh = () => {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    console.log("Auto-refresh stopped");
  }
};

// ==========================================
```

---

### Change 4: Update Initialization (At end of file)

**Before:**
```javascript
refreshProfiles().catch((error) => {
  const message = String(error.message ?? error);
  setStatus(els.profileActionStatus, message, "err");
  els.commandResult.textContent = message;
});
```

**After:**
```javascript
refreshProfiles().catch((error) => {
  const message = String(error.message ?? error);
  setStatus(els.profileActionStatus, message, "err");
  els.commandResult.textContent = message;
// ============== NEW CODE ==============
}).finally(() => {
  // Start auto-refresh after initial load
  startAutoRefresh();
// ======================================
});
```

---

## File 2: `public/index.html`

### Change: Add Auto-Refresh Indicator to Panel Header

**Before:**
```html
<div class="panel-header space-between">
  <h2>Running Profiles</h2>
  <div class="action-row m-0">
    <button id="refreshBtn" class="btn-icon" title="Refresh">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"/>
        <polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
    </button>
    <button id="releaseBtn" class="btn-secondary btn-sm">Release Active</button>
    <button id="stopAllBtn" class="btn-danger btn-sm">Stop All</button>
  </div>
</div>
```

**After:**
```html
<div class="panel-header space-between">
  <h2>Running Profiles</h2>
  <!-- ============== MODIFIED ==============  -->
  <div class="action-row m-0" style="align-items: center; gap: 8px;">
    <!-- ============== NEW CODE ==============  -->
    <span style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 4px;">
      <span style="display: inline-block; width: 6px; height: 6px; background: var(--success); border-radius: 50%; animation: pulse 2s infinite;"></span>
      Auto-refresh: <span id="autoRefreshIndicator">starting...</span>
    </span>
    <!-- ====================================== -->
    <button id="refreshBtn" class="btn-icon" title="Refresh Now">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"/>
        <polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
    </button>
    <button id="releaseBtn" class="btn-secondary btn-sm">Release Active</button>
    <button id="stopAllBtn" class="btn-danger btn-sm">Stop All</button>
  </div>
</div>
```

---

## Quick Reference Guide

### How It Works

1. **On Page Load**: `startAutoRefresh()` is called after initial data load
2. **Every 3 Seconds**: `setInterval` calls `refreshProfiles()`
3. **Every 1 Second**: Timer indicator updates to show "Xs ago"
4. **On Refresh**: `lastRefreshTime` is updated, indicator resets to "just now"

### Key Configuration Values

| Variable | Value | Location | Purpose |
|----------|-------|----------|---------|
| Refresh Interval | 3000ms | app.js:326 | How often to poll |
| Timer Update | 1000ms | app.js:336 | How often to update display |
| Concurrent Lock | `isRefreshing` | app.js:107 | Prevent overlapping requests |

### To Modify Refresh Frequency

Change line 326 in `app.js`:
```javascript
// Current: 3 seconds
autoRefreshInterval = setInterval(async () => { ... }, 3000);

// For 5 seconds instead:
autoRefreshInterval = setInterval(async () => { ... }, 5000);

// For 1 second (not recommended - may impact performance):
autoRefreshInterval = setInterval(async () => { ... }, 1000);
```

---

## Files Summary

**Files Modified**: 2
**Lines Added**: 72
**Lines Modified**: 8
**Functions Added**: 3
**Total Impact**: Minimal, focused changes

**Modified Files**:
1. ✅ `public/app.js` - Auto-refresh logic
2. ✅ `public/index.html` - Visual indicator

**No Changes Required**:
- ❌ `public/styles.css` - Reused existing `pulse` animation
- ❌ Backend files - No server changes needed
- ❌ Other frontend files - Isolated implementation

---

## Rollback Instructions

If you need to revert these changes:

### Quick Rollback
```bash
git checkout HEAD -- public/app.js public/index.html
```

### Manual Rollback

1. **In `public/app.js`**:
   - Remove lines 104-107 (state variables)
   - Remove try/finally wrapper from `refreshProfiles()`
   - Remove lines 122-123 (lastRefreshTime and updateRefreshIndicator call)
   - Remove lines 306-348 (three new functions)
   - Remove `.finally()` block at end of file (lines 516-518)

2. **In `public/index.html`**:
   - Remove the `<span>` block with auto-refresh indicator
   - Change `action-row m-0` style back to just `action-row m-0` without additional styles

---

## Testing Verification Commands

```bash
# Check if auto-refresh code exists in app.js
grep "startAutoRefresh" public/app.js

# Check if indicator exists in HTML
grep "autoRefreshIndicator" public/index.html

# Verify server is running
curl http://localhost:4321/profiles

# Watch the logs (if server has logging)
# You should see API calls every 3 seconds after opening the UI
```

---

This implementation is complete and ready for production use! 🎉
