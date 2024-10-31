export default function StatsSection() {
  return (
    <section className="py-32 bg-gradient-to-r from-primary/10 via-secondary/10 to-accent/10">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12 text-center">
          <div className="group">
            <div className="text-5xl md:text-6xl font-bold mb-4 tracking-tighter transition-transform duration-300 group-hover:scale-110 gradient-text">28</div>
            <div className="text-foreground/80 text-lg">Rising Stars<br/><span className="text-sm opacity-75">(and counting!)</span></div>
          </div>
          <div className="group">
            <div className="text-4xl md:text-5xl font-bold mb-4 tracking-tighter transition-transform duration-300 group-hover:scale-110 gradient-text">1.2M</div>
            <div className="text-foreground/80 text-lg">In Deals<br/><span className="text-sm opacity-75">(that's a lot of protein shakes)</span></div>
          </div>
          <div className="group relative">
            <div className="text-5xl md:text-6xl font-bold mb-4 tracking-tighter transition-transform duration-300 group-hover:scale-110 gradient-text">16</div>
            <div className="text-foreground/80 text-lg">Brand Partners<br/>
              <span className="text-sm opacity-0 group-hover:opacity-100 transition-all duration-300 absolute left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap bg-primary/10 px-3 py-1 rounded-full text-primary">
                +5 coming soon! 🚀
              </span>
            </div>
          </div>
          <div className="group">
            <div className="text-5xl md:text-6xl font-bold mb-4 tracking-tighter transition-transform duration-300 group-hover:scale-110 gradient-text">8</div>
            <div className="text-foreground/80 text-lg">Sports Categories<br/><span className="text-sm opacity-75">(from kickflips to knockouts)</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}