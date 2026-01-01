-- Create lesson_plans table
CREATE TABLE IF NOT EXISTS public.lesson_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trainingId" smallint NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  date        text NOT NULL,
  title       text,
  content     text, -- Now optional for backward compatibility
  file_name   text, -- Original filename
  file_path   text, -- Storage path
  file_type   text, -- MIME type
  file_size   bigint, -- File size in bytes
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id),
  UNIQUE ("trainingId", date),
  -- Ensure either content or file is provided
  CONSTRAINT lesson_plan_content_or_file_check CHECK (
    (content IS NOT NULL AND content != '') OR 
    (file_path IS NOT NULL AND file_path != '')
  )
);

-- Create RLS policies
ALTER TABLE public.lesson_plans ENABLE ROW LEVEL SECURITY;

-- Policy to allow authenticated users to read all lesson plans
CREATE POLICY "Allow authenticated users to read lesson plans" ON public.lesson_plans
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy to allow authenticated users to insert lesson plans
CREATE POLICY "Allow authenticated users to create lesson plans" ON public.lesson_plans
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Policy to allow authenticated users to update lesson plans
CREATE POLICY "Allow authenticated users to update lesson plans" ON public.lesson_plans
    FOR UPDATE
    TO authenticated
    USING (true);

-- Policy to allow authenticated users to delete lesson plans
CREATE POLICY "Allow authenticated users to delete lesson plans" ON public.lesson_plans
    FOR DELETE
    TO authenticated
    USING (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_lesson_plans_updated_at BEFORE UPDATE
    ON public.lesson_plans FOR EACH ROW EXECUTE PROCEDURE 
    update_updated_at_column();

-- Create storage bucket for lesson plan files
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'lesson-plans', 
    'lesson-plans', 
    false, -- Private bucket
    52428800, -- 50MB limit
    ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/jpg', 
        'image/png',
        'image/webp',
        'image/gif',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
    ]
) ON CONFLICT (id) DO NOTHING;

-- Storage policies for lesson-plans bucket
CREATE POLICY "Authenticated users can upload lesson plan files" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'lesson-plans');

CREATE POLICY "Authenticated users can view lesson plan files" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'lesson-plans');

CREATE POLICY "Authenticated users can update lesson plan files" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (bucket_id = 'lesson-plans');

CREATE POLICY "Authenticated users can delete lesson plan files" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'lesson-plans');
