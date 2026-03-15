-- ============================================================
-- Column constraints for courses, assignments, assignment_groups,
-- app_settings, and schedule_overrides
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── courses ──
ALTER TABLE courses
  ALTER COLUMN name SET NOT NULL,
  ADD CONSTRAINT courses_name_len CHECK (char_length(name) <= 100),
  ADD CONSTRAINT courses_teacher_len CHECK (teacher IS NULL OR char_length(teacher) <= 100),
  ADD CONSTRAINT courses_canvas_url_len CHECK (canvas_url IS NULL OR char_length(canvas_url) <= 500),
  ADD CONSTRAINT courses_note_len CHECK (note IS NULL OR char_length(note) <= 500),
  ADD CONSTRAINT courses_color_len CHECK (color IS NULL OR char_length(color) <= 20);

-- ── assignment_groups ──
ALTER TABLE assignment_groups
  ALTER COLUMN label SET NOT NULL,
  ADD CONSTRAINT ag_label_len CHECK (char_length(label) <= 100);

-- ── assignments ──
ALTER TABLE assignments
  ALTER COLUMN name SET NOT NULL,
  ADD CONSTRAINT assignments_name_len CHECK (char_length(name) <= 200),
  ADD CONSTRAINT assignments_url_len CHECK (url IS NULL OR char_length(url) <= 500),
  ADD CONSTRAINT assignments_notes_len CHECK (notes IS NULL OR char_length(notes) <= 1000),
  ADD CONSTRAINT assignments_type_check CHECK (
    type IS NULL OR type IN ('reading','homework','project','quiz','classwork')
  );

-- ── app_settings ──
ALTER TABLE app_settings
  ALTER COLUMN key SET NOT NULL,
  ADD CONSTRAINT app_settings_key_len CHECK (char_length(key) <= 100),
  ADD CONSTRAINT app_settings_value_len CHECK (value IS NULL OR char_length(value) <= 500);

-- ── schedule_overrides ──
ALTER TABLE schedule_overrides
  ALTER COLUMN date SET NOT NULL,
  ALTER COLUMN label SET NOT NULL,
  ADD CONSTRAINT so_label_len CHECK (char_length(label) <= 100);
