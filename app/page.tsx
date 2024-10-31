import BrandMarquee from "@/components/brand-marquee";
import CommunitySection from "@/components/community-section";
import HeroSection from "@/components/hero-section";
import ImageGallery from "@/components/image-gallery";
import ServicesSection from "@/components/services-section";
import StatsSection from "@/components/stats-section";

export default function Home() {
  return (
    <>
      <HeroSection />

      <section className="relative">
        <div className="text-center py-16">
          <h2 className="text-3xl font-bold mb-4 tracking-tighter">Trusted by Global Brands</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto px-4">
            Partnering with the world's leading brands to create meaningful collaborations.
          </p>
        </div>
        <BrandMarquee />
      </section>

      <ServicesSection />
      <ImageGallery />
      <CommunitySection />
      <StatsSection />
    </>
  );
}