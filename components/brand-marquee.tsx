"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const brands = [
  {
    name: "Nike",
    logo: "https://upload.wikimedia.org/wikipedia/commons/a/a6/Logo_NIKE.svg",
    width: 80,
    height: 30,
    darkMode: false
  },
  {
    name: "Red Bull",
    logo: "https://upload.wikimedia.org/wikipedia/en/f/f5/RedBullEnergyDrink.svg",
    width: 80,
    height: 30,
    darkMode: false
  },
  {
    name: "Gymshark",
    logo: "https://upload.wikimedia.org/wikipedia/commons/c/c5/Gymshark_logo.svg",
    width: 100,
    height: 35,
    darkMode: true
  },
  {
    name: "OnlyFans",
    logo: "https://upload.wikimedia.org/wikipedia/en/c/cc/OnlyFans_logo.svg",
    width: 100,
    height: 35,
    darkMode: false
  },
  {
    name: "RVCA",
    logo: "https://upload.wikimedia.org/wikipedia/commons/a/a4/RVCA_logo.svg",
    width: 80,
    height: 30,
    darkMode: false
  },
  {
    name: "Adidas",
    logo: "https://upload.wikimedia.org/wikipedia/commons/2/20/Adidas_Logo.svg",
    width: 80,
    height: 30,
    darkMode: false
  },
  {
    name: "Under Armour",
    logo: "https://upload.wikimedia.org/wikipedia/commons/4/44/Under_armour_logo.svg",
    width: 80,
    height: 30,
    darkMode: false
  },
  {
    name: "Quiksilver",
    logo: "https://upload.wikimedia.org/wikipedia/en/c/c6/Quiksilver-brand.svg",
    width: 80,
    height: 30,
    darkMode: false
  },
  {
    name: "Bauer",
    logo: "https://upload.wikimedia.org/wikipedia/commons/6/6c/Bauer_logo.svg",
    width: 80,
    height: 30,
    darkMode: true
  },
  {
    name: "Venum",
    logo: "https://upload.wikimedia.org/wikipedia/en/0/03/Venum_Logo.png",
    width: 80,
    height: 30,
    darkMode: false
  },
  {
    name: "Pepsi",
    logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Pepsi_2023.svg/1920px-Pepsi_2023.svg.png",
    width: 80,
    height: 30,
    darkMode: false
  }
];

export default function BrandMarquee() {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) return null;

  return (
    <div className="brand-marquee-container py-8 overflow-hidden">
      <div className="relative flex overflow-x-hidden">
        <div className="brand-scroll flex items-center">
          {[...brands, ...brands].map((brand, index) => (
            <div
              key={`${brand.name}-${index}`}
              className="flex shrink-0 items-center justify-center mx-8 grayscale hover:grayscale-0 transition-all duration-300 hover:scale-110"
              style={{ width: '140px' }}
            >
              <Image
                src={brand.logo}
                alt={`${brand.name} logo`}
                width={brand.width}
                height={brand.height}
                className={`object-contain ${brand.darkMode ? 'invert' : ''}`}
                priority
                unoptimized
              />
            </div>
          ))}
        </div>
        <div className="brand-scroll flex items-center" aria-hidden="true">
          {[...brands, ...brands].map((brand, index) => (
            <div
              key={`${brand.name}-duplicate-${index}`}
              className="flex shrink-0 items-center justify-center mx-8 grayscale hover:grayscale-0 transition-all duration-300 hover:scale-110"
              style={{ width: '140px' }}
            >
              <Image
                src={brand.logo}
                alt={`${brand.name} logo`}
                width={brand.width}
                height={brand.height}
                className={`object-contain ${brand.darkMode ? 'invert' : ''}`}
                priority
                unoptimized
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}