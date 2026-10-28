const page = document.body.dataset.page;
const form = document.querySelector('#authForm');
const message = document.querySelector('#authMessage');
const params = new URLSearchParams(location.search);
const returnTo = params.get('returnTo');
function safeReturnTo(value, fallback = '/') {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : fallback;
}
async function request(path, body) {
  const response = await fetch(`/api/community/auth/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function status(text, success = false) {
  message.textContent = text;
  message.classList.toggle('success', success);
}

if (page === 'verify-email') {
  const token = params.get('token');
  if (!token) {
    status(
      'This verification link is missing its token. Request another email from your account page.',
    );
    document.querySelector('#verifySignIn').hidden = false;
  } else
    request('verify', { token })
      .then(() => {
        status('Email verified. You can now join the community.', true);
        location.replace(safeReturnTo(returnTo));
      })
      .catch((error) => {
        status(error.message);
        document.querySelector('#verifySignIn').hidden = false;
      });
} else if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status('');
    const body = Object.fromEntries(new FormData(form));
    try {
      if (page === 'sign-in') {
        const data = await request('login', body);
        if (!data.user.emailVerified) location.assign('/account/');
        else location.assign(safeReturnTo(returnTo));
      } else if (page === 'register') {
        body.returnTo = safeReturnTo(returnTo, '/account/');
        await request('register', body);
        status(
          'Account created. Check your inbox for the verification link. You can sign in after confirming your email.',
          true,
        );
        form.reset();
      } else if (page === 'forgot-password') {
        const data = await request('forgot-password', body);
        status(data.message, true);
        form.reset();
      } else if (page === 'reset-password') {
        await request('reset-password', { token: params.get('token'), password: body.password });
        status('Password updated. Sign in with your new password.', true);
        form.reset();
        setTimeout(() => location.assign('/sign-in/'), 1400);
      }
    } catch (error) {
      status(error.message);
    } finally {
      submit.disabled = false;
    }
  });
}
if (page === 'register' && returnTo)
  document.querySelector('#authForm').action =
    `/register/?returnTo=${encodeURIComponent(returnTo)}`;
if (page === 'sign-in' && returnTo)
  document.querySelector('#registerLink').href =
    `/register/?returnTo=${encodeURIComponent(returnTo)}`;
