-- Migration: Add athlete_posts table to store Instagram posts
-- This stores the last 10 posts for each athlete during research

-- Create athlete_posts table
CREATE TABLE IF NOT EXISTS athlete_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    post_id TEXT NOT NULL,  -- Instagram's post ID
    post_url TEXT NOT NULL,  -- Full URL to the post
    image_url TEXT NOT NULL,  -- URL to the image (stored in Supabase storage)
    caption TEXT,
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    post_type TEXT DEFAULT 'image',  -- image, video, carousel
    posted_at TIMESTAMPTZ,
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(athlete_id, post_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_athlete_posts_athlete_id ON athlete_posts(athlete_id);
CREATE INDEX IF NOT EXISTS idx_athlete_posts_scraped_at ON athlete_posts(scraped_at);

-- Enable RLS
ALTER TABLE athlete_posts ENABLE ROW LEVEL SECURITY;

-- Policy
CREATE POLICY "Allow all for athlete_posts" ON athlete_posts FOR ALL USING (true);

-- Add column to athletes to track if posts have been scraped
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS posts_scraped_at TIMESTAMPTZ;
