-- Stage 5: email ownership, recovery tokens and account-synced saved waters.
alter table public.community_users
  add column if not exists email_verified_at timestamptz;

create table if not exists public.community_auth_tokens (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.community_users(id) on delete cascade,
  token_hash text not null unique,
  token_type text not null check (token_type in ('verify_email', 'password_reset')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists community_auth_tokens_user_type_idx
  on public.community_auth_tokens(user_id, token_type, expires_at desc)
  where consumed_at is null;

create table if not exists public.community_saved_locations (
  user_id bigint not null references public.community_users(id) on delete cascade,
  location_id text not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, location_id)
);
