-- The 200-trainings badge used a square (⬛) while every other attendance
-- milestone uses a coloured circle. Switch it to the black circle.
UPDATE public.badge_definitions SET emoji = '⚫' WHERE id = 'attendance_200';
