import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { neon } from '@neondatabase/serverless';

const scrypt = promisify(scryptCallback);
const COOKIE = 'stillwater_session';
const SESSION_DAYS = 30;
const BODY_LIMIT = 12000;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function getBody(request) {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) fail(400, 'Invalid request body');
  return request.body;
}

function getPath(request) {
  const candidate = request.query?.path ?? request.path?.split('/').filter(Boolean).slice(2) ?? [];
  const parts = Array.isArray(candidate) ? candidate : [candidate];
  return parts.map(String).filter(Boolean);
}

function parseCookies(header = '') {
  const pairs = header.split(';').map(part => part.trim().split('='));
  return Object.fromEntries(pairs.filter(([key, value]) => key && value).map(([key, ...value]) => [key, decodeURIComponent(value.join('='))]));
}

function requestIp(request) {
  return String(request.headers['x-forwarded-for'] ?? request.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function makePasswordHash(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${Buffer.from(derived).toString('hex')}`;
}

async function passwordMatches(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !/^[a-f0-9]{32}$/.test(saltHex ?? '') || !/^[a-f0-9]{128}$/.test(hashHex ?? '')) return false;
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, 'hex'), 64));
  const expected = Buffer.from(hashHex, 'hex');
  return timingSafeEqual(actual, expected);
}

function setSessionCookie(response, token, maxAge = SESSION_DAYS * 86400) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function ensureSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers['x-forwarded-host'] ?? request.headers.host;
  if (!host || new URL(origin).host !== host) fail(403, 'Cross-origin request rejected');
}

async function checkRateLimit(sql, key, max, windowSeconds) {
  const rows = await sql`
    INSERT INTO public.community_rate_limits (bucket_key, window_started_at, request_count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (bucket_key) DO UPDATE SET
      request_count = CASE
        WHEN public.community_rate_limits.window_started_at < now() - (${windowSeconds} * interval '1 second') THEN 1
        ELSE public.community_rate_limits.request_count + 1
      END,
      window_started_at = CASE
        WHEN public.community_rate_limits.window_started_at < now() - (${windowSeconds} * interval '1 second') THEN now()
        ELSE public.community_rate_limits.window_started_at
      END,
      updated_at = now()
    RETURNING request_count
  `;
  if (Number(rows[0]?.request_count) > max) fail(429, 'Too many attempts. Please wait and try again.');
}

async function currentUser(sql, request) {
  const token = parseCookies(request.headers.cookie)[COOKIE];
  if (!token || token.length > 128) return null;
  const rows = await sql`
    SELECT u.id, u.email, u.display_name AS "displayName", u.role, u.status
    FROM public.community_sessions s
    JOIN public.community_users u ON u.id = s.user_id
    WHERE s.token_hash = ${hash(token)} AND s.expires_at > now() AND u.status = 'active'
    LIMIT 1
  `;
  if (!rows[0]) return null;
  await sql`UPDATE public.community_sessions SET last_seen_at = now() WHERE token_hash = ${hash(token)}`;
  return rows[0];
}

function publicUser(user) {
  return user ? { id: user.id, displayName: user.displayName, role: user.role } : null;
}

function assertMember(user) {
  if (!user) fail(401, 'Sign in to continue.');
  if (user.status !== 'active') fail(403, 'This account cannot post.');
}

function assertModerator(user) {
  assertMember(user);
  if (!['moderator', 'admin'].includes(user.role)) fail(403, 'Moderator access required.');
}

function setJson(response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
}

export default async function communityHandler(request, response) {
  setJson(response);
  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) fail(503, 'Community database is not configured.');
    const sql = neon(connectionString);
    const parts = getPath(request);
    const method = request.method ?? 'GET';
    const user = await currentUser(sql, request);

    if (method !== 'GET') {
      ensureSameOrigin(request);
      const contentType = request.headers['content-type'] ?? '';
      if (!contentType.includes('application/json')) fail(415, 'Send JSON content.');
    }

    if (parts[0] === 'auth' && parts[1] === 'me' && method === 'GET') {
      return response.status(200).json({ user: publicUser(user) });
    }

    if (parts[0] === 'auth' && parts[1] === 'register' && method === 'POST') {
      const body = getBody(request);
      const email = cleanText(body.email, 254).toLowerCase();
      const displayName = cleanText(body.displayName, 36);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
      if (displayName.length < 2 || !/^[\p{L}\p{N} _.-]+$/u.test(displayName)) fail(400, 'Choose a display name with 2–36 letters or numbers.');
      if (password.length < 12 || Buffer.byteLength(password) > 128) fail(400, 'Password must be at least 12 characters and no more than 128 bytes.');
      await checkRateLimit(sql, `register:${hash(requestIp(request))}`, 5, 3600);
      const passwordHash = await makePasswordHash(password);
      let created;
      try {
        created = await sql`
          INSERT INTO public.community_users (email, display_name, password_hash)
          VALUES (${email}, ${displayName}, ${passwordHash})
          RETURNING id, email, display_name AS "displayName", role, status
        `;
      } catch (error) {
        if (error.code === '23505') fail(409, 'An account with that email already exists.');
        throw error;
      }
      const token = randomBytes(32).toString('base64url');
      await sql`INSERT INTO public.community_sessions (user_id, token_hash, expires_at) VALUES (${created[0].id}, ${hash(token)}, now() + interval '30 days')`;
      setSessionCookie(response, token);
      return response.status(201).json({ user: publicUser(created[0]) });
    }

    if (parts[0] === 'auth' && parts[1] === 'login' && method === 'POST') {
      const body = getBody(request);
      const email = cleanText(body.email, 254).toLowerCase();
      const password = typeof body.password === 'string' ? body.password : '';
      await checkRateLimit(sql, `login:${hash(requestIp(request))}`, 12, 900);
      const rows = await sql`SELECT id, email, display_name AS "displayName", role, status, password_hash FROM public.community_users WHERE email = ${email} LIMIT 1`;
      const account = rows[0];
      const matches = account ? await passwordMatches(password, account.password_hash) : false;
      if (!matches || account.status !== 'active') fail(401, 'Email or password is incorrect.');
      const token = randomBytes(32).toString('base64url');
      await sql`INSERT INTO public.community_sessions (user_id, token_hash, expires_at) VALUES (${account.id}, ${hash(token)}, now() + interval '30 days')`;
      setSessionCookie(response, token);
      return response.status(200).json({ user: publicUser(account) });
    }

    if (parts[0] === 'auth' && parts[1] === 'logout' && method === 'POST') {
      const token = parseCookies(request.headers.cookie)[COOKIE];
      if (token) await sql`DELETE FROM public.community_sessions WHERE token_hash = ${hash(token)}`;
      clearSessionCookie(response);
      return response.status(200).json({ user: null });
    }

    if (parts[0] === 'moderation' && parts.length === 1 && method === 'GET') {
      assertModerator(user);
      const reports = await sql`
        SELECT r.id, r.target_type AS "targetType", r.target_id AS "targetId", r.reason, r.details,
               r.created_at AS "createdAt", reporter.display_name AS "reporterName",
               CASE WHEN r.target_type = 'post' THEN p.title ELSE left(reply.body, 180) END AS "targetPreview",
               CASE WHEN r.target_type = 'post' THEN p.status ELSE reply.status END AS "targetStatus",
               CASE WHEN r.target_type = 'post' THEN p.is_locked ELSE false END AS "targetLocked"
        FROM public.community_reports r
        JOIN public.community_users reporter ON reporter.id = r.reporter_id
        LEFT JOIN public.community_posts p ON r.target_type = 'post' AND p.id = r.target_id
        LEFT JOIN public.community_replies reply ON r.target_type = 'reply' AND reply.id = r.target_id
        WHERE r.status = 'open'
        ORDER BY r.created_at ASC
        LIMIT 100
      `;
      return response.status(200).json({ reports });
    }

    if (parts[0] === 'reports' && method === 'POST') {
      assertMember(user);
      await checkRateLimit(sql, `report:${user.id}`, 20, 3600);
      const body = getBody(request);
      const targetType = body.targetType;
      const targetId = Number(body.targetId);
      const reason = body.reason;
      const details = cleanText(body.details, 500) || null;
      if (!['post', 'reply'].includes(targetType) || !Number.isSafeInteger(targetId) || targetId < 1) fail(400, 'Invalid report target.');
      if (!['spam', 'harassment', 'unsafe_advice', 'misinformation', 'other'].includes(reason)) fail(400, 'Choose a report reason.');
      const target = targetType === 'post'
        ? await sql`SELECT id FROM public.community_posts WHERE id = ${targetId}`
        : await sql`SELECT id FROM public.community_replies WHERE id = ${targetId}`;
      if (!target[0]) fail(404, 'Content not found.');
      try {
        await sql`INSERT INTO public.community_reports (reporter_id, target_type, target_id, reason, details) VALUES (${user.id}, ${targetType}, ${targetId}, ${reason}, ${details})`;
      } catch (error) {
        if (error.code === '23505') fail(409, 'You already reported this content.');
        throw error;
      }
      return response.status(201).json({ ok: true });
    }

    if (parts[0] === 'moderation' && parts.length === 1 && method === 'POST') {
      assertModerator(user);
      const body = getBody(request);
      const reportId = Number(body.reportId);
      const action = body.action;
      if (!Number.isSafeInteger(reportId) || reportId < 1 || !['hide', 'restore', 'lock', 'unlock', 'dismiss'].includes(action)) fail(400, 'Invalid moderation action.');
      const reportRows = await sql`SELECT target_type, target_id FROM public.community_reports WHERE id = ${reportId} AND status = 'open'`;
      if (!reportRows[0] && action !== 'dismiss') fail(404, 'Open report not found.');
      const report = reportRows[0];
      if (action === 'dismiss') {
        const changed = await sql`UPDATE public.community_reports SET status = 'dismissed', reviewed_by = ${user.id}, reviewed_at = now() WHERE id = ${reportId} AND status = 'open' RETURNING id`;
        if (!changed[0]) fail(404, 'Open report not found.');
      } else {
        if (report.target_type === 'post') {
          const status = action === 'hide' ? 'hidden' : action === 'restore' ? 'published' : null;
          if (status) await sql`UPDATE public.community_posts SET status = ${status}, updated_at = now() WHERE id = ${report.target_id}`;
          if (action === 'lock' || action === 'unlock') await sql`UPDATE public.community_posts SET is_locked = ${action === 'lock'}, updated_at = now() WHERE id = ${report.target_id}`;
        } else {
          if (action === 'hide' || action === 'restore') {
            const status = action === 'hide' ? 'hidden' : 'published';
            await sql`UPDATE public.community_replies SET status = ${status}, updated_at = now() WHERE id = ${report.target_id}`;
          } else fail(400, 'Replies can be hidden or restored, not locked.');
        }
        await sql`UPDATE public.community_reports SET status = 'actioned', reviewed_by = ${user.id}, reviewed_at = now() WHERE id = ${reportId}`;
      }
      return response.status(200).json({ ok: true });
    }

    if (parts.length === 1 && method === 'GET') {
      const locationId = parts[0];
      if (!/^[a-z0-9-]{1,80}$/.test(locationId)) fail(400, 'Invalid location.');
      const location = await sql`SELECT id FROM public.locations WHERE id = ${locationId} AND is_published = true LIMIT 1`;
      if (!location[0]) fail(404, 'Location not found.');
      const posts = await sql`
        SELECT p.id, p.title, p.body, p.is_locked AS "isLocked", p.created_at AS "createdAt",
               u.display_name AS "displayName", COUNT(r.id)::int AS "replyCount"
        FROM public.community_posts p
        JOIN public.community_users u ON u.id = p.user_id
        LEFT JOIN public.community_replies r ON r.post_id = p.id AND r.status = 'published'
        WHERE p.location_id = ${locationId} AND p.status = 'published'
        GROUP BY p.id, u.display_name
        ORDER BY p.created_at DESC
        LIMIT 50
      `;
      const postIds = posts.map(post => post.id);
      const replies = postIds.length ? await sql`
        SELECT r.id, r.post_id AS "postId", r.body, r.created_at AS "createdAt", u.display_name AS "displayName"
        FROM public.community_replies r JOIN public.community_users u ON u.id = r.user_id
        WHERE r.post_id = ANY(${postIds}) AND r.status = 'published'
        ORDER BY r.created_at ASC
      ` : [];
      const repliesByPost = new Map();
      for (const reply of replies) {
        const list = repliesByPost.get(reply.postId) ?? [];
        if (list.length < 20) list.push(reply);
        repliesByPost.set(reply.postId, list);
      }
      return response.status(200).json({
        user: publicUser(user),
        posts: posts.map(post => ({ ...post, replies: repliesByPost.get(post.id) ?? [] })),
      });
    }

    if (parts.length === 2 && parts[1] === 'posts' && method === 'POST') {
      assertMember(user);
      const locationId = parts[0];
      await checkRateLimit(sql, `post:${user.id}`, 10, 3600);
      const body = getBody(request);
      const title = cleanText(body.title, 120);
      const content = cleanText(body.body, 5000);
      if (title.length < 4 || content.length < 10) fail(400, 'Posts need a title (4+ characters) and details (10+ characters).');
      const location = await sql`SELECT id FROM public.locations WHERE id = ${locationId} AND is_published = true LIMIT 1`;
      if (!location[0]) fail(404, 'Location not found.');
      const created = await sql`INSERT INTO public.community_posts (location_id, user_id, title, body) VALUES (${locationId}, ${user.id}, ${title}, ${content}) RETURNING id`;
      return response.status(201).json({ id: created[0].id });
    }

    if (parts.length === 3 && parts[0] === 'posts' && parts[2] === 'replies' && method === 'POST') {
      assertMember(user);
      const postId = Number(parts[1]);
      if (!Number.isSafeInteger(postId) || postId < 1) fail(400, 'Invalid discussion.');
      await checkRateLimit(sql, `reply:${user.id}`, 40, 3600);
      const content = cleanText(getBody(request).body, 3000);
      if (content.length < 2) fail(400, 'Reply must contain at least 2 characters.');
      const post = await sql`SELECT p.id FROM public.community_posts p JOIN public.locations l ON l.id = p.location_id WHERE p.id = ${postId} AND p.status = 'published' AND p.is_locked = false AND l.is_published = true`;
      if (!post[0]) fail(404, 'Discussion is unavailable or locked.');
      const created = await sql`INSERT INTO public.community_replies (post_id, user_id, body) VALUES (${postId}, ${user.id}, ${content}) RETURNING id`;
      return response.status(201).json({ id: created[0].id });
    }

    response.setHeader('Allow', 'GET, POST');
    return response.status(404).json({ error: 'Community endpoint not found.' });
  } catch (error) {
    const status = error.status ?? (error.statusCode === 503 ? 503 : 500);
    if (status >= 500) console.error('Community API request failed:', error.message);
    return response.status(status).json({ error: status >= 500 ? 'Community service is temporarily unavailable.' : error.message });
  }
}
