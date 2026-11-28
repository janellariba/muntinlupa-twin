-- Muntinlupa Digital Twin: database setup (PostgreSQL / Supabase)
-- Run once in Supabase: SQL Editor -> New query -> paste this file -> Run.
-- Safe to run again: every statement checks whether the object already exists.
--
-- Tables are prefixed twin_ so they never clash with AI-SUNOG tables if both share a database.
-- Row Level Security is ON with no policies: the public API keys cannot read or write anything.
-- The app's Vercel functions connect with DATABASE_URL (database owner), which is not affected by RLS.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- Cameras added in the admin console
create table if not exists twin_cameras (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 40),
  lat         double precision not null check (lat between -90 and 90),
  lon         double precision not null check (lon between -180 and 180),
  cam_index   int not null check (cam_index between 0 and 15),          -- webcam index on the admin device
  heading_deg double precision check (heading_deg >= 0 and heading_deg < 360), -- measured; null = NOT MEASURED
  fov_deg     double precision check (fov_deg > 0 and fov_deg <= 180),         -- measured; null = NOT MEASURED
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Camera names are unique ignoring capitals ("Cam A" and "cam a" count as the same name)
create unique index if not exists twin_cameras_name_unique on twin_cameras (lower(name));

-- One row per saved snapshot: the detection that triggered it and the picture's storage path
create table if not exists twin_detections (
  id            bigserial primary key,
  camera_id     uuid references twin_cameras(id) on delete set null,
  camera_name   text not null,                 -- kept even if the camera is later removed
  class_name    text not null,                 -- fire / smoke (from the model)
  confidence    real not null check (confidence between 0 and 1),
  bbox          jsonb not null,                -- {x1, y1, x2, y2} in frame pixels
  frame_w       int,
  frame_h       int,
  all_boxes     jsonb,                         -- every box in that frame
  bearing_deg   double precision,              -- null when heading/FOV not measured
  from_smoke    boolean not null default false,
  snapshot_path text,                          -- path in the twin-snapshots storage bucket
  detected_at   timestamptz not null default now()
);
create index if not exists twin_detections_camera_time on twin_detections (camera_id, detected_at desc);
create index if not exists twin_detections_time on twin_detections (detected_at desc);

-- Triangulated fire locations
create table if not exists twin_fire_estimates (
  id                 bigserial primary key,
  lat                double precision not null,
  lon                double precision not null,
  ellipse_major_m    real,                     -- 95% error ellipse semi-axes
  ellipse_minor_m    real,
  ellipse_orient_deg real,                     -- clockwise from grid north
  n_rays             int not null,
  max_ray_angle_deg  real,
  residual_rms_deg   real,
  uses_smoke         boolean not null default false,
  rays               jsonb not null,           -- [{camera_id, camera_name, bearing_deg, from_smoke}]
  estimated_at       timestamptz not null default now()
);
create index if not exists twin_fire_estimates_time on twin_fire_estimates (estimated_at desc);

-- Log of manual recordings. The video file itself is saved on the admin laptop, not here.
create table if not exists twin_recordings (
  id          bigserial primary key,
  camera_id   uuid references twin_cameras(id) on delete set null,
  camera_name text not null,
  file_name   text not null,
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  duration_s  real not null,
  size_bytes  bigint,
  saved_on    text not null default 'admin device',
  created_at  timestamptz not null default now()
);
create index if not exists twin_recordings_time on twin_recordings (started_at desc);

alter table twin_cameras        enable row level security;
alter table twin_detections     enable row level security;
alter table twin_fire_estimates enable row level security;
alter table twin_recordings     enable row level security;

-- Private bucket for snapshot pictures (JPEG, max 5 MB each). Pictures are shown through
-- short-lived signed links made by the app, never through public URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('twin-snapshots', 'twin-snapshots', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- Live streaming (Cloudflare Realtime) and the once-a-minute preview picture (added 2026-11-28).
-- live_session / live_track: the admin laptop's Cloudflare publishing session for this camera.
-- live_at: last heartbeat from the admin laptop (stream counts as live while recent).
-- preview_path / preview_at: latest preview picture in the twin-snapshots bucket (overwritten each minute).
alter table twin_cameras add column if not exists live_session text;
alter table twin_cameras add column if not exists live_track   text;
alter table twin_cameras add column if not exists live_at      timestamptz;
alter table twin_cameras add column if not exists preview_path text;
alter table twin_cameras add column if not exists preview_at   timestamptz;

-- Which admin device (laptop) the camera is plugged into (added 2026-11-28). A webcam index only means
-- something on one device: "Laptop A, index 0" and "Laptop B, index 0" are different cameras.
-- Null = not assigned yet (the admin console asks to assign it before running it).
alter table twin_cameras add column if not exists device_name text check (device_name is null or length(device_name) between 1 and 40);
