import { Shield, Trophy, Users, Zap } from "lucide-react";

const services = [
  {
    icon: Users,
    title: "Brand Matchmaking",
    description: "Strategic pairing with brands that align with your values and audience for authentic, lucrative partnerships.",
  },
  {
    icon: Zap,
    title: "Content Strategy",
    description: "Expert guidance on creating engaging content that resonates with brands and grows your following.",
  },
  {
    icon: Shield,
    title: "Deal Protection",
    description: "Comprehensive contract negotiation and partnership terms optimization for maximum value.",
  },
  {
    icon: Trophy,
    title: "Growth Acceleration",
    description: "Proven strategies to increase your market value and attract premium brand opportunities.",
  },
];

export default function ServicesSection() {
  return (
    <section className="py-32 bg-gradient-to-b from-background via-background to-background">
      <div className="container mx-auto px-4">
        <div className="text-center mb-32">
          <h2 className="text-4xl md:text-5xl font-bold mb-10 tracking-tighter gradient-text">
            Full-Service Athlete Management
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            Transforming athletic talent into powerful brand partnerships and sustainable revenue streams.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {services.map((service) => (
            <div
              key={service.title}
              className="group p-6 rounded-2xl transition-all duration-300 hover:shadow-xl hover:shadow-primary/10 bg-white"
            >
              <service.icon className="w-12 h-12 mb-6 text-primary transition-transform duration-300 group-hover:scale-110" />
              <h3 className="text-2xl font-semibold mb-4 tracking-tight">{service.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{service.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}