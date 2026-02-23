import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, MapPin, Building2, TrendingUp, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { US_STATES } from '@/types/jurisdiction';

interface JurisdictionMapData {
  id: string;
  name: string;
  state: string;
  city: string | null;
  residential_units_2024: number | null;
  is_high_volume: boolean | null;
  base_permit_fee: number | null;
  plan_review_sla_days: number | null;
}

// State center coordinates for map
const STATE_COORDINATES: Record<string, [number, number]> = {
  AL: [-86.9023, 32.3182], AK: [-153.4937, 64.2008], AZ: [-111.0937, 34.0489],
  AR: [-92.3731, 34.9697], CA: [-119.4179, 36.7783], CO: [-105.3111, 39.0598],
  CT: [-72.7554, 41.6032], DE: [-75.5277, 38.9108], FL: [-81.5158, 27.6648],
  GA: [-83.6431, 32.1656], HI: [-155.5828, 19.8968], ID: [-114.7420, 44.0682],
  IL: [-89.3985, 40.6331], IN: [-86.1349, 40.2672], IA: [-93.0977, 41.8780],
  KS: [-98.4842, 39.0119], KY: [-84.2700, 37.8393], LA: [-92.1450, 30.9843],
  ME: [-69.4455, 45.2538], MD: [-76.6413, 39.0458], MA: [-71.5314, 42.4072],
  MI: [-84.5361, 44.3148], MN: [-94.6859, 46.7296], MS: [-89.3985, 32.3547],
  MO: [-91.8318, 37.9643], MT: [-110.3626, 46.8797], NE: [-99.9018, 41.4925],
  NV: [-116.4194, 38.8026], NH: [-71.5724, 43.1939], NJ: [-74.4057, 40.0583],
  NM: [-105.8701, 34.5199], NY: [-75.4999, 43.2994], NC: [-79.0193, 35.7596],
  ND: [-100.7837, 47.5515], OH: [-82.9071, 40.4173], OK: [-97.0929, 35.0078],
  OR: [-120.5542, 43.8041], PA: [-77.1945, 41.2033], RI: [-71.4774, 41.5801],
  SC: [-80.9450, 33.8361], SD: [-99.9018, 43.9695], TN: [-86.5804, 35.5175],
  TX: [-99.9018, 31.9686], UT: [-111.0937, 39.3210], VT: [-72.5778, 44.5588],
  VA: [-78.6569, 37.4316], WA: [-120.7401, 47.7511], WV: [-80.4549, 38.5976],
  WI: [-89.6165, 43.7844], WY: [-107.2903, 43.0760], DC: [-77.0369, 38.9072],
};

// East Coast states for default view
const EAST_COAST_STATES = ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA', 'DE', 'MD', 'DC', 'VA', 'NC', 'SC', 'GA', 'FL'];

interface JurisdictionMapProps {
  mapboxToken: string;
}

export function JurisdictionMap({ mapboxToken }: JurisdictionMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  
  const [jurisdictions, setJurisdictions] = useState<JurisdictionMapData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedState, setSelectedState] = useState<string>('all');
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<JurisdictionMapData | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Fetch jurisdictions
  useEffect(() => {
    const fetchJurisdictions = async () => {
      setLoading(true);
      
      let query = supabase
        .from('jurisdictions')
        .select('id, name, state, city, residential_units_2024, is_high_volume, base_permit_fee, plan_review_sla_days')
        .eq('is_active', true)
        .not('residential_units_2024', 'is', null)
        .order('residential_units_2024', { ascending: false });

      if (selectedState && selectedState !== 'all') {
        query = query.eq('state', selectedState);
      } else {
        // Default to East Coast states
        query = query.in('state', EAST_COAST_STATES);
      }

      const { data, error } = await query.limit(100);

      if (!error && data) {
        setJurisdictions(data);
      }
      setLoading(false);
    };

    fetchJurisdictions();
  }, [selectedState]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || !mapboxToken) return;

    mapboxgl.accessToken = mapboxToken;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-77.0, 38.9], // DC area - East Coast center
      zoom: 5,
    });

    map.current.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: true }),
      'top-right'
    );

    map.current.on('load', () => {
      setMapReady(true);
    });

    return () => {
      markersRef.current.forEach(marker => marker.remove());
      map.current?.remove();
    };
  }, [mapboxToken]);

  // Add markers when jurisdictions or map changes
  useEffect(() => {
    if (!map.current || !mapReady || jurisdictions.length === 0) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // Get max units for scaling
    const maxUnits = Math.max(...jurisdictions.map(j => j.residential_units_2024 || 0));

    jurisdictions.forEach((jurisdiction) => {
      const coords = STATE_COORDINATES[jurisdiction.state];
      if (!coords) return;

      // Add some offset based on city name hash to spread out markers in same state
      const hash = jurisdiction.name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
      const offsetLng = ((hash % 100) / 100 - 0.5) * 2;
      const offsetLat = (((hash * 7) % 100) / 100 - 0.5) * 1.5;

      const units = jurisdiction.residential_units_2024 || 0;
      const sizeMultiplier = Math.max(0.5, Math.min(2, (units / maxUnits) * 3 + 0.5));
      const baseSize = 24;
      const size = Math.round(baseSize * sizeMultiplier);

      // Create custom marker element
      const el = document.createElement('div');
      el.className = 'jurisdiction-marker';
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderRadius = '50%';
      el.style.cursor = 'pointer';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.transition = 'transform 0.2s, box-shadow 0.2s';
      el.style.transformOrigin = 'center center';
      
      if (jurisdiction.is_high_volume) {
        el.style.background = 'linear-gradient(135deg, hsl(142, 76%, 36%), hsl(142, 71%, 45%))';
        el.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.4)';
      } else {
        el.style.background = 'linear-gradient(135deg, hsl(221, 83%, 53%), hsl(221, 83%, 63%))';
        el.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.4)';
      }

      el.addEventListener('mouseenter', () => {
        el.style.transform = 'scale(1.2)';
        el.style.boxShadow = jurisdiction.is_high_volume 
          ? '0 4px 16px rgba(34, 197, 94, 0.6)'
          : '0 4px 16px rgba(59, 130, 246, 0.6)';
      });

      el.addEventListener('mouseleave', () => {
        el.style.transform = 'scale(1)';
        el.style.boxShadow = jurisdiction.is_high_volume 
          ? '0 2px 8px rgba(34, 197, 94, 0.4)'
          : '0 2px 8px rgba(59, 130, 246, 0.4)';
      });

      el.addEventListener('click', () => {
        setSelectedJurisdiction(jurisdiction);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([coords[0] + offsetLng, coords[1] + offsetLat])
        .addTo(map.current!);

      markersRef.current.push(marker);
    });

    // Fit bounds to show all markers if we have jurisdictions
    if (jurisdictions.length > 0 && selectedState) {
      const coords = STATE_COORDINATES[selectedState];
      if (coords) {
        map.current.flyTo({
          center: coords,
          zoom: 6,
          duration: 1000,
        });
      }
    }
  }, [jurisdictions, mapReady]);

  const getVolumeColor = (units: number | null) => {
    if (!units) return 'bg-muted text-muted-foreground';
    if (units >= 10000) return 'bg-emerald-100 text-emerald-800';
    if (units >= 5000) return 'bg-blue-100 text-blue-800';
    if (units >= 1000) return 'bg-amber-100 text-amber-800';
    return 'bg-slate-100 text-slate-800';
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Select value={selectedState} onValueChange={setSelectedState}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Filter by state (East Coast default)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All East Coast States</SelectItem>
            {US_STATES.map(state => (
              <SelectItem key={state.code} value={state.code}>
                {state.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">High Volume</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Standard</span>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading jurisdictions...</span>
          </div>
        )}
      </div>

      {/* Map Container */}
      <div className="relative h-[500px] rounded-lg overflow-hidden border shadow-sm">
        <div ref={mapContainer} className="absolute inset-0" />
        
        {/* Selected Jurisdiction Panel */}
        {selectedJurisdiction && (
          <Card className="absolute top-4 left-4 w-80 shadow-lg z-10">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    {selectedJurisdiction.name}
                  </CardTitle>
                  <CardDescription>
                    {selectedJurisdiction.city && `${selectedJurisdiction.city}, `}
                    {selectedJurisdiction.state}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setSelectedJurisdiction(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {selectedJurisdiction.is_high_volume && (
                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                    <TrendingUp className="h-3 w-3 mr-1" />
                    High Volume
                  </Badge>
                )}
                <Badge className={getVolumeColor(selectedJurisdiction.residential_units_2024)}>
                  {selectedJurisdiction.residential_units_2024?.toLocaleString() || 'N/A'} units
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                {selectedJurisdiction.base_permit_fee && (
                  <div>
                    <span className="text-muted-foreground">Base Fee:</span>
                    <p className="font-medium">${selectedJurisdiction.base_permit_fee.toLocaleString()}</p>
                  </div>
                )}
                {selectedJurisdiction.plan_review_sla_days && (
                  <div>
                    <span className="text-muted-foreground">Review SLA:</span>
                    <p className="font-medium">{selectedJurisdiction.plan_review_sla_days} days</p>
                  </div>
                )}
              </div>

              <Button 
                size="sm" 
                className="w-full"
                onClick={() => window.open(`/jurisdictions/compare?add=${selectedJurisdiction.id}`, '_blank')}
              >
                <MapPin className="h-4 w-4 mr-2" />
                Add to Comparison
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Stats Overlay */}
        <div className="absolute bottom-4 right-4 bg-background/95 backdrop-blur rounded-lg px-4 py-2 shadow-lg border">
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Showing:</span>
              <span className="font-medium ml-1">{jurisdictions.length} jurisdictions</span>
            </div>
            {!selectedState && (
              <Badge variant="outline">East Coast</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Top Jurisdictions List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top Permit Volume Jurisdictions</CardTitle>
          <CardDescription>
            {selectedState 
              ? `Highest residential permit activity in ${US_STATES.find(s => s.code === selectedState)?.name}`
              : 'Highest residential permit activity across East Coast states'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {jurisdictions.slice(0, 9).map((jurisdiction, index) => (
              <button
                key={jurisdiction.id}
                onClick={() => setSelectedJurisdiction(jurisdiction)}
                className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors text-left"
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-sm">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{jurisdiction.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {jurisdiction.residential_units_2024?.toLocaleString()} units • {jurisdiction.state}
                  </p>
                </div>
                {jurisdiction.is_high_volume && (
                  <TrendingUp className="h-4 w-4 text-emerald-500 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
