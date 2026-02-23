import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LeadCaptureProvider } from "@/contexts/LeadCaptureContext";
import { LeadCaptureModal } from "@/components/lead-capture/LeadCaptureModal";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PublicOnlyRoute } from "@/components/auth/PublicOnlyRoute";
import { MarketingLayout } from "@/components/layout/MarketingLayout";

// Public pages
import LandingPage from "./pages/LandingPage";
import Demos from "./pages/Demos";
import Pricing from "./pages/Pricing";
import Contact from "./pages/Contact";
import FAQ from "./pages/FAQ";
import Auth from "./pages/Auth";
import Install from "./pages/Install";
import ClientPortal from "./pages/ClientPortal";
import EmbedWidget from "./pages/EmbedWidget";
import NotFound from "./pages/NotFound";

// Protected pages (app)
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import Analytics from "./pages/Analytics";
import AdminPanel from "./pages/AdminPanel";
import JurisdictionAdmin from "./pages/JurisdictionAdmin";
import FeatureFlagsAdmin from "./pages/FeatureFlagsAdmin";
import JurisdictionComparison from "./pages/JurisdictionComparison";
import JurisdictionMapPage from "./pages/JurisdictionMapPage";
import PermitIntelligence from "./pages/PermitIntelligence";
import CodeCompliance from "./pages/CodeCompliance";
import CodeReferenceLibrary from "./pages/CodeReferenceLibrary";
import ROICalculator from "./pages/ROICalculator";
import ConsolidationCalculator from "./pages/ConsolidationCalculator";
import StateLandingPage from "./pages/StateLandingPage";
import MVPDocumentation from "./pages/MVPDocumentation";
import APIDocumentation from "./pages/APIDocumentation";
import ChecklistHistory from "./pages/ChecklistHistory";
import Settings from "./pages/Settings";
import CommentReview from "./pages/CommentReview";
import ResponseMatrix from "./pages/ResponseMatrix";
import PortalDataViewer from "./pages/PortalDataViewer";
import ClassifiedComments from "./pages/ClassifiedComments";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <AuthProvider>
          <LeadCaptureProvider>
            <Toaster />
            <Sonner />
            <OfflineIndicator />
            <InstallPrompt />
            <LeadCaptureModal />
            <BrowserRouter>
              <Routes>
                {/* Public marketing pages */}
                <Route
                  path="/"
                  element={
                    <PublicOnlyRoute>
                      <LandingPage />
                    </PublicOnlyRoute>
                  }
                />
                <Route path="/auth" element={<Auth />} />
                <Route
                  path="/demos"
                  element={
                    <MarketingLayout>
                      <Demos />
                    </MarketingLayout>
                  }
                />
                <Route
                  path="/pricing"
                  element={
                    <MarketingLayout>
                      <Pricing />
                    </MarketingLayout>
                  }
                />
                <Route
                  path="/contact"
                  element={
                    <MarketingLayout>
                      <Contact />
                    </MarketingLayout>
                  }
                />
                <Route
                  path="/faq"
                  element={
                    <MarketingLayout>
                      <FAQ />
                    </MarketingLayout>
                  }
                />
                <Route path="/install" element={<Install />} />
                <Route path="/portal/:token" element={<ClientPortal />} />
                <Route path="/embed/:token" element={<EmbedWidget />} />

                {/* Protected app pages */}
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/projects"
                  element={
                    <ProtectedRoute>
                      <Projects />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/analytics"
                  element={
                    <ProtectedRoute>
                      <Analytics />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/jurisdictions/compare"
                  element={
                    <ProtectedRoute>
                      <JurisdictionComparison />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/jurisdiction-comparison"
                  element={
                    <ProtectedRoute>
                      <JurisdictionComparison />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/jurisdictions/map"
                  element={
                    <ProtectedRoute>
                      <JurisdictionMapPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/jurisdictions/:stateCode"
                  element={
                    <ProtectedRoute>
                      <StateLandingPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/permit-intelligence"
                  element={
                    <ProtectedRoute>
                      <PermitIntelligence />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/code-compliance"
                  element={
                    <ProtectedRoute>
                      <CodeCompliance />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/code-reference"
                  element={
                    <ProtectedRoute>
                      <CodeReferenceLibrary />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/roi-calculator"
                  element={
                    <ProtectedRoute>
                      <ROICalculator />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/consolidation-calculator"
                  element={
                    <ProtectedRoute>
                      <ConsolidationCalculator />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute>
                      <AdminPanel />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/jurisdictions"
                  element={
                    <ProtectedRoute>
                      <JurisdictionAdmin />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/feature-flags"
                  element={
                    <ProtectedRoute>
                      <FeatureFlagsAdmin />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/mvp-documentation"
                  element={
                    <ProtectedRoute>
                      <MVPDocumentation />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/api-docs"
                  element={
                    <ProtectedRoute>
                      <APIDocumentation />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/checklist-history"
                  element={
                    <ProtectedRoute>
                      <ChecklistHistory />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <Settings />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/comment-review"
                  element={
                    <ProtectedRoute>
                      <CommentReview />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/response-matrix"
                  element={
                    <ProtectedRoute>
                      <ResponseMatrix />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/classified-comments"
                  element={
                    <ProtectedRoute>
                      <ClassifiedComments />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/portal-data"
                  element={
                    <ProtectedRoute>
                      <PortalDataViewer />
                    </ProtectedRoute>
                  }
                />

                {/* 404 */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </LeadCaptureProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
