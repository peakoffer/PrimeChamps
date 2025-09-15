"use client"

import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"
import { TypeAnimation } from "react-type-animation"
import { motion } from "framer-motion"
import { useState } from "react"
import PopupForm from "./popup-form"
import HeroVideo from "./hero-video"

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2,
      delayChildren: 0.3,
    },
  },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.8,
      ease: [0.04, 0.62, 0.23, 0.98],
    },
  },
}

export default function HeroSection() {
  const [isFormOpen, setIsFormOpen] = useState(false)

  return (
    <>
      <section className="min-h-screen flex items-center justify-center relative overflow-hidden">
        <HeroVideo />
        <motion.div
          className="text-center px-4 max-w-4xl mx-auto space-y-8 relative z-10 text-foreground"
          variants={container}
          initial="hidden"
          animate="show"
        >
          <motion.div variants={item}>
            <h1 className="text-5xl md:text-7xl font-bold mb-8 tracking-tighter leading-tight">
              Connecting Athletes to{" "}
              <span className="gradient-text">
                <TypeAnimation
                  sequence={["Brand Deals", 2000, "Partnerships", 2000, "Opportunities", 2000]}
                  wrapper="span"
                  speed={50}
                  repeat={Number.POSITIVE_INFINITY}
                />
              </span>
              <br />
              That Transform Careers
            </h1>
          </motion.div>

          <motion.p variants={item} className="text-xl md:text-2xl mb-12 text-foreground/80 leading-relaxed">
            We bridge the gap between athletes and brands, creating lucrative partnerships that elevate both your
            influence and income.
          </motion.p>

          <motion.div variants={item}>
            <Button
              size="lg"
              onClick={() => setIsFormOpen(true)}
              className="text-lg px-8 py-6 rounded-full hover:scale-105 transition-all duration-300 bg-gradient-to-r from-accent via-secondary to-primary hover:shadow-xl"
            >
              Start Your Journey <Sparkles className="ml-2" />
            </Button>
          </motion.div>
        </motion.div>
      </section>
      <PopupForm open={isFormOpen} onOpenChange={setIsFormOpen} />
    </>
  )
}
