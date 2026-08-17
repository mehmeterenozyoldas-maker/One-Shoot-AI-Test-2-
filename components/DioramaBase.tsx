/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';

interface DioramaBaseProps {
  nightFactor: number;
}

export const DioramaBase: React.FC<DioramaBaseProps> = ({ nightFactor }) => {
  const SIZE = 402;
  const DEPTH = 32;

  return (
    <group position={[0, -DEPTH / 2 - 0.2, 0]}>
      {/* 1. Main Subterranean Earth Strata Block */}
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[SIZE, DEPTH, SIZE, 16, 2, 16]} />
        <meshStandardMaterial 
          color="#1e293b" 
          roughness={0.95} 
          metalness={0.15} 
        />
      </mesh>

      {/* 2. Secondary Geothermal Basalt Bed Layer */}
      <mesh position={[0, -DEPTH / 2 - 4, 0]}>
        <boxGeometry args={[SIZE + 6, 8, SIZE + 6]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} />
      </mesh>

      {/* 3. Outer Chamfered Pedestal Bevel */}
      <mesh position={[0, -DEPTH / 2 - 9, 0]}>
        <boxGeometry args={[SIZE + 14, 2, SIZE + 14]} />
        <meshStandardMaterial color="#020617" roughness={0.7} metalness={0.4} />
      </mesh>

      {/* 4. Subterranean Geothermal Energy Veins (Glowing strata lines on cliff faces) */}
      {/* North & South Strata Veins */}
      <mesh position={[0, -4, SIZE / 2 + 0.1]}>
        <boxGeometry args={[SIZE * 0.7, 0.4, 0.2]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
      <mesh position={[0, -12, SIZE / 2 + 0.1]}>
        <boxGeometry args={[SIZE * 0.5, 0.3, 0.2]} />
        <meshBasicMaterial color="#06b6d4" />
      </mesh>
      <mesh position={[0, -4, -SIZE / 2 - 0.1]}>
        <boxGeometry args={[SIZE * 0.7, 0.4, 0.2]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
      <mesh position={[0, -12, -SIZE / 2 - 0.1]}>
        <boxGeometry args={[SIZE * 0.5, 0.3, 0.2]} />
        <meshBasicMaterial color="#06b6d4" />
      </mesh>

      {/* East & West Strata Veins */}
      <mesh position={[SIZE / 2 + 0.1, -4, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[SIZE * 0.7, 0.4, 0.2]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
      <mesh position={[SIZE / 2 + 0.1, -12, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[SIZE * 0.5, 0.3, 0.2]} />
        <meshBasicMaterial color="#06b6d4" />
      </mesh>
      <mesh position={[-SIZE / 2 - 0.1, -4, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[SIZE * 0.7, 0.4, 0.2]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
      <mesh position={[-SIZE / 2 - 0.1, -12, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[SIZE * 0.5, 0.3, 0.2]} />
        <meshBasicMaterial color="#06b6d4" />
      </mesh>

      {/* 5. Subterranean Ambient Corner Corner Brackets */}
      {[-1, 1].map((cx) =>
        [-1, 1].map((cz) => (
          <mesh 
            key={`${cx}-${cz}`} 
            position={[cx * (SIZE / 2 + 2), -DEPTH / 2 - 4, cz * (SIZE / 2 + 2)]}
          >
            <boxGeometry args={[6, 9, 6]} />
            <meshStandardMaterial 
              color="#334155" 
              metalness={0.8} 
              emissive="#38bdf8" 
              emissiveIntensity={0.2 + nightFactor * 0.6} 
            />
          </mesh>
        ))
      )}
    </group>
  );
};
