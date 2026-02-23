import { PublicMarketingLayout } from "@/components/layout/PublicMarketingLayout";
import { MarketingHeroSection } from "@/components/marketing/MarketingHeroSection";
import { TrustSection } from "@/components/marketing/TrustSection";
import { FeaturesGrid } from "@/components/marketing/FeaturesGrid";
import { StaticMapPreview } from "@/components/marketing/StaticMapPreview";
import { SimpleTestimonials } from "@/components/marketing/SimpleTestimonials";
import { MarketingCTASection } from "@/components/marketing/MarketingCTASection";
import { FAQSection } from "@/components/home/FAQSection";

const LandingPage = () => {
  return (
    <PublicMarketingLayout>
      <MarketingHeroSection />
      <TrustSection />
      <FeaturesGrid />
      <StaticMapPreview />
      <SimpleTestimonials />
      <FAQSection />
      <MarketingCTASection />
    </PublicMarketingLayout>
  );
};

export default LandingPage;
