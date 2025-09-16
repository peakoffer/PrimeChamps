-- Update the form_submissions table to support partner type
DO $$
BEGIN
  -- Check if we need to update the type constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name LIKE '%form_submissions_type_check%'
    AND check_clause NOT LIKE '%partner%'
  ) THEN
    -- Drop the old constraint
    ALTER TABLE public.form_submissions DROP CONSTRAINT IF EXISTS form_submissions_type_check;
    
    -- Add the new constraint with partner type
    ALTER TABLE public.form_submissions ADD CONSTRAINT form_submissions_type_check 
    CHECK (type IN ('athlete', 'brand', 'partner'));
  END IF;
END $$;
