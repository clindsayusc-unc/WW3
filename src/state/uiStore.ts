import { create } from 'zustand';
import type { RegionId, ResourceId } from '../sim/types';
import type { EffectKey, EffectLevels, Level } from '../render/quality';
import { levelsForPreset } from '../render/quality';
import { DEFAULT_AUDIO, type AudioSettings } from '../ui/audioPrefs';
import { loadPrefs, savePrefs, clampScale, type UiPrefs } from '../ui/prefs';

export type Screen = 'menu' | 'game';
/** Tutorial progress (D-080): the current step and the game turn it began on. */
export interface TutorialState {
  active: boolean;
  step: number;
  startedTurn: number;
}
export type DiplomacyTab = 'nations' | 'negotiate' | 'dispatches' | 'blocs' | 'un';
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
  | 'battle'
  | 'economy'
  | 'escalation'
  | 'news'
  | 'shortcuts'
  | 'end';
export type MapMode =
  | 'political'
  | 'blocs'
  | 'relations'
  | 'economy'
  | 'military'
  | 'tension'
  | 'terrain'
  | 'supply'
  | 'resources';
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
  {
    id: 'economy',
    label: 'Economy',
    key: '4',
    tooltip:
      'Regional GDP heat map with trade routes as flowing arcs: width = trade volume; green open, amber rerouted, orange contested, red cut, pink sanctioned.',
  },
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
  {
    id: 'supply',
    label: 'Supply',
    key: '8',
    tooltip:
      'Supply network: land shaded green (full) to red (cut off) by the supply reaching its controller; depots outlined; sea zones in the colour of the fleet that controls them, amber where contested.',
  },
  {
    id: 'resources',
    label: 'Resources',
    key: '9',
    tooltip:
      'Strategic resources: pick oil, gas, rare earths, chips, food or steel. Green exporters (brighter = larger surplus), amber importers (deeper = more dependent), red where demand goes unmet.',
  },
];
/** Simple mode shows only the political map, and a war view while at war (D-086). */
export const SIMPLE_MAP_MODES: readonly MapMode[] = ['political', 'military'];
export type Quality = 'low' | 'medium' | 'high';

export interface FlyTarget {
  lat: number;
  lon: number;
  distance: number;
  nonce: number;
}

/** A missile arc the strike cam should follow (D-056). */
export interface StrikeCamRequest {
  points: { x: number; y: number; z: number }[];
  /** Flight time in ms. */
  duration: number;
  /** Where to settle afterwards. */
  lat: number;
  lon: number;
  nonce: number;
}

interface UiStore {
  screen: Screen;
  modal: Modal;
  mapMode: MapMode;
  /** Resource shown by the resources map mode. */
  resourceView: ResourceId;
  hoverRegion: RegionId | null;
  selectedRegion: RegionId | null;
  selectedUnitIds: number[];
  diplomacyTarget: string | null;
  diplomacyTab: DiplomacyTab;
  /** Id of the last breaking-news story the player dismissed (D-077). */
  breakingSeen: number;
  /** Battle report shown by the battle modal (D-059). */
  battleReportId: number | null;
  /** Simple mode: the turn whose end-of-turn report the player has dismissed (D-086). */
  reportSeen: number;
  setReportSeen: (turn: number) => void;
  flyTo: FlyTarget | null;
  quality: Quality;
  /** Set when the globe's textures failed to load (shown on the loading screen). */
  assetError: string | null;
  setAssetError: (message: string) => void;
  /** Per-effect Low/Medium/High (D-055); the preset resets all of them. */
  effects: EffectLevels;
  /** Auto-scaler cap on every effect level: 2 none, 1 medium, 0 low. */
  autoCap: number;
  /** Follow missile arcs with the camera (D-056). */
  strikeCam: boolean;
  strikeCamRequest: StrikeCamRequest | null;
  /** Sub-solar longitude offset from the camera longitude, degrees (D-045: 38 = afternoon). */
  sunOffset: number;
  muted: boolean;
  /** Master, effects and music volumes and the music switch (D-060); persisted in localStorage. */
  audio: AudioSettings;
  /** The one-time "music is off" hint has been shown. */
  musicHintShown: boolean;
  showLabels: boolean;
  showClouds: boolean;
  /** Chokepoint overlay: icons with open / contested / closed status (key C). */
  showChokepoints: boolean;
  cameraDistance: number;
  fps: number;
  /** Readability and onboarding preferences (D-080). */
  prefs: UiPrefs;
  /** Tutorial progress: active flag and the index of the current step (D-080). */
  tutorial: TutorialState;
  setPrefs: (patch: Partial<UiPrefs>) => void;
  setTutorial: (patch: Partial<TutorialState>) => void;
  setScreen: (s: Screen) => void;
  setModal: (m: Modal) => void;
  setMapMode: (m: MapMode) => void;
  setResourceView: (r: ResourceId) => void;
  setHover: (r: RegionId | null) => void;
  select: (r: RegionId | null) => void;
  selectUnits: (ids: number[]) => void;
  setDiplomacyTarget: (iso: string | null) => void;
  setDiplomacyTab: (tab: DiplomacyTab) => void;
  setBreakingSeen: (id: number) => void;
  openBattleReport: (id: number) => void;
  fly: (lat: number, lon: number, distance?: number) => void;
  setQuality: (q: Quality) => void;
  setEffect: (key: EffectKey, level: Level) => void;
  setEffects: (effects: EffectLevels) => void;
  setAutoCap: (cap: number) => void;
  setStrikeCam: (on: boolean) => void;
  requestStrikeCam: (r: Omit<StrikeCamRequest, 'nonce'> | null) => void;
  setSunOffset: (deg: number) => void;
  toggleMute: () => void;
  setAudio: (patch: Partial<AudioSettings>) => void;
  setMusicHintShown: (shown: boolean) => void;
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
  resourceView: 'oil',
  hoverRegion: null,
  selectedRegion: null,
  selectedUnitIds: [],
  diplomacyTarget: null,
  diplomacyTab: 'nations',
  breakingSeen: 0,
  battleReportId: null,
  reportSeen: 0,
  setReportSeen: (reportSeen) => set({ reportSeen }),
  flyTo: null,
  quality: 'high',
  assetError: null,
  setAssetError: (assetError) => set({ assetError }),
  effects: levelsForPreset('high'),
  autoCap: 2,
  strikeCam: true,
  strikeCamRequest: null,
  sunOffset: 38,
  muted: false,
  audio: { ...DEFAULT_AUDIO },
  musicHintShown: true,
  showLabels: true,
  showClouds: true,
  showChokepoints: true,
  cameraDistance: 3,
  fps: 60,
  prefs: loadPrefs(),
  tutorial: { active: false, step: 0, startedTurn: 0 },
  setPrefs: (patch) =>
    set((s) => {
      const prefs = { ...s.prefs, ...patch };
      prefs.uiScale = clampScale(prefs.uiScale);
      savePrefs(prefs);
      return { prefs };
    }),
  setTutorial: (patch) => set((s) => ({ tutorial: { ...s.tutorial, ...patch } })),
  setScreen: (screen) => set({ screen }),
  setModal: (modal) => set({ modal }),
  setMapMode: (mapMode) => set({ mapMode }),
  setResourceView: (resourceView) => set({ resourceView }),
  setHover: (hoverRegion) => set((s) => (s.hoverRegion === hoverRegion ? s : { hoverRegion })),
  select: (selectedRegion) => set({ selectedRegion, selectedUnitIds: [] }),
  selectUnits: (selectedUnitIds) => set({ selectedUnitIds }),
  setDiplomacyTarget: (diplomacyTarget) => set({ diplomacyTarget }),
  setDiplomacyTab: (diplomacyTab) => set({ diplomacyTab }),
  setBreakingSeen: (breakingSeen) => set({ breakingSeen }),
  openBattleReport: (battleReportId) => set({ battleReportId, modal: 'battle' }),
  fly: (lat, lon, distance = 1.7) =>
    set((s) => ({ flyTo: { lat, lon, distance, nonce: (s.flyTo?.nonce ?? 0) + 1 } })),
  setQuality: (quality) => set({ quality, effects: levelsForPreset(quality), autoCap: 2 }),
  setEffect: (key, level) => set((s) => ({ effects: { ...s.effects, [key]: level } })),
  setEffects: (effects) => set({ effects }),
  setAutoCap: (autoCap) => set((s) => (s.autoCap === autoCap ? s : { autoCap })),
  setStrikeCam: (strikeCam) => set({ strikeCam }),
  requestStrikeCam: (r) =>
    set((s) =>
      r
        ? { strikeCamRequest: { ...r, nonce: (s.strikeCamRequest?.nonce ?? 0) + 1 } }
        : { strikeCamRequest: null },
    ),
  setSunOffset: (sunOffset) => set({ sunOffset }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  setAudio: (patch) => set((s) => ({ audio: { ...s.audio, ...patch } })),
  setMusicHintShown: (musicHintShown) => set({ musicHintShown }),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  toggleClouds: () => set((s) => ({ showClouds: !s.showClouds })),
  toggleChokepoints: () => set((s) => ({ showChokepoints: !s.showChokepoints })),
  setCameraDistance: (cameraDistance) =>
    set((s) => (Math.abs(s.cameraDistance - cameraDistance) < 0.002 ? s : { cameraDistance })),
  setFps: (fps) => set({ fps }),
}));
