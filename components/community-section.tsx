"use client";

import { TypeAnimation } from 'react-type-animation';

export default function CommunitySection() {
  return (
    <section className="py-32 bg-primary/5">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-8 tracking-tighter">
            We are powered by{' '}
            <span className="gradient-text">
              <TypeAnimation
                sequence={[
                  'Champions',
                  2000,
                  'Creators',
                  2000,
                  'Innovators',
                  2000,
                  'Game Changers',
                  2000,
                ]}
                wrapper="span"
                speed={50}
                repeat={Infinity}
              />
            </span>
          </h2>
          <p className="text-xl text-muted-foreground leading-relaxed mb-12">
            Collaborating with a vibrant community of rising stars who are shaping 
            the future of sports culture. Our network drives every partnership, 
            every campaign, and every success story.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6 rounded-2xl bg-white shadow-xl shadow-primary/5">
              <div className="text-4xl font-bold mb-2 gradient-text">28</div>
              <div className="text-muted-foreground">Active Athletes</div>
            </div>
            <div className="p-6 rounded-2xl bg-white shadow-xl shadow-primary/5">
              <div className="text-4xl font-bold mb-2 gradient-text">8</div>
              <div className="text-muted-foreground">Sports Categories</div>
            </div>
            <div className="p-6 rounded-2xl bg-white shadow-xl shadow-primary/5">
              <div className="text-4xl font-bold mb-2 gradient-text">85%</div>
              <div className="text-muted-foreground">Partnership Success Rate</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}