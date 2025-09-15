-- This function will be called to create the form_submissions table if it doesn't exist
CREATE OR REPLACE FUNCTION create_submissions_table()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if the table already exists
  IF NOT EXISTS (
    SELECT FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'form_submissions'
  ) THEN
    -- Create the table
    CREATE TABLE public.form_submissions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      type TEXT NOT NULL CHECK (type IN ('athlete', 'brand')),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT,
      
      -- Athlete specific fields
      sport TEXT,
      other_sport TEXT,
      experience TEXT,
      social_following TEXT,
      instagram TEXT,
      tiktok TEXT,
      youtube TEXT,
      twitter TEXT,
      achievements TEXT,
      sponsorships TEXT,
      goals TEXT,
      
      -- Brand specific fields
      company TEXT,
      role TEXT,
      website TEXT,
      industry TEXT,
      budget TEXT,
      target_sports TEXT,
      campaign_goals TEXT,
      target_audience TEXT,
      timeline TEXT,
      
      -- Metadata
      ip_address TEXT,
      user_agent TEXT,
      referrer TEXT,
      status TEXT CHECK (status IN ('new', 'contacted', 'qualified', 'rejected')) DEFAULT 'new'
    );
    
    -- Add RLS policies
    ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
    
    -- Create policy to allow authenticated users to read all submissions
    CREATE POLICY "Allow authenticated users to read submissions"
      ON public.form_submissions
      FOR SELECT
      TO authenticated
      USING (true);
      
    -- Create policy to allow service role to insert
    CREATE POLICY "Allow service role to insert submissions"
      ON public.form_submissions
      FOR INSERT
      TO service_role
      USING (true);
      
    -- Create policy to allow service role to update
    CREATE POLICY "Allow service role to update submissions"
      ON public.form_submissions
      FOR UPDATE
      TO service_role
      USING (true);
  END IF;
END;
$$;
