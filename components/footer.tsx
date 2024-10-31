import { Instagram } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-background border-t">
      <div className="container mx-auto px-4 py-12">
        <div className="text-center space-y-6">
          <div className="space-y-4">
            <h3 className="text-2xl font-bold">PRIME CHAMPS</h3>
            <p className="text-muted-foreground">
              Representing and developing the next generation of sporting excellence.
            </p>
          </div>
          
          <div className="space-y-2 text-muted-foreground">
            <p>info@prime-champs.com</p>
          </div>
          
          <div className="flex justify-center">
            <a 
              href="https://www.instagram.com/primechamps/" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="hover:text-primary transition-colors"
            >
              <Instagram size={24} />
            </a>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t text-center text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Prime Champs. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}