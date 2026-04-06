-- Fix attendance_200 badge emoji: change black square (⬛) to black circle (⚫)
-- to match the round shape of other attendance badges (🟡, 🟠, 🟢)
UPDATE public.badge_definitions
SET emoji = '⚫'
WHERE id = 'attendance_200';
