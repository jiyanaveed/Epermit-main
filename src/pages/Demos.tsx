import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLeadCapture } from "@/contexts/LeadCaptureContext";
import { useAuth } from "@/hooks/useAuth";
import { InteractiveDrawingViewer } from "@/components/demos/InteractiveDrawingViewer";
import { PreSubmittalDetectionDemo } from "@/components/demos/PreSubmittalDetectionDemo";
import { AutoFillDemo } from "@/components/demos/AutoFillDemo";
import { JurisdictionLookupDemo } from "@/components/demos/JurisdictionLookupDemo";
import { PageTransition } from "@/components/animations/PageTransition";
import { Bot, Search, FileText, MapPin, Lock, Play } from "lucide-react";

const demos = [
  {
    id: "compliance",
    title: "Code Compliance Checking",
    description: "Interactive drawing viewer with clickable compliance issues",
    icon: <Bot className="h-6 w-6" />,
  },
  {
    id: "detection",
    title: "Pre-Submittal Detection",
    description: "Identify rejection risks before you submit",
    icon: <Search className="h-6 w-6" />,
  },
  {
    id: "autofill",
    title: "Permit Auto-Fill",
    description: "Watch AI extract data and fill permit forms",
    icon: <FileText className="h-6 w-6" />,
  },
  {
    id: "jurisdiction",
    title: "Jurisdiction Lookup",
    description: "Search and compare jurisdiction requirements",
    icon: <MapPin className="h-6 w-6" />,
  },
];

const Demos = () => {
  const { isLeadCaptured, setShowLeadModal, setPendingDemoId } = useLeadCapture();
  const { subscription } = useAuth();
  const [activeDemo, setActiveDemo] = useState("compliance");
  const [hasAccessedDemo, setHasAccessedDemo] = useState(false);

  // Unlocked: lead captured OR any active paid plan (starter, professional, business, enterprise)
  const hasPaidPlan = subscription.subscribed && subscription.tier != null;
  const isUnlocked = isLeadCaptured || hasPaidPlan;

  // Check URL hash for direct demo link
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash && demos.find((d) => d.id === hash)) {
      setActiveDemo(hash);
    }
  }, []);

  const handleDemoAccess = (demoId: string) => {
    if (isUnlocked) {
      setActiveDemo(demoId);
      setHasAccessedDemo(true);
    } else {
      setPendingDemoId(demoId);
      setShowLeadModal(true);
    }
  };

  // If lead is captured after modal, show the demo
  useEffect(() => {
    if (isLeadCaptured && !hasAccessedDemo) {
      setHasAccessedDemo(true);
    }
  }, [isLeadCaptured]);

  return (
    <Layout>
      <PageTransition>
        <div className="bg-primary text-primary-foreground py-16">
          <div className="container mx-auto px-4 text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Interactive Demos</h1>
            <p className="text-xl text-primary-foreground/80 max-w-2xl mx-auto">
              Experience our AI-powered permit acceleration tools firsthand
            </p>
          </div>
        </div>

        <div className="w-full max-w-7xl ml-0 mr-auto pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6 py-6 sm:py-8 md:py-12">
          {!isUnlocked ? (
          // Gated view - show demo cards (non-paid, no lead captured)
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-2">Unlock All Interactive Demos</h2>
              <p className="text-muted-foreground mb-6">
                Enter your email to get instant access to all four demos
              </p>
              <Button
                size="lg"
                className="bg-accent hover:bg-accent/90"
                onClick={() => {
                  setPendingDemoId("all");
                  setShowLeadModal(true);
                }}
              >
                <Play className="mr-2 h-5 w-5" />
                Access All Demos
              </Button>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {demos.map((demo) => (
                <Card key={demo.id} className="group hover:shadow-lg transition-all">
                  <CardHeader>
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-lg bg-accent/10 text-accent">
                        {demo.icon}
                      </div>
                      <div>
                        <CardTitle>{demo.title}</CardTitle>
                        <CardDescription>{demo.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => handleDemoAccess(demo.id)}
                    >
                      <Lock className="mr-2 h-4 w-4" />
                      Unlock Demo
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          // Unlocked view - show full demos (lead captured or paid plan)
          <div>
            <Tabs value={activeDemo} onValueChange={setActiveDemo}>
              <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 mb-8">
                {demos.map((demo) => (
                  <TabsTrigger key={demo.id} value={demo.id} className="flex items-center gap-2">
                    {demo.icon}
                    <span className="hidden sm:inline">{demo.title}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="compliance">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                      <Bot className="h-6 w-6 text-accent" />
                      Automated Code Compliance Checking
                    </CardTitle>
                    <CardDescription>
                      Click on issue markers to view code violations, requirements, and suggested fixes
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <InteractiveDrawingViewer />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="detection">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                      <Search className="h-6 w-6 text-accent" />
                      Pre-Submittal Issue Detection
                    </CardTitle>
                    <CardDescription>
                      See common rejection reasons and your approval probability score
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <PreSubmittalDetectionDemo />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="autofill">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                      <FileText className="h-6 w-6 text-accent" />
                      Permit Application Auto-Fill
                    </CardTitle>
                    <CardDescription>
                      Watch AI extract data from drawings and auto-fill permit applications
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <AutoFillDemo />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="jurisdiction">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                      <MapPin className="h-6 w-6 text-accent" />
                      Jurisdiction Requirement Lookup
                    </CardTitle>
                    <CardDescription>
                      Search, compare, and track requirements across 500+ jurisdictions
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <JurisdictionLookupDemo />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}
        </div>
      </PageTransition>
    </Layout>
  );
};

export default Demos;
