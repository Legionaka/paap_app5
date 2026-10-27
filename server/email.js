function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

export async function sendAccountEmail({ to, subject, heading, message, actionLabel, actionUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error('Email delivery is not configured');
  const safeUrl = escapeHtml(actionUrl);
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17352e"><p style="color:#19765d;font-weight:bold">STILLWATER</p><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p><p><a href="${safeUrl}" style="display:inline-block;padding:14px 20px;background:#17624f;color:white;text-decoration:none;border-radius:8px">${escapeHtml(actionLabel)}</a></p><p>If you did not request this, you can ignore this email.</p></div>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
}

export function appBaseUrl(request) {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request.headers['x-forwarded-host'] ?? request.headers.host;
  const protocol = request.headers['x-forwarded-proto'] ?? (process.env.VERCEL ? 'https' : 'http');
  if (!host) throw new Error('Application URL is not configured');
  return `${protocol}://${host}`;
}
