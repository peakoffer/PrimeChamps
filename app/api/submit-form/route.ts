import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Validate environment variables
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request: Request) {
  try {
    const data = await request.json();
    
    // Insert into Supabase
    const { error: supabaseError } = await supabase
      .from('submissions')
      .insert([{
        type: data.type,
        name: data.name,
        email: data.email,
        sport: data.type === 'athlete' ? data.sport : null,
        social_following: data.type === 'athlete' ? data.socialFollowing : null,
        company: data.type === 'brand' ? data.company : null,
        budget: data.type === 'brand' ? data.budget : null,
        message: data.message || null
      }]);

    if (supabaseError) {
      console.error('Supabase error:', supabaseError);
      return NextResponse.json(
        { error: 'Database error: ' + supabaseError.message },
        { status: 500 }
      );
    }

    // Only attempt to send email if RESEND_API_KEY is configured
    if (process.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Prime Champs <info@prime-champs.com>',
            to: 'info@prime-champs.com',
            subject: `New ${data.type} Submission`,
            html: `
              <h2>New ${data.type} Submission</h2>
              <p><strong>Name:</strong> ${data.name}</p>
              <p><strong>Email:</strong> ${data.email}</p>
              ${data.type === 'athlete' ? `
                <p><strong>Sport:</strong> ${data.sport}</p>
                <p><strong>Social Media Following:</strong> ${data.socialFollowing}</p>
              ` : `
                <p><strong>Company:</strong> ${data.company}</p>
                <p><strong>Budget Range:</strong> ${data.budget}</p>
              `}
              <p><strong>Message:</strong> ${data.message || 'No message provided'}</p>
            `
          })
        });
      } catch (emailError) {
        // Log email error but don't fail the submission
        console.error('Email notification failed:', emailError);
      }
    }

    return NextResponse.json(
      { message: 'Form submitted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Form submission error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + (error as Error).message },
      { status: 500 }
    );
  }
}