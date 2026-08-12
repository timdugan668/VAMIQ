create table schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  session_type text not null,
  title text not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, date)
);
alter table schedule_overrides enable row level security;
create policy "Users can view own overrides" on schedule_overrides for select using (auth.uid() = user_id);
create policy "Users can delete own overrides" on schedule_overrides for delete using (auth.uid() = user_id);
