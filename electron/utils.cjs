"use strict";

/**
 * Normalizes the GET /profiles API response to a plain array.
 * The API may return either { profiles: [...] } or [...] directly.
 */
function parseProfilesResponse(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.profiles)) return data.profiles;
  return [];
}

/**
 * Filters a profiles array to only those with a valid non-empty string id.
 * Returns an empty array for non-array input.
 */
function filterValidProfiles(profiles) {
  if (!Array.isArray(profiles)) return [];
  return profiles.filter((p) => typeof p.id === "string" && p.id.length > 0);
}

/**
 * Builds a safe profile label for display.
 */
function profileLabel(p) {
  return String(p.name || p.id || "Profile");
}

/**
 * Builds the menu template items for the Profiles submenu.
 * Returns objects with { label, submenu: ["Open Dashboard","Start","Stop"] } shapes.
 * Returns [{ label: "No profiles found", enabled: false }] when the list is empty.
 * This pure function can be tested without requiring Electron.
 *
 * @param {Array} profiles - raw profiles array from the API response
 * @returns {Array} menu template items
 */
function buildProfileMenuItems(profiles) {
  const valid = filterValidProfiles(profiles);
  if (valid.length === 0) return [{ label: "No profiles found", enabled: false }];
  return valid.map((p) => ({
    label: profileLabel(p),
    submenu: [
      { label: "Open Dashboard" },
      { label: "Start" },
      { label: "Stop" },
    ]
  }));
}

/**
 * Polls a URL until it returns an ok response or the timeout is reached.
 * Accepts an optional fetchFn for testability (defaults to global fetch).
 *
 * @param {string} url
 * @param {{ timeoutMs?: number, intervalMs?: number, fetchFn?: Function }} opts
 * @returns {Promise<void>} resolves when the URL responds ok, rejects on timeout
 */
async function waitForUrl(url, { timeoutMs = 30000, intervalMs = 250, fetchFn } = {}) {
  const doFetch = fetchFn || fetch;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await doFetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

module.exports = { parseProfilesResponse, filterValidProfiles, profileLabel, buildProfileMenuItems, waitForUrl };
