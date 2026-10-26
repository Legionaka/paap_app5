const LOCATION_API_URL = '/api/locations/hartbeespoort-dam';
const WEATHER_TIME_ZONE = 'Africa/Johannesburg';
const catalogSources = new Map();
const search = document.querySelector('#locationSearch');
const toast = document.querySelector('#toast');
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
}

function formatReportDate(date) {
  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: WEATHER_TIME_ZONE,
  }).format(new Date(`${date}T12:00:00+02:00`));
}

function renderCatalog(location) {
  for (const source of location.sources) catalogSources.set(source.id, source);
  document.querySelector('#speciesSourceLink').href = catalogSources.get('dws-crocodile-water-quality')?.url ?? '#';
  document.querySelector('#weatherSourceLink').href = catalogSources.get('open-meteo-weather')?.url ?? '#';

  document.querySelector('#featureTitle').textContent = location.name;
  const locationLine = document.querySelector('.image-caption .image-location');
  const pinIcon = locationLine.querySelector('svg');
  const separator = document.createElement('span');
  separator.className = 'sep';
  separator.textContent = '\u00b7';
  const riverLabel = document.createElement('span');
  riverLabel.id = 'locationRiver';
  riverLabel.textContent = location.river;
  locationLine.replaceChildren(pinIcon, document.createTextNode(` ${location.province}, ${location.country} `), separator, document.createTextNode(' '), riverLabel);
  document.querySelector('#factProvince').textContent = location.province;
  document.querySelector('#factRiver').textContent = location.river;
  document.querySelector('#factCoordinates').textContent = `${Math.abs(location.coordinates.latitude).toFixed(2)}\u00b0 S, ${location.coordinates.longitude.toFixed(2)}\u00b0 E (approx.)`;
  document.querySelector('#coordinatesFact').textContent = `Approx. ${Math.abs(location.coordinates.latitude).toFixed(2)}\u00b0 S, ${location.coordinates.longitude.toFixed(2)}\u00b0 E`;

  const capacity = location.facts.find(fact => fact.key === 'full_supply_capacity');
  if (capacity) {
    document.querySelector('#capacityFact').lastChild.textContent = ` ${capacity.value} ${capacity.unit} full supply capacity`;
    document.querySelector('#factCapacity').textContent = `${capacity.value} ${capacity.unit} · DWS report ${formatReportDate(capacity.sourceDate)}`;
  }

  const storage = location.observations.find(item => item.metric === 'storage_percent_full_supply');
  if (storage) {
    const readableDate = formatReportDate(storage.sourceDate);
    document.querySelector('#factCheckedAt').textContent = formatReportDate(storage.capturedAt.slice(0, 10));
    const freshness = storage.latestAvailable ? ' (latest available in report)' : '';
    document.querySelector('#factLevel').textContent = `${storage.value}${storage.unit} \u00b7 ${readableDate}${freshness}`;

    const note = document.querySelector('#storageSourceNote');
    const sourceLink = (source, label) => {
      const link = document.createElement('a');
      link.href = source?.url ?? '#';
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = label;
      return link;
    };
    const dwsSource = catalogSources.get(storage.sourceId);
    const secondarySource = storage.capturedFromSourceId
      ? catalogSources.get(storage.capturedFromSourceId)
      : null;
    note.replaceChildren(
      document.createTextNode('This weekly value comes from the '),
      sourceLink(dwsSource, 'DWS report'),
      ...(secondarySource ? [
        document.createTextNode(' and was transcribed from a '),
        sourceLink(secondarySource, 'secondary summary'),
      ] : []),
      document.createTextNode(`. It is not a live sensor reading${storage.latestAvailable ? '; DWS marks it as the latest available data' : ''}. Percentages may exceed 100% of full supply.`),
    );
  }

  const speciesList = document.querySelector('#speciesList');
  speciesList.replaceChildren();
  for (const item of location.species) {
    const card = document.createElement('article');
    card.className = 'species-card verified-species';
    const marker = document.createElement('span');
    marker.className = 'species-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = '\u2022';
    const info = document.createElement('div');
    info.className = 'species-info';
    const label = document.createElement('span');
    label.className = 'species-type green';
    label.textContent = 'IN DWS ECOLOGICAL REPORT';
    const name = document.createElement('h3');
    name.textContent = item.name;
    info.append(label, name);
    card.append(marker, info);
    speciesList.append(card);
  }
}

function windDirection(degrees) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return directions[Math.round(degrees / 22.5) % directions.length];
}

function weatherDescription(code) {
  if (code === 0) return 'Clear sky';
  if ([1, 2].includes(code)) return 'Mostly clear';
  if (code === 3) return 'Overcast';
  if ([45, 48].includes(code)) return 'Fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain showers';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([95, 96, 99].includes(code)) return 'Thunderstorms';
  return 'Conditions unavailable';
}

function weatherSymbol(code) {
  if (code === 0) return '☀';
  if ([1, 2].includes(code)) return '◐';
  if ([45, 48, 51, 53, 55].includes(code)) return '☁';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '☂';
  if ([95, 96, 99].includes(code)) return 'ϟ';
  return '☁';
}

function formatHour(date) {
  return new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', timeZone: WEATHER_TIME_ZONE }).format(date);
}

function renderHourlyForecast(hourly, currentTime) {
  const now = new Date(currentTime);
  const times = hourly.time.map((time, index) => ({ time: new Date(time), index }))
    .filter(item => item.time >= now)
    .filter((_, index) => index % 2 === 0)
    .slice(0, 6);

  const container = document.querySelector('#hourlyForecast');
  container.replaceChildren();
  for (const { time, index } of times) {
    const item = document.createElement('div');
    item.className = 'hour';
    const label = document.createElement('span');
    label.textContent = index === times[0]?.index ? 'NOW' : formatHour(time);
    const icon = document.createElement('div');
    icon.className = 'sun-mini';
    icon.textContent = weatherSymbol(hourly.weather_code[index]);
    const temperature = document.createElement('strong');
    temperature.textContent = `${Math.round(hourly.temperature_2m[index])}°`;
    const wind = document.createElement('span');
    wind.className = 'hour-wind';
    wind.textContent = `${Math.round(hourly.wind_speed_10m[index])} km/h`;
    item.append(label, icon, temperature, wind);
    container.append(item);
  }
}

async function loadWeather(coordinates) {
  const params = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,weather_code',
    forecast_days: '2',
    timezone: WEATHER_TIME_ZONE,
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);
  const data = await response.json();

  document.querySelector('#currentTemperature').textContent = `${Math.round(data.current.temperature_2m)}\u00b0`;
  document.querySelector('#currentWeather').textContent = weatherDescription(data.current.weather_code);
  document.querySelector('#currentWind').textContent = `${windDirection(data.current.wind_direction_10m)} ${Math.round(data.current.wind_speed_10m)} km/h`;
  document.querySelector('#currentWindSummary').textContent = `Model time ${formatHour(new Date(data.current.time))}`;
  document.querySelector('#weatherUpdated').textContent = `Forecast model time ${formatHour(new Date(data.current.time))}`;
  renderHourlyForecast(data.hourly, data.current.time);
}

async function initialise() {
  let location;
  try {
    const response = await fetch(LOCATION_API_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Location API returned ${response.status}`);
    const result = await response.json();
    location = result.location;
    if (!location) throw new Error('Hartbeespoort Dam is missing from the location catalogue');
    renderCatalog(location);
  } catch (error) {
    console.error('Could not load location data:', error);
    document.querySelector('#weatherUpdated').textContent = 'Location data unavailable';
    document.querySelector('#currentWeather').textContent = 'Location data unavailable';
    return;
  }

  try {
    await loadWeather(location.coordinates);
  } catch (error) {
    console.error('Could not load weather forecast:', error);
    document.querySelector('#currentWeather').textContent = 'Forecast unavailable';
    document.querySelector('#weatherUpdated').textContent = 'Weather data unavailable';
    document.querySelector('#hourlyForecast').textContent = 'Forecast unavailable. Try again later.';
  }

  window.setInterval(() => {
    if (!document.hidden) loadWeather(location.coordinates).catch(error => console.error('Weather refresh failed:', error));
  }, 15 * 60 * 1000);
}

// Save state is local to this browser until accounts and persistence are added.
document.querySelector('.save-button').addEventListener('click', event => {
  const button = event.currentTarget;
  const saved = button.classList.toggle('saved');
  button.setAttribute('aria-label', saved ? 'Remove Hartbeespoort Dam from saved locations' : 'Save Hartbeespoort Dam');
  showToast(saved ? 'Hartbeespoort Dam saved to your waters' : 'Removed from your saved waters');
});

document.querySelector('#locationButton').addEventListener('click', () => showToast('More verified locations will be added to the catalogue'));
search.addEventListener('keydown', event => {
  if (event.key === 'Enter' && search.value.trim()) {
    showToast('Hartbeespoort Dam is the first location in the catalogue');
  }
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    search.focus();
  }
});
document.querySelectorAll('.main-nav a, .mobile-nav a').forEach(link => link.addEventListener('click', () => {
  document.querySelectorAll('.main-nav a').forEach(item => item.classList.toggle('active', item.getAttribute('href') === link.getAttribute('href')));
  document.querySelectorAll('.mobile-nav a').forEach(item => item.classList.toggle('mobile-active', item.getAttribute('href') === link.getAttribute('href')));
}));

const forumPosts = document.querySelector('#forumPosts');
const forumAccount = document.querySelector('#forumAccount');
const forumNotices = document.querySelector('#forumNotices');
const authDialog = document.querySelector('#authDialog');
const postDialog = document.querySelector('#postDialog');
const reportDialog = document.querySelector('#reportDialog');
let forumUser = null;
let authMode = 'login';

async function communityRequest(path, options = {}) {
  const response = await fetch(`/api/community/${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Community service is unavailable.');
  return data;
}

function setForumNotice(message, isError = false) {
  forumNotices.textContent = message;
  forumNotices.classList.toggle('error', isError);
}

function formatCommunityDate(date) {
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: WEATHER_TIME_ZONE }).format(new Date(date));
}

function addButton(parent, text, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.className = className;
  button.addEventListener('click', onClick);
  parent.append(button);
  return button;
}

function reportContent(targetType, targetId) {
  if (!forumUser) {
    setForumNotice('Sign in to report content.', true);
    authMode = 'login';
    openAuthDialog();
    return;
  }
  const form = document.querySelector('#reportForm');
  form.elements.targetType.value = targetType;
  form.elements.targetId.value = targetId;
  document.querySelector('#reportError').textContent = '';
  reportDialog.showModal();
}

function renderReplies(container, replies, post) {
  for (const reply of replies) {
    const card = document.createElement('article');
    card.className = 'forum-reply';
    const header = document.createElement('div');
    header.className = 'forum-post-meta';
    const author = document.createElement('strong');
    author.textContent = reply.displayName;
    const date = document.createElement('time');
    date.dateTime = reply.createdAt;
    date.textContent = formatCommunityDate(reply.createdAt);
    header.append(author, date);
    const body = document.createElement('p');
    body.textContent = reply.body;
    card.append(header, body);
    if (forumUser) addButton(card, 'Report', 'text-action', () => reportContent('reply', reply.id));
    container.append(card);
  }
  if (forumUser && !post.isLocked) {
    const form = document.createElement('form');
    form.className = 'reply-form';
    const field = document.createElement('input');
    field.name = 'body';
    field.required = true;
    field.minLength = 2;
    field.maxLength = 3000;
    field.placeholder = 'Write a helpful reply…';
    field.setAttribute('aria-label', 'Write a reply');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Reply';
    form.append(field, submit);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      try {
        await communityRequest(`posts/${post.id}/replies`, { method: 'POST', body: JSON.stringify({ body: field.value }) });
        await loadCommunity();
        setForumNotice('Reply posted.');
      } catch (error) {
        setForumNotice(error.message, true);
        submit.disabled = false;
      }
    });
    container.append(form);
  }
}

function renderPosts(posts) {
  forumPosts.replaceChildren();
  if (!posts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-reports forum-empty';
    const title = document.createElement('strong');
    title.textContent = 'Start the first discussion';
    const hint = document.createElement('span');
    hint.textContent = 'Ask about access, share a trip note, or compare techniques for this water.';
    empty.append(title, hint);
    forumPosts.append(empty);
    return;
  }
  for (const post of posts) {
    const article = document.createElement('article');
    article.className = 'forum-post';
    const meta = document.createElement('div');
    meta.className = 'forum-post-meta';
    const author = document.createElement('strong');
    author.textContent = post.displayName;
    const date = document.createElement('time');
    date.dateTime = post.createdAt;
    date.textContent = formatCommunityDate(post.createdAt);
    meta.append(author, date);
    if (post.isLocked) {
      const locked = document.createElement('span');
      locked.className = 'forum-locked';
      locked.textContent = 'Locked';
      meta.append(locked);
    }
    const title = document.createElement('h3');
    title.textContent = post.title;
    const content = document.createElement('p');
    content.className = 'forum-post-body';
    content.textContent = post.body;
    const actions = document.createElement('div');
    actions.className = 'forum-post-actions';
    const replyCount = document.createElement('span');
    replyCount.textContent = `${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}`;
    actions.append(replyCount);
    if (forumUser) addButton(actions, 'Report', 'text-action', () => reportContent('post', post.id));
    article.append(meta, title, content, actions);
    const replies = document.createElement('div');
    replies.className = 'forum-replies';
    renderReplies(replies, post.replies, post);
    article.append(replies);
    forumPosts.append(article);
  }
}

function renderForumAccount(user) {
  forumAccount.replaceChildren();
  forumAccount.hidden = !user;
  document.querySelector('#forumSignIn').hidden = Boolean(user);
  document.querySelector('#newDiscussion').disabled = false;
  if (!user) return;
  const signed = document.createElement('span');
  signed.textContent = `Signed in as ${user.displayName}`;
  forumAccount.append(signed);
  addButton(forumAccount, 'Sign out', 'text-action', async () => {
    try {
      await communityRequest('auth/logout', { method: 'POST', body: '{}' });
      forumUser = null;
      await loadCommunity();
    } catch (error) { setForumNotice(error.message, true); }
  });
}

async function loadModeration() {
  const panel = document.querySelector('#moderationPanel');
  if (!forumUser || !['moderator', 'admin'].includes(forumUser.role)) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const list = document.querySelector('#moderationReports');
  try {
    const { reports } = await communityRequest('moderation');
    list.replaceChildren();
    if (!reports.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No open reports.';
      list.append(empty);
      return;
    }
    for (const report of reports) {
      const row = document.createElement('article');
      row.className = 'moderation-report';
      const description = document.createElement('p');
      description.textContent = `${report.reason.replaceAll('_', ' ')} · ${report.reporterName}: ${report.targetPreview || '(content unavailable)'}`;
      row.append(description);
      const actions = document.createElement('div');
      actions.className = 'forum-post-actions';
      const runAction = async action => {
        try {
          await communityRequest('moderation', { method: 'POST', body: JSON.stringify({ reportId: report.id, action }) });
          await loadCommunity();
        } catch (error) { setForumNotice(error.message, true); }
      };
      addButton(actions, 'Hide', 'text-action', () => runAction('hide'));
      if (report.targetType === 'post') addButton(actions, 'Restore', 'text-action', () => runAction('restore'));
      if (report.targetType === 'post') addButton(actions, report.targetLocked ? 'Unlock' : 'Lock', 'text-action', () => runAction(report.targetLocked ? 'unlock' : 'lock'));
      addButton(actions, 'Dismiss', 'text-action', () => runAction('dismiss'));
      row.append(actions);
      list.append(row);
    }
  } catch (error) {
    list.textContent = error.message;
  }
}

async function loadCommunity() {
  try {
    const data = await communityRequest('hartbeespoort-dam');
    forumUser = data.user;
    renderForumAccount(forumUser);
    renderPosts(data.posts);
    await loadModeration();
  } catch (error) {
    forumPosts.textContent = error.message;
  }
}

function openAuthDialog() {
  document.querySelector('#authError').textContent = '';
  setAuthMode(authMode);
  authDialog.showModal();
}

function setAuthMode(mode) {
  authMode = mode;
  const registration = mode === 'register';
  document.querySelector('#authTitle').textContent = registration ? 'Create your account' : 'Sign in';
  document.querySelector('#authSubmit').textContent = registration ? 'Create account' : 'Sign in';
  document.querySelector('#displayNameField').hidden = !registration;
  document.querySelector('#displayNameField input').required = registration;
  document.querySelector('#authForm [name="password"]').autocomplete = registration ? 'new-password' : 'current-password';
  document.querySelectorAll('.auth-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.authMode === mode));
}

document.querySelector('#forumSignIn').addEventListener('click', () => { authMode = 'login'; openAuthDialog(); });
document.querySelector('#newDiscussion').addEventListener('click', () => {
  if (!forumUser) { authMode = 'login'; openAuthDialog(); return; }
  document.querySelector('#postError').textContent = '';
  postDialog.showModal();
});
document.querySelectorAll('[data-auth-mode]').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));

document.querySelector('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = document.querySelector('#authError');
  errorBox.textContent = '';
  const data = Object.fromEntries(new FormData(form));
  try {
    const result = await communityRequest(`auth/${authMode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(data) });
    forumUser = result.user;
    authDialog.close();
    form.reset();
    await loadCommunity();
    setForumNotice(`Welcome, ${forumUser.displayName}.`);
  } catch (error) { errorBox.textContent = error.message; }
});

document.querySelector('#postForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = document.querySelector('#postError');
  errorBox.textContent = '';
  try {
    await communityRequest('hartbeespoort-dam/posts', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    postDialog.close();
    form.reset();
    await loadCommunity();
    setForumNotice('Discussion posted.');
  } catch (error) { errorBox.textContent = error.message; }
});

document.querySelector('#reportForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = document.querySelector('#reportError');
  errorBox.textContent = '';
  try {
    await communityRequest('reports', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    reportDialog.close();
    form.reset();
    setForumNotice('Report sent to the moderation queue.');
  } catch (error) { errorBox.textContent = error.message; }
});

initialise();
loadCommunity();
