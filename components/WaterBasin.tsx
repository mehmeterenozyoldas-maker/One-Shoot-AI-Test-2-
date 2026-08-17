/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface WaterBasinProps {
  nightFactor: number;
}

export const WaterBasin: React.FC<WaterBasinProps> = ({ nightFactor }) => {
  const waterRef = useRef<THREE.Mesh>(null);
  const lilyGroup = useRef<THREE.Group>(null);

  // Procedural low-poly water geometry with vertex waves
  const { geometry, basePositions } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(160, 110, 48, 36);
    const pos = geo.attributes.position;
    const base = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      
      // Elliptical basin depression mask
      const normX = x / 80;
      const normY = y / 55;
      const dist = Math.sqrt(normX * normX + normY * normY);
      
      let z = 0;
      if (dist < 1.0) {
        // Natural curved bowl
        z = Math.sin((1.0 - dist) * Math.PI) * 0.8;
      }
      pos.setZ(i, z);

      base[i * 3] = x;
      base[i * 3 + 1] = y;
      base[i * 3 + 2] = z;
    }

    geo.computeVertexNormals();
    return { geometry: geo, basePositions: base };
  }, []);

  // Floating solarpunk bio-filtration pads / lily aeration nodes
  const aerationPads = useMemo(() => {
    return [
      { x: -35, z: -15, scale: 3.5, rot: 0.2 },
      { x: -10, z: 20, scale: 2.8, rot: 1.1 },
      { x: 25, z: -10, scale: 4.2, rot: 2.4 },
      { x: 45, z: 18, scale: 3.0, rot: 0.8 },
      { x: 15, z: 32, scale: 2.4, rot: 1.7 },
      { x: -45, z: 12, scale: 2.6, rot: 2.9 },
    ];
  }, []);

  useFrame((state) => {
    const time = state.clock.getElapsedTime();

    if (waterRef.current) {
      const pos = waterRef.current.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const bx = basePositions[i * 3];
        const by = basePositions[i * 3 + 1];
        const bz = basePositions[i * 3 + 2];

        // Multi-frequency wave ripple
        const wave1 = Math.sin(bx * 0.12 + time * 1.8) * 0.35;
        const wave2 = Math.cos(by * 0.15 + time * 1.4) * 0.25;
        const wave3 = Math.sin((bx + by) * 0.08 + time * 2.2) * 0.18;

        pos.setZ(i, bz + wave1 + wave2 + wave3);
      }
      pos.needsUpdate = true;
      waterRef.current.geometry.computeVertexNormals();
    }

    // Floating bobbing on lily pads
    if (lilyGroup.current) {
      lilyGroup.current.children.forEach((pad, idx) => {
        pad.position.y = 0.8 + Math.sin(time * 2.0 + idx * 1.2) * 0.15;
        pad.rotation.z = Math.sin(time * 1.2 + idx) * 0.04;
      });
    }
  });

  return (
    <group position={[85, 0.4, 30]} rotation={[-Math.PI / 2, 0, -0.2]}>
      {/* 1. Deep Water Basin Floor */}
      <mesh position={[0, 0, -1.8]} receiveShadow>
        <planeGeometry args={[162, 112]} />
        <meshStandardMaterial color="#0f3b46" roughness={0.9} />
      </mesh>

      {/* 2. Low-Poly Animated Shimmering Water Surface */}
      <mesh 
        ref={waterRef} 
        geometry={geometry} 
        receiveShadow
      >
        <meshPhysicalMaterial 
          color="#06b6d4" 
          emissive={nightFactor > 0.3 ? "#0891b2" : "#0284c7"}
          emissiveIntensity={0.25 + nightFactor * 0.8}
          roughness={0.12}
          metalness={0.1}
          transmission={0.65}
          opacity={0.88}
          transparent
          reflectivity={0.9}
          ior={1.33}
          flatShading
        />
      </mesh>

      {/* 3. Soft Shoreline Foam & Wetland Reeds Ring */}
      <mesh position={[0, 0, 0.2]}>
        <ringGeometry args={[52, 58, 36]} />
        <meshBasicMaterial 
          color="#e0f2fe" 
          transparent 
          opacity={0.35 + nightFactor * 0.2} 
          side={THREE.DoubleSide} 
        />
      </mesh>

      {/* 4. Floating Solarpunk Bio-Filtration Pads */}
      <group ref={lilyGroup} rotation={[Math.PI / 2, 0, 0]}>
        {aerationPads.map((pad, i) => (
          <group key={i} position={[pad.x, 0.8, pad.z]} rotation={[0, pad.rot, 0]} scale={pad.scale}>
            {/* Hexagonal Floating Raft */}
            <mesh receiveShadow castShadow>
              <cylinderGeometry args={[1.0, 1.1, 0.25, 6]} />
              <meshStandardMaterial color="#15803d" roughness={0.6} />
            </mesh>
            {/* Solar Aeration Core */}
            <mesh position={[0, 0.25, 0]}>
              <cylinderGeometry args={[0.35, 0.35, 0.2, 8]} />
              <meshStandardMaterial color="#334155" metalness={0.8} />
            </mesh>
            {/* Bioluminescent Aeration Glow Node */}
            <mesh position={[0, 0.45, 0]}>
              <sphereGeometry args={[0.18, 8, 8]} />
              <meshBasicMaterial 
                color={nightFactor > 0.4 ? "#38bdf8" : "#4ade80"} 
                toneMapped={false} 
              />
            </mesh>
            {/* Micro Solar Fan / Turbine */}
            <mesh position={[0, 0.55, 0]} rotation={[0, (i * Math.PI) / 3, 0]}>
              <boxGeometry args={[0.7, 0.04, 0.12]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
};
