# Tab Persistence Implementation Summary

## Overview
Successfully implemented session/tab persistence feature that saves and restores open browser tabs when a profile is stopped and restarted.

## Changes Made

### 1. Schema Updates (`src/domain/profile.ts`)

Added `SavedTab` schema and updated `ProfileRecord` to include optional `savedTabs` field:

```typescript
export const SavedTabSchema = z.object({
  url: z.string(),
  active: z.boolean()
});

export const ProfileRecordSchema = z.object({
  // ... existing fields
  savedTabs: z.array(SavedTabSchema).optional()
});
```

### 2. Profile Store (`src/storage/profileStore.ts`)

Added `saveTabs()` method to persist tab state to profile metadata:

```typescript
async saveTabs(profileId: string, tabs: Array<{ url: string; active: boolean }>): Promise<ProfileRecord | null>
```

This method:
- Updates the profile record with the saved tabs array
- Updates the `updatedAt` timestamp
- Persists changes to disk

### 3. Playwright Runtime (`src/browser/playwrightRuntime.ts`)

#### Added ProfileStore Integration
- Added optional `profileStore` parameter to `PlaywrightRuntimeOptions`
- Store reference passed to runtime to enable tab persistence

#### Tab Saving on Stop
- Modified `stop()` method to call `saveCurrentTabs()` before closing
- Modified `handlePageClosed()` to save tabs when browser window is closed externally
- Implemented `saveCurrentTabs()` helper that:
  - Gets current list of tabs using existing `listTabs()` method
  - Filters out invalid URLs (about:, chrome://, etc.)
  - Saves tabs with their URLs and active state
  - Handles errors gracefully (doesn't block shutdown)

#### Tab Restoration on Start
- Modified `start()` method to call `restoreSavedTabs()` after context creation
- Implemented `restoreSavedTabs()` helper that:
  - Checks if profile has saved tabs
  - Creates new pages for each saved tab
  - Navigates to the saved URLs with timeout
  - Restores the active tab index
  - Closes the initial blank page after restoration
  - Handles invalid URLs and navigation failures gracefully
  - Falls back to default behavior if restoration fails

### 4. Server App (`src/serverApp.ts`)

Updated runtime initialization to pass ProfileStore:

```typescript
const runtime = new PlaywrightRuntime({
  // ... other options
  profileStore: store
});
```

## Edge Cases Handled

1. **No Saved Tabs**: When a profile has no saved tabs, browser starts normally with a blank page
2. **Invalid URLs**: URLs that fail validation are skipped during restoration
3. **Navigation Failures**: If a page fails to load (timeout, network error), it's skipped with a warning
4. **Empty/Special URLs**: Filters out `about:`, `chrome://newtab/`, and other non-persistent URLs
5. **External Browser Close**: Saves tabs when last page is closed (user closes browser window)
6. **Active Tab Restoration**: Preserves which tab was active and brings it to front
7. **Context Closure**: Creates new tabs before closing initial page to prevent context closure

## Testing

### Automated Tests (`tests/tabPersistence.test.ts`)

Created comprehensive test suite with 4 test cases:

1. **Tab Save and Restore**: Opens 3 tabs, stops profile, verifies tabs saved, restarts, verifies tabs restored
2. **Empty Saved Tabs**: Tests graceful handling when profile has no saved tabs
3. **Active Tab Preservation**: Verifies active tab index is maintained across restarts
4. **URL Filtering**: Verifies invalid URLs are filtered out during save

All tests pass ✅

### Manual Testing (`test-tab-persistence.js`)

Created demo script that:
- Opens multiple real websites (Wikipedia, GitHub, Hacker News)
- Displays browser window for visual verification
- Shows before/after tab lists
- Verifies URLs match after restoration

Manual test results:
```
✓ Opened 3 tabs
✓ Browser stopped and tabs saved
✓ Saved 3 tabs to profile metadata
✓ Browser restarted
✓ Restored 3 tabs
✓ Same number of tabs restored
✓ All URLs match
```

## Usage Example

```typescript
const store = new ProfileStore(profilesDir);
const runtime = new PlaywrightRuntime({
  artifactsDir,
  defaultHeadless: false,
  allowEvaluate: false,
  profileStore: store  // Enable tab persistence
});

// Start profile and open tabs
await runtime.start(profile);
await runtime.execute(profile, { type: "navigate", url: "https://example.com" });
await runtime.execute(profile, { type: "newTab", url: "https://github.com" });

// Stop profile (tabs are automatically saved)
await runtime.stop(profile.id);

// Restart profile (tabs are automatically restored)
const updatedProfile = await store.get(profile.id);
await runtime.start(updatedProfile);
// Browser now has the same tabs open!
```

## Benefits

1. **User Experience**: Users don't lose their session when restarting the browser
2. **Persistence**: Tab state survives across application restarts
3. **No Breaking Changes**: Feature is opt-in via `profileStore` parameter
4. **Graceful Degradation**: If restoration fails, browser still starts normally
5. **Automatic**: No API changes needed - works transparently with existing commands

## Performance Considerations

- Tab restoration happens in parallel (Promise.all for multiple tabs)
- Uses `domcontentloaded` wait strategy for fast restoration
- 10-second timeout per tab prevents hanging on slow pages
- Failures don't block other tabs from restoring

## Future Enhancements (Optional)

1. Save scroll position and form data
2. Save tab group information
3. Add max tabs limit to prevent too many saved tabs
4. Add option to disable persistence per profile
5. Save tab history for back/forward navigation
6. Compress/deduplicate saved URLs

## Files Modified

1. `src/domain/profile.ts` - Added SavedTab schema
2. `src/storage/profileStore.ts` - Added saveTabs method
3. `src/browser/playwrightRuntime.ts` - Added save/restore logic
4. `src/serverApp.ts` - Pass store to runtime

## Files Created

1. `tests/tabPersistence.test.ts` - Automated test suite
2. `test-tab-persistence.js` - Manual demo script

## Backward Compatibility

✅ Fully backward compatible:
- Existing profiles without `savedTabs` work normally
- ProfileStore parameter is optional in runtime
- Schema allows `savedTabs` to be undefined
- All existing tests pass
