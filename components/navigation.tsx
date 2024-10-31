"use client";

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import PopupForm from '@/components/popup-form';

export default function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <nav
        className={cn(
          'fixed w-full z-50 transition-all duration-300',
          isScrolled ? 'bg-background/80 backdrop-blur-md py-4' : 'bg-transparent py-6'
        )}
      >
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between">
            <div className="text-2xl font-bold tracking-tighter">
              PRIME CHAMPS
            </div>
            <Button 
              onClick={() => setIsFormOpen(true)}
              className="text-sm bg-accent hover:bg-accent/90 text-accent-foreground transition-all duration-300"
            >
              Partner with Us
            </Button>
          </div>
        </div>
      </nav>
      <PopupForm open={isFormOpen} onOpenChange={setIsFormOpen} />
    </>
  );
}