/**
 * TaftTasks background service worker
 * Updates the extension badge with overdue assignment count every 6 hours.
 */

const SUPABASE_URL = 'https://pupqkuunekeeyfnfjpde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1cHFrdXVuZWtlZXlmbmZqcGRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NzEsImV4cCI6MjA4ODU4OTY3MX0.ktUUhaqi3BO5wAr8kWaTqvoQ1fxRlitvD9hpIUXOUdU';
const ALARM_NAME = 'badge-update';
const SYNC_PERIOD_MINUTES = 360; // 6 hours

// ── Lifecycle ──

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
  console.log('[TaftTasks] Background worker installed');
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
});

function setupAlarm() {
  chrome.alarms.get(ALARM_NAME, existing => {
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES });
      console.log('[TaftTasks] Alarm created — updating badge every', SYNC_PERIOD_MINUTES, 'minutes');
    }
  });
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    updateBadgeFromStorage();
  }
});

// ── Badge ──

async function updateBadgeFromStorage() {
  const { session } = await chrome.storage.local.get('session');
  if (!session?.access_token || !session?.user?.id) return;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/assignments?user_id=eq.${session.user.id}&done=eq.false&due=lt.${today}&select=id`,
      {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': SUPABASE_KEY,
        },
      }
    );
    const overdue = await res.json();
    const count = Array.isArray(overdue) ? overdue.length : 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  } catch {
    // badge update is best-effort
  }
}
