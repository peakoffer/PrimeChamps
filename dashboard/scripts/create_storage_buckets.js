require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createBuckets() {
  const buckets = [
    { name: 'profile-pics', public: true },
    { name: 'athlete-posts', public: true },
  ];

  for (const bucket of buckets) {
    try {
      const { data, error } = await supabase.storage.createBucket(bucket.name, {
        public: bucket.public,
        fileSizeLimit: 10485760, // 10MB
      });

      if (error) {
        if (error.message.includes('already exists')) {
          console.log(`✓ Bucket '${bucket.name}' already exists`);
        } else {
          console.error(`✗ Error creating '${bucket.name}':`, error.message);
        }
      } else {
        console.log(`✓ Created bucket '${bucket.name}'`);
      }
    } catch (e) {
      console.error(`✗ Exception for '${bucket.name}':`, e.message);
    }
  }
}

createBuckets().then(() => {
  console.log('\nDone!');
  process.exit(0);
});
