import { useEffect } from 'react';
import { Scene } from './render/Scene';
import { Hud } from './ui/Hud';
import { startSimulation } from './state/simBridge';

const DEFAULT_SEED = 1;

export function App() {
  useEffect(() => startSimulation(DEFAULT_SEED), []);
  return (
    <>
      <Scene />
      <Hud />
    </>
  );
}
