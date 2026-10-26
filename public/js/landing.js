const featured = document.querySelector('#featuredWaters');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
document.querySelector('#yearNow').textContent = new Date().getFullYear();
document.querySelector('#heroSearch').addEventListener('submit', event => {
  const query = document.querySelector('#locationQuery').value.trim();
  if (!query) { event.preventDefault(); location.href = '/explore/'; }
});
const menuButton = document.querySelector('#menuToggle');
const menu = document.querySelector('#mobileMenu');
menuButton.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!expanded));
  menuButton.setAttribute('aria-label', expanded ? 'Open navigation' : 'Close navigation');
  menu.hidden = expanded;
});
menu.addEventListener('click', event => { if (event.target.closest('a')) { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); } });
fetch('/api/community/auth/me', { credentials: 'same-origin' }).then(response => response.ok ? response.json() : null).then(data => {
  if (data?.user) { const link = document.querySelector('#headerAccount'); link.href = '/account/'; link.textContent = 'My account'; }
}).catch(() => {});
fetch('/api/locations').then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(({ locations = [] }) => {
  if (!locations.length) throw new Error();
  featured.innerHTML = locations.slice(0, 3).map(location => `<a class="water-card" href="/explore/?location=${encodeURIComponent(location.id)}"><div class="water-card-image"><span>${esc(location.type || 'FISHING WATER').toUpperCase()}</span></div><div class="water-card-body"><h3>${esc(location.name)}</h3><p>${esc([location.province, location.river].filter(Boolean).join(' · ') || 'South Africa')}</p><span class="water-card-link">View location →</span></div></a>`).join('');
}).catch(() => { featured.innerHTML = '<p class="featured-loading">The location directory is temporarily unavailable. <a href="/explore/">Open the fishing guide</a>.</p>'; });
