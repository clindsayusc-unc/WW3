import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';

/**
 * Placeholder globe. Prompt 1 replaces the flat material with NASA Blue Marble /
 * Black Marble textures (KTX2, ≤4096 px) and an atmosphere shader.
 */
export function Globe() {
  const ref = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.05;
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1, 128, 64]} />
      <meshStandardMaterial color="#1d4f7a" roughness={0.85} metalness={0} />
    </mesh>
  );
}
