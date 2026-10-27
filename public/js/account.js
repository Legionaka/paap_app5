const summary = document.querySelector('#accountSummary');
const message = document.querySelector('#accountMessage');
const savedList = document.querySelector('#savedLocations');
let user;
async function request(path, options = {}) {
  const response = await fetch(`/api/community/${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function show(text, success = false) {
  message.textContent = text;
  message.classList.toggle('success', success);
}
async function loadSaved() {
  const { locations } = await request('auth/saved-locations');
  savedList.replaceChildren();
  if (!locations.length) {
    const p = document.createElement('p');
    p.textContent = 'No saved waters yet.';
    savedList.append(p);
    return;
  }
  for (const location of locations) {
    const row = document.createElement('div');
    row.className = 'saved-item';
    const link = document.createElement('a');
    link.href = `/explore/locations/${encodeURIComponent(location.id)}/`;
    link.textContent = location.name;
    const details = document.createElement('small');
    details.textContent = [location.type, location.province].filter(Boolean).join(' · ');
    link.append(details);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${location.name} from saved waters`);
    remove.addEventListener('click', async () => {
      try {
        await request('auth/saved-locations', {
          method: 'DELETE',
          body: JSON.stringify({ locationId: location.id }),
        });
        await loadSaved();
      } catch (error) {
        show(error.message);
      }
    });
    row.append(link, remove);
    savedList.append(row);
  }
}
try {
  const { user: current } = await request('auth/me');
  user = current;
  if (!user) {
    location.replace(`/sign-in/?returnTo=${encodeURIComponent('/account/')}`);
  } else {
    summary.textContent = `${user.email} · ${user.emailVerified ? 'Email verified' : 'Email not verified'}`;
    document.querySelector('#profileForm [name="displayName"]').value = user.displayName;
    document.querySelector('#verificationSection').hidden = user.emailVerified;
    if (user.emailVerified) await loadSaved();
    else savedList.textContent = 'Verify your email to sync saved waters.';
  }
} catch (error) {
  summary.textContent = error.message;
}
document.querySelector('#resendVerification').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  try {
    await request('auth/resend-verification', { method: 'POST', body: '{}' });
    show('If email delivery is configured, a new verification link is on its way.', true);
  } catch (error) {
    show(error.message);
  } finally {
    event.currentTarget.disabled = false;
  }
});
document.querySelector('#profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await request('auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
    });
    user = data.user;
    show('Profile saved.', true);
  } catch (error) {
    show(error.message);
  }
});
document.querySelector('#passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await request('auth/change-password', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
    });
    show('Password updated. Sign in again with the new password.', true);
    setTimeout(() => location.assign('/sign-in/'), 1500);
  } catch (error) {
    show(error.message);
  }
});
document.querySelector('#signOut').addEventListener('click', async () => {
  try {
    await request('auth/logout', { method: 'POST', body: '{}' });
    location.assign('/');
  } catch (error) {
    show(error.message);
  }
});
