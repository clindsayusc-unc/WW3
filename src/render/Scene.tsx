import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Globe } from './Globe';

export function Scene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 3], fov: 45, near: 0.01, far: 100 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#02040a']} />
      <ambientLight intensity={0.15} />
      <directionalLight position={[5, 2, 5]} intensity={2.2} />
      <Stars radius={50} depth={20} count={3000} factor={2} fade />
      <Globe />
      <OrbitControls enablePan={false} minDistance={1.3} maxDistance={8} />
    </Canvas>
  );
}
