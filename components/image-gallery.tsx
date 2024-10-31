"use client";

import Image from "next/image";

const images = [
  {
    src: "https://cdn.onefc.com/wp-content/uploads/2021/04/Adriano-Moraes-Demetrious-Johnson-ONE-on-TNT-I-25.jpg",
    size: "large",
    alt: "MMA fight action shot"
  },
  {
    src: "https://external-preview.redd.it/onlyfans-confirmed-as-2024-title-sponsor-of-moto2s-american-v0-aaj46_AQ2fztGFGlxY7VonRwHbSzZpgN-r0GABhP9LY.jpg?auto=webp&s=5e5b0eedbb476e9dab5530bdc33c6e049ea7bdf5",
    size: "small",
    alt: "OnlyFans motorsport sponsorship"
  },
  {
    src: "https://lushpalm.com/wp-content/uploads/2017/11/volcom-pipe-pro.jpg",
    size: "medium",
    alt: "Professional surfing competition"
  },
  {
    src: "https://cdn.pixabay.com/photo/2018/09/23/13/52/rugby-3697512_1280.jpg",
    size: "small",
    alt: "Rugby match action"
  },
  {
    src: "https://snworksceo.imgix.net/ufa/11db96eb-82f6-49a5-a188-f05964a103b8.sized-1000x1000.JPG?h=900&dpr=2",
    size: "large",
    alt: "Female athlete in action"
  }
];

export default function ImageGallery() {
  return (
    <div className="relative w-full py-20 bg-gradient-to-r from-primary/5 via-secondary/5 to-accent/5">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {images.map((image, index) => (
            <div
              key={index}
              className={`relative rounded-xl overflow-hidden transform hover:scale-105 transition-transform duration-300 shadow-xl ${
                image.size === 'large' ? 'col-span-2 row-span-2 h-[600px]' :
                image.size === 'medium' ? 'h-[400px]' :
                'h-[300px]'
              }`}
            >
              <Image
                src={image.src}
                alt={image.alt}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 33vw"
                unoptimized
              />
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-secondary/20 mix-blend-overlay opacity-0 hover:opacity-100 transition-opacity duration-300" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}