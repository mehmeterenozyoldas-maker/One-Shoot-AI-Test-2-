/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { BuildingData, BuildingType } from '../types';

interface TransitNetworkProps {
  buildings: BuildingData[];
  nightFactor: number;
}

export const TransitNetwork: React.FC<TransitNetworkProps> = ({ buildings, nightFactor }) => {
  const groundVehiclesRef = useRef<THREE.Group>(null);
  const aerialDronesRef = useRef<THREE.Group>(null);

  // 1. Compute Road Waypoints from Road Network
  const roadRoutes = useMemo(() => {
    // Standard ring loop coordinates (radius 60 = 5 * 12)
    const ring: THREE.Vector3[] = [
      new THREE.Vector3(-60, 0.4, -60),
      new THREE.Vector3(60, 0.4, -60),
      new THREE.Vector3(60, 0.4, 60),
      new THREE.Vector3(-60, 0.4, 60),
      new THREE.Vector3(-60, 0.4, -60),
    ];

    // North-South Arterial Axis
    const axisNS: THREE.Vector3[] = [
      new THREE.Vector3(0, 0.4, -72),
      new THREE.Vector3(0, 0.4, 72),
      new THREE.Vector3(0, 0.4, -72),
    ];

    // East-West Arterial Axis
    const axisEW: THREE.Vector3[] = [
      new THREE.Vector3(-72, 0.4, 0),
      new THREE.Vector3(72, 0.4, 0),
      new THREE.Vector3(-72, 0.4, 0),
    ];

    const ringCurve = new THREE.CatmullRomCurve3(ring, true, 'centripetal', 0.2);
    const nsCurve = new THREE.CatmullRomCurve3(axisNS, true, 'centripetal', 0.1);
    const ewCurve = new THREE.CatmullRomCurve3(axisEW, true, 'centripetal', 0.1);

    return [
      { curve: ringCurve, speed: 0.035, count: 4, offset: 0 },
      { curve: ringCurve, speed: 0.035, count: 4, offset: 0.5 },
      { curve: nsCurve, speed: 0.045, count: 2, offset: 0.25 },
      { curve: ewCurve, speed: 0.045, count: 2, offset: 0.75 },
    ];
  }, []);

  // 2. Compute 3D Aerial Sky-Drone Flight Corridors
  const skyCorridors = useMemo(() => {
    // Corridor 1: Helipads to Central Spire to Solar Farm
    const p1 = [
      new THREE.Vector3(0, 42, 0),       // Central Spire
      new THREE.Vector3(36, 32, -36),    // Commercial Tower 1 Skydeck
      new THREE.Vector3(-90, 24, 90),    // Solar Farm Hub
      new THREE.Vector3(-36, 30, -36),   // Commercial Tower 2 Skydeck
      new THREE.Vector3(0, 42, 0),
    ];

    // Corridor 2: Perimeter Wind Ridge Patrol & Observation
    const p2 = [
      new THREE.Vector3(100, 38, -60),   // Wind Ridge East
      new THREE.Vector3(0, 45, -120),    // Wind Ridge North
      new THREE.Vector3(-100, 36, 40),   // Suburb West
      new THREE.Vector3(60, 28, 80),     // Eco Basin South
      new THREE.Vector3(100, 38, -60),
    ];

    return [
      { curve: new THREE.CatmullRomCurve3(p1, true, 'catmullrom', 0.5), speed: 0.04, count: 3 },
      { curve: new THREE.CatmullRomCurve3(p2, true, 'catmullrom', 0.5), speed: 0.03, count: 3 },
    ];
  }, []);

  // Ground Vehicles State
  const vehicles = useMemo(() => {
    const list: { routeIdx: number; tOffset: number; color: string; type: 'pod' | 'shuttle' }[] = [];
    roadRoutes.forEach((route, rIdx) => {
      for (let i = 0; i < route.count; i++) {
        list.push({
          routeIdx: rIdx,
          tOffset: (i / route.count + route.offset) % 1.0,
          color: i % 2 === 0 ? '#38bdf8' : '#f59e0b',
          type: i % 2 === 0 ? 'pod' : 'shuttle',
        });
      }
    });
    return list;
  }, [roadRoutes]);

  // Aerial Drones State
  const drones = useMemo(() => {
    const list: { corridorIdx: number; tOffset: number; beaconColor: string }[] = [];
    skyCorridors.forEach((corr, cIdx) => {
      for (let i = 0; i < corr.count; i++) {
        list.push({
          corridorIdx: cIdx,
          tOffset: (i / corr.count) % 1.0,
          beaconColor: i % 2 === 0 ? '#06b6d4' : '#10b981',
        });
      }
    });
    return list;
  }, [skyCorridors]);

  useFrame((state) => {
    const time = state.clock.getElapsedTime();

    // 1. Update Ground Pods
    if (groundVehiclesRef.current) {
      const meshes = groundVehiclesRef.current.children;
      vehicles.forEach((veh, idx) => {
        if (idx < meshes.length) {
          const route = roadRoutes[veh.routeIdx];
          const t = (time * route.speed + veh.tOffset) % 1.0;
          const point = route.curve.getPointAt(t);
          const tangent = route.curve.getTangentAt(t).normalize();

          const mesh = meshes[idx] as THREE.Group;
          mesh.position.copy(point);

          // Rotate to face tangent forward
          const lookTarget = point.clone().add(tangent);
          mesh.lookAt(lookTarget);
        }
      });
    }

    // 2. Update Sky-Drones
    if (aerialDronesRef.current) {
      const meshes = aerialDronesRef.current.children;
      drones.forEach((drone, idx) => {
        if (idx < meshes.length) {
          const corridor = skyCorridors[drone.corridorIdx];
          const t = (time * corridor.speed + drone.tOffset) % 1.0;
          const point = corridor.curve.getPointAt(t);
          const tangent = corridor.curve.getTangentAt(t).normalize();

          const mesh = meshes[idx] as THREE.Group;
          // Add gentle altitude bobbing
          point.y += Math.sin(time * 3.0 + idx) * 0.4;
          mesh.position.copy(point);

          const lookTarget = point.clone().add(tangent);
          mesh.lookAt(lookTarget);

          // Subtle bank angle based on curve tangent delta
          mesh.rotation.z = Math.sin(time * 2.0 + idx) * 0.15;
        }
      });
    }
  });

  return (
    <group>
      {/* --- 1. Autonomous Ground EV Pods & Shuttles --- */}
      <group ref={groundVehiclesRef}>
        {vehicles.map((v, i) => (
          <group key={i}>
            {/* Pod Body */}
            <mesh position={[0, 0.4, 0]} castShadow>
              <boxGeometry args={[1.6, 0.8, 2.8]} />
              <meshStandardMaterial 
                color="#f8fafc" 
                roughness={0.2} 
                metalness={0.8} 
              />
            </mesh>

            {/* Tinted Aero Windshield */}
            <mesh position={[0, 0.65, 0.3]}>
              <boxGeometry args={[1.4, 0.45, 1.6]} />
              <meshPhysicalMaterial 
                color="#0f172a" 
                roughness={0.1} 
                metalness={0.9} 
                transmission={0.4} 
              />
            </mesh>

            {/* Forward Headlights */}
            <mesh position={[0.55, 0.35, 1.45]}>
              <boxGeometry args={[0.3, 0.15, 0.1]} />
              <meshBasicMaterial color="#ffffff" toneMapped={false} />
            </mesh>
            <mesh position={[-0.55, 0.35, 1.45]}>
              <boxGeometry args={[0.3, 0.15, 0.1]} />
              <meshBasicMaterial color="#ffffff" toneMapped={false} />
            </mesh>

            {/* Rear Neon Taillight Strip */}
            <mesh position={[0, 0.45, -1.45]}>
              <boxGeometry args={[1.4, 0.12, 0.08]} />
              <meshBasicMaterial color="#ef4444" toneMapped={false} />
            </mesh>

            {/* Neon Undercarriage Hover Glow */}
            <mesh position={[0, 0.08, 0]}>
              <boxGeometry args={[1.3, 0.04, 2.2]} />
              <meshBasicMaterial 
                color={v.color} 
                transparent 
                opacity={0.7 + nightFactor * 0.3} 
              />
            </mesh>
          </group>
        ))}
      </group>

      {/* --- 2. Autonomous Transit & Cargo Sky-Drones --- */}
      <group ref={aerialDronesRef}>
        {drones.map((d, i) => (
          <group key={i}>
            {/* Aerodynamic Drone Fuselage */}
            <mesh castShadow>
              <capsuleGeometry args={[0.45, 1.2, 8, 8]} />
              <meshStandardMaterial 
                color="#e2e8f0" 
                roughness={0.3} 
                metalness={0.7} 
              />
            </mesh>

            {/* Drone Quad-Rotor Arms */}
            <mesh position={[0, 0.1, 0]} rotation={[0, Math.PI / 4, 0]}>
              <boxGeometry args={[2.2, 0.08, 0.15]} />
              <meshStandardMaterial color="#334155" metalness={0.8} />
            </mesh>
            <mesh position={[0, 0.1, 0]} rotation={[0, -Math.PI / 4, 0]}>
              <boxGeometry args={[2.2, 0.08, 0.15]} />
              <meshStandardMaterial color="#334155" metalness={0.8} />
            </mesh>

            {/* Glowing Quad Rotor Discs */}
            {[-0.8, 0.8].map((rx) =>
              [-0.8, 0.8].map((rz) => (
                <mesh key={`${rx}-${rz}`} position={[rx, 0.2, rz]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[0.25, 0.35, 12]} />
                  <meshBasicMaterial 
                    color={d.beaconColor} 
                    transparent 
                    opacity={0.8} 
                    side={THREE.DoubleSide} 
                  />
                </mesh>
              ))
            )}

            {/* Ion Propulsion Tail Glow */}
            <mesh position={[0, 0, -0.9]}>
              <sphereGeometry args={[0.2, 8, 8]} />
              <meshBasicMaterial color="#38bdf8" toneMapped={false} />
            </mesh>

            {/* Top Navigation Strobe Light */}
            <mesh position={[0, 0.55, 0]}>
              <sphereGeometry args={[0.12, 6, 6]} />
              <meshBasicMaterial 
                color={i % 2 === 0 ? "#f43f5e" : "#38bdf8"} 
                toneMapped={false} 
              />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
};
