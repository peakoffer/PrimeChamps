"use client"

import { useEffect, useState } from "react"

// Updated with working video URLs
const videos = [
  "https://cdn.coverr.co/videos/coverr-woman-doing-yoga-5723/1080p.mp4",
  "https://cdn.coverr.co/videos/coverr-woman-working-out-4584/1080p.mp4",
  "https://cdn.coverr.co/videos/coverr-woman-exercising-2683/1080p.mp4",
]

export default function HeroVideo() {
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentVideoIndex((prev) => (prev + 1) % videos.length)
    }, 6000) // Switch every 6 seconds

    return () => clearInterval(interval)
  }, [])

  return (
    <>
      <div className="absolute inset-0 w-full h-full overflow-hidden">
        {videos.map((video, index) => (
          <video
            key={video}
            autoPlay
            muted
            loop
            playsInline
            className={`absolute inset-0 object-cover w-full h-full scale-[1.02] transition-opacity duration-1000 ${
              index === currentVideoIndex ? "opacity-100" : "opacity-0"
            }`}
            style={{ filter: "brightness(0.95)" }}
          >
            <source src={video} type="video/mp4" />
          </video>
        ))}
      </div>
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to bottom, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.7) 100%)",
          mixBlendMode: "overlay",
        }}
      />
      <div
        className="absolute inset-0 opacity-20"
        style={{
          background: "linear-gradient(45deg, var(--primary) 0%, var(--secondary) 100%)",
          mixBlendMode: "overlay",
        }}
      />
    </>
  )
}
