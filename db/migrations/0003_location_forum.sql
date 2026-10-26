-- Location discussion accounts, sessions, posts, replies, reports and moderation.
create table if not exists public.community_users (
  id bigint generated always as identity primary key,
  email text not null,
  display_name text not null,
  password_hash text not null,
  role text not null default 'member' check (role in ('member', 'moderator', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email)
);

create table if not exists public.community_sessions (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.community_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists community_sessions_user_expiry_idx on public.community_sessions (user_id, expires_at);

create table if not exists public.community_posts (
  id bigint generated always as identity primary key,
  location_id text not null references public.locations(id) on delete cascade,
  user_id bigint not null references public.community_users(id),
  title text not null,
  body text not null,
  status text not null default 'published' check (status in ('published', 'hidden', 'removed')),
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists community_posts_location_created_idx on public.community_posts (location_id, created_at desc) where status = 'published';

create table if not exists public.community_replies (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.community_posts(id) on delete cascade,
  user_id bigint not null references public.community_users(id),
  body text not null,
  status text not null default 'published' check (status in ('published', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists community_replies_post_created_idx on public.community_replies (post_id, created_at) where status = 'published';

create table if not exists public.community_reports (
  id bigint generated always as identity primary key,
  reporter_id bigint not null references public.community_users(id),
  target_type text not null check (target_type in ('post', 'reply')),
  target_id bigint not null,
  reason text not null check (reason in ('spam', 'harassment', 'unsafe_advice', 'misinformation', 'other')),
  details text,
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  reviewed_by bigint references public.community_users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);
create index if not exists community_reports_open_idx on public.community_reports (created_at) where status = 'open';

-- Simple persistent limits for login, registration and write endpoints.
create table if not exists public.community_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);
