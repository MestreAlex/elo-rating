// Auto-update trigger: if today is Tue(2) or Fri(5) and local time is >=12:00, trigger proxy /update-leagues once per day
(function(){
  try {
    const DAYS = [2,5]; // Tue, Fri
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    if (!DAYS.includes(day)) return;
    if (hour < 12) return;
    const key = 'elo_last_update_trigger';
    const todayKey = now.toISOString().slice(0,10);
    if (localStorage.getItem(key) === todayKey) return; // already triggered today

    const proxyBase = 'http://localhost:5000';
    // check proxy health first
    fetch(proxyBase + '/health', { method: 'GET', mode: 'cors' , cache: 'no-store'})
      .then(r => {
        if (!r.ok) throw new Error('proxy-unreachable');
        return fetch(proxyBase + '/update-leagues', { method: 'GET', mode: 'cors' });
      })
      .then(r => r.json())
      .then(json => {
        console.info('Auto-update triggered:', json);
        localStorage.setItem(key, todayKey);
      })
      .catch(err => {
        console.info('Auto-update: proxy not available or failed to trigger:', err);
      });
  } catch (e) {
    console.warn('Auto-update script error', e);
  }
})();
