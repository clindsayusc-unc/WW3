import { create } from 'zustand';
import type { RegionId } from '../sim/types';

export type Screen = 'menu' | 'game';
export type Modal =
  | null
  | 'budget'
  | 'production'
  | 'research'
  | 'diplomacy'
  | 'military'
  | 'summary'
  | 'settings'
  | 'load'
  | 'nuclear'
  | 'end';
export type MapMode =
  | 'political'
  | 'blocs'
  | 'relations'
  | 'economy'
  | 'military'
  | 'tension'
  | 'terrain';
export const MAP_MODES: { id: MapMode; label: string; key: string; tooltip: string }[] = [
  {
    id: 'political',
    label: 'Political',
    key: '1',
    tooltip: 'Who controls each region (occupied regions show the occupier).',
  },
  {
    id: 'blocs',
    label: 'Blocs',
    key: '2',
    tooltip: 'Alliance blocs: NATO, EU, CSTO, SCO, BRICS, GCC, AUKUS/Quad.',
  },
  {
    id: 'relations',
    label: 'Relations',
    key: '3',
    tooltip: 'Each nation’s relations with you: red hostile, green friendly.',
  },
  { id: 'economy', label: 'Economy', key: '4', tooltip: 'Regional GDP heat map (log scale).' },
  {
    id: 'military',
    label: 'Military',
    key: '5',
    tooltip: 'Military presence: units in each region or sea zone.',
  },
  {
    id: 'tension',
    label: 'Tension',
    key: '6',
    tooltip: 'Flashpoint tension and active war zones.',
  },
  {
    id: 'terrain',
    label: 'Terrain',
    key: '7',
    tooltip:
      'Real terrain: land-cover tint (forest, jungle, desert, plains, marsh, tundra, cities) shaded by elevation (ETOPO 2022, MODIS).',
  },
];
export type Quality = 'low' | 'medium' | 'high';

export interface FlyTarget {
  lat: number;
  lon: number;
  distance: number;
  nonce: number;
}

interface UiStore {
  screen: Screen;
  modal: Modal;
  mapMode: MapMode;
  hoverRegion: RegionId | null;
  selectedRegion: RegionId | null;
  selectedUnitIds: number[];
  diplomacyTarget: string | null;
  flyTo: FlyTarget | null;
  quality: Quality;
  muted: boolean;
  showLabels: boolean;
  showClouds: boolean;
  /** Chokepoint overlay: icons with open / contested / closed status (key C). */
  showChokepoints: boolean;
  cameraDistance: number;
  fps: number;
  setScreen: (s: Screen) => void;
  setModal: (m: Modal) => void;
  setMapMode: (m: MapMode) => void;
  setHover: (r: RegionId | null) => void;
  select: (r: RegionId | null) => void;
  selectUnits: (ids: number[]) => void;
  setDiplomacyTarget: (iso: string | null) => void;
  fly: (lat: number, lon: number, distance?: number) => void;
  setQuality: (q: Quality) => void;
  toggleMute: () => void;
  toggleLabels: () => void;
  toggleClouds: () => void;
  toggleChokepoints: () => void;
  setCameraDistance: (d: number) => void;
  setFps: (f: number) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  screen: 'menu',
  modal: null,
  mapMode: 'political',
  hoverRegion: null,
  selectedRegion: null,
  selectedUnitIds: [],
  diplomacyTarget: null,
  flyTo: null,
  quality: 'high',
  muted: false,
  showLabels: true,
  showClouds: true,
  showChokepoints: true,
  cameraDistance: 3,
  fps: 60,
  setScreen: (screen) => set({ screen }),
  setModal: (modal) => set({ modal }),
  setMapMode: (mapMode) => set({ mapMode }),
  setHover: (hoverRegion) => set((s) => (s.hoverRegion === hoverRegion ? s : { hoverRegion })),
  select: (selectedRegion) => set({ selectedRegion, selectedUnitIds: [] }),
  selectUnits: (selectedUnitIds) => set({ selectedUnitIds }),
  setDiplomacyTarget: (diplomacyTarget) => set({ diplomacyTarget }),
  fly: (lat, lon, distance = 1.7) =>
    set((s) => ({ flyTo: { lat, lon, distance, nonce: (s.flyTo?.nonce ?? 0) + 1 } })),
  setQuality: (quality) => set({ quality }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  toggleClouds: () => set((s) => ({ showClouds: !s.showClouds })),
  toggleChokepoints: () => set((s) => ({ showChokepoints: !s.showChokepoints })),
  setCameraDistance: (cameraDistance) =>
    set((s) => (Math.abs(s.cameraDistance - cameraDistance) < 0.002 ? s : { cameraDistance })),
  setFps: (fps) => set({ fps }),
}));
