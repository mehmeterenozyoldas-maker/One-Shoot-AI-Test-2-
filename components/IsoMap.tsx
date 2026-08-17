/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Instances, Instance, PerspectiveCamera, Sky, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { COLORS, SCENE_SIZE, TURBINE_COUNT, SOLAR_COUNT, SIM_CONFIG, BUILDINGS } from '../constants';
import { AppMode, EditorTool, EnergyStation, GestureState, SceneData, SimulationMetrics, BuildingData, BuildingType } from '../types';
import { HandControlSystem } from './HandControlSystem';
import { PlannerUI } from './PlannerUI';
import { WaterBasin } from './WaterBasin';
import { DioramaBase } from './DioramaBase';
import { TransitNetwork } from './TransitNetwork';
import { CameraDock, CameraPreset } from './CameraDock';

// --- Shaders & Materials ---

const HeatmapMaterial = {
  uniforms: {
    maxHeight: { value: 40.0 },
    windColor: { value: new THREE.Color(COLORS.wind) },
    solarColor: { value: new THREE.Color(COLORS.solar) },
    opacity: { value: 0.3 }
  },
  vertexShader: `
    varying float vHeight;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vHeight = position.y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float maxHeight;
    uniform vec3 windColor;
    uniform vec3 solarColor;
    uniform float opacity;
    varying float vHeight;
    varying vec2 vUv;
    
    void main() {
      // Heatmap Logic:
      // High altitude (y) -> Better Wind (Green/Cyan)
      // Flat/Open areas -> Good Solar (Yellow)
      
      float h = smoothstep(-10.0, maxHeight, vHeight);
      
      // Mix: Low = Solar potential, High = Wind potential
      vec3 col = mix(solarColor, windColor, h);
      
      // Grid lines
      float grid = step(0.98, fract(vUv.x * 40.0)) + step(0.98, fract(vUv.y * 40.0));
      col = mix(col, vec3(1.0), grid * 0.5);

      gl_FragColor = vec4(col, opacity * (0.3 + h * 0.4));
    }
  `
};

const EnergyFlowMaterial = {
  uniforms: {
    time: { value: 0 },
    color: { value: new THREE.Color(COLORS.windGlow) },
    speed: { value: 1.0 },
    opacity: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    uniform vec3 color;
    uniform float speed;
    uniform float opacity;
    varying vec2 vUv;
    
    void main() {
      // Primary energy stream pulses
      float segments = 3.0;
      float travel = vUv.x * segments - time * speed * 3.5;
      float pulseShape = fract(travel);
      float intensity = pow(pulseShape, 8.0); 
      
      // Secondary micro-pulses
      float travel2 = vUv.x * 6.0 - time * speed * 4.5;
      float pulse2 = pow(fract(travel2), 12.0) * 0.6;
      intensity += pulse2;
      
      // High-frequency energy shimmer
      float shimmer = sin(vUv.x * 50.0 - time * 12.0) * 0.5 + 0.5;
      intensity += shimmer * 0.08;

      // Base idle flow
      float baseGlow = 0.15;
      
      float alpha = (baseGlow + intensity) * opacity;
      alpha *= smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
      
      // High-energy white core with colored corona
      vec3 finalColor = mix(color, vec3(1.0, 1.0, 1.0), intensity * 0.85);
      finalColor *= (1.4 + intensity * 9.0);
      
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(finalColor, alpha);
    }
  `
};

// --- Procedural Generation Helpers ---

// Improved Fractal Brownian Motion (FBM) for Organic Terrain
const fbm = (x: number, z: number) => {
  let value = 0;
  let amplitude = 18; // Increased amplitude for more dramatic hills
  let frequency = 0.015; // Lower frequency for broader features

  // Layer 1: Base Rolling Hills
  value += (Math.sin(x * frequency) + Math.cos(z * frequency * 0.85)) * amplitude;
  
  // Layer 2: Ridge details
  const x2 = x * 0.8 - z * 0.6;
  const z2 = x * 0.6 + z * 0.8;
  value += (Math.sin(x2 * frequency * 2.1 + 1.4) * Math.cos(z2 * frequency * 1.9 + 0.5)) * (amplitude * 0.45);

  // Layer 3: Texture/Roughness
  const x3 = x * 0.6 + z * 0.8;
  const z3 = -x * 0.8 + z * 0.6;
  value += (Math.sin(x3 * frequency * 4.5 + 3.1) * Math.sin(z3 * frequency * 4.1 + 1.9)) * (amplitude * 0.15);

  return value;
};

// Advanced Terrain Function: Flat City Center, Organic Hilly Outskirts
const getTerrainHeight = (x: number, z: number) => {
    const dist = Math.sqrt(x * x + z * z);
    // CRITICAL FIX: Increased cityRadius to 95 to cover the entire grid extent (7*12 = 84 units)
    // This ensures all roads and buildings sit on strictly flat ground (y=0).
    const cityRadius = 95; 
    const transitionWidth = 80; 

    // 0 = Flat (Center), 1 = Full Noise (Outskirts)
    let blendFactor = 0;
    if (dist > cityRadius) {
        blendFactor = Math.min(1, (dist - cityRadius) / transitionWidth);
        // Smoothstep cubic interpolation
        blendFactor = blendFactor * blendFactor * (3 - 2 * blendFactor);
    }

    const noise = fbm(x, z);
    return noise * blendFactor;
};

// Simple pseudo-random hash for visual variation
const noiseHash = (x: number, y: number) => {
    return Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
};

// --- Data Generation ---

const generateInitialData = (): SceneData => {
    const buildings: BuildingData[] = [];
    const stations: EnergyStation[] = [];
    const cityTarget = new THREE.Vector3(0, 15, 0);
    
    // Grid System for Non-Overlapping Placement
    const GRID_SIZE = 12; // Spacing between buildings
    const occupied = new Set<string>();
    
    const addToGrid = (gx: number, gz: number, type: BuildingType | 'STATION', data: any) => {
        const key = `${gx},${gz}`;
        if (occupied.has(key)) return false;
        
        const x = gx * GRID_SIZE;
        const z = gz * GRID_SIZE;
        const y = getTerrainHeight(x, z);
        
        if (type === 'STATION') {
            stations.push({ ...data, position: [x, y, z] });
        } else {
            // Building Logic
            let scale: [number, number, number] = [8, 10, 8];
            if (type === BuildingType.Commercial) scale = [8, 15 + Math.random() * 25, 8];
            if (type === BuildingType.Residential) scale = [8, 8 + Math.random() * 8, 8];
            if (type === BuildingType.Road) scale = [12, 0.2, 12];
            if (type === BuildingType.Forest) scale = [10, 1, 10]; // Area coverage
            if (type === BuildingType.Mountain) scale = [12, 18, 12]; // Base Width, Height, Depth
            
            // Override rotation if provided in data
            const rotation = data.rotation || [0, (Math.floor(Math.random() * 4) * Math.PI) / 2, 0];

            buildings.push({
                id: `bld-${Date.now()}-${Math.random()}`,
                type: type as BuildingType,
                position: [x, y, z],
                scale,
                rotation: rotation, 
                variant: Math.floor(Math.random() * 3)
            });
        }
        
        occupied.add(key);
        return true;
    };

    // --- 0. Road Network (Infrastructure) ---
    const roadCoords = new Set<string>();
    
    // Main Axes
    for(let i = -6; i <= 6; i++) {
        roadCoords.add(`${i},0`);
        roadCoords.add(`0,${i}`);
    }
    
    // Ring Road
    const ringRadius = 5;
    for(let x = -ringRadius; x <= ringRadius; x++) {
        roadCoords.add(`${x},${-ringRadius}`);
        roadCoords.add(`${x},${ringRadius}`);
        roadCoords.add(`${-ringRadius},${x}`);
        roadCoords.add(`${ringRadius},${x}`);
    }

    // Place Roads
    roadCoords.forEach(key => {
        const [gx, gz] = key.split(',').map(Number);
        let rot = 0;
        if (gz === 0 && gx !== 0) rot = Math.PI / 2;
        addToGrid(gx, gz, BuildingType.Road, { rotation: [0, rot, 0] });
    });

    // --- 1. City Zones ---
    for (let x = -7; x <= 7; x++) {
        for (let z = -7; z <= 7; z++) {
            if (occupied.has(`${x},${z}`)) continue;

            const dist = Math.max(Math.abs(x), Math.abs(z)); 
            
            if (dist <= 2) {
                if (Math.random() > 0.1) addToGrid(x, z, BuildingType.Commercial, {});
            } else if (dist <= 5) {
                if (Math.random() > 0.15) addToGrid(x, z, BuildingType.Residential, {});
            } else if (dist <= 7) {
                if (Math.random() > 0.4) {
                    const type = Math.random() > 0.6 ? BuildingType.Park : BuildingType.Residential;
                    addToGrid(x, z, type, {});
                }
            }
        }
    }

    // --- 2. Wind Turbines (High ground / Outskirts) ---
    for (let i = 0; i < TURBINE_COUNT; i++) {
        const angle = (Math.PI * 2 * i) / TURBINE_COUNT;
        const r = 11 + Math.random() * 4; 
        const gx = Math.round(Math.cos(angle) * r);
        const gz = Math.round(Math.sin(angle) * r);
        
        addToGrid(gx, gz, 'STATION', {
            id: `wind-${i}`,
            type: 'WIND',
            scale: 1,
            rotation: [0, Math.random() * Math.PI, 0],
            efficiency: 1, 
            output: 0
        });
    }

    // --- 3. Solar Farm (Cluster) ---
    const startX = -9; 
    const startZ = 9;
    for (let dx = 0; dx < 3; dx++) {
        for (let dz = 0; dz < 4; dz++) {
             addToGrid(startX + dx, startZ + dz, 'STATION', {
                id: `solar-${dx}-${dz}`,
                type: 'SOLAR',
                scale: 1,
                rotation: [0, 0, 0],
                efficiency: 1,
                output: 0
             });
        }
    }

    // --- 4. Pre-Generated Nature (Forests/Mountains) ---
    for (let i = 0; i < 12; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = 8 + Math.random() * 8;
        const gx = Math.round(Math.cos(angle) * r);
        const gz = Math.round(Math.sin(angle) * r);
        // Mountains further out
        const type = r > 12 ? BuildingType.Mountain : BuildingType.Forest;
        addToGrid(gx, gz, type, {});
    }

    return { city: { buildings, target: cityTarget }, stations };
};

// --- Sub-Components ---

const Terrain = ({ editorMode, onPlace }: { editorMode: boolean, onPlace: (p: THREE.Vector3) => void }) => {
  const geom = useMemo(() => {
    const geo = new THREE.PlaneGeometry(SCENE_SIZE, SCENE_SIZE, 128, 128);
    const pos = geo.attributes.position;
    const colors = [];
    const colorBase = new THREE.Color(COLORS.grassBase); // Deep green (valleys)
    const colorPeak = new THREE.Color(COLORS.grassPeak); // Light green (peaks)
    const colorCity = new THREE.Color('#e2e8f0'); // Slate-200 for flattened areas
    const colorDirt = new THREE.Color('#78716c'); // Stone/Dirt hint
    const colorMix = new THREE.Color();
    const colorNature = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i); // Plane is laid out x,y before rotation
      const z = getTerrainHeight(x, y); // Use new height logic
      pos.setZ(i, z);
      
      const dist = Math.sqrt(x * x + y * y);
      
      // 1. Nature Gradient (Height & Noise Based)
      // Height varies roughly -20 to +30. Normalize this.
      const hNorm = THREE.MathUtils.clamp((z + 10) / 40, 0, 1);
      
      // Organic noise factor for surface variation
      const noise = noiseHash(x * 0.1, y * 0.1);
      const microVar = (noise - 0.5) * 0.1;

      // Blend base nature color: darker in valleys, lighter on hills, with random earth tones
      colorNature.copy(colorBase).lerp(colorPeak, Math.pow(hNorm, 1.5));
      // Add dirt/rock color at very high peaks or steep areas (simulated)
      if (hNorm > 0.8) colorNature.lerp(colorDirt, (hNorm - 0.8) * 2);

      // 2. City vs Nature Blending
      // Match the cityRadius from getTerrainHeight (95)
      const cityBlendStart = 90; 
      const cityBlendEnd = 130;
      
      let cityFactor = 0;
      if (dist < cityBlendStart) {
          cityFactor = 1;
      } else if (dist < cityBlendEnd) {
          const t = 1 - (dist - cityBlendStart) / (cityBlendEnd - cityBlendStart);
          cityFactor = t * t * (3 - 2 * t);
      }

      // Final mix
      colorMix.copy(colorNature).lerp(colorCity, cityFactor * 0.95); 

      // Apply micro variation
      colorMix.r += microVar; colorMix.g += microVar; colorMix.b += microVar;

      colors.push(colorMix.r, colorMix.g, colorMix.b);
    }
    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, []);

  const heatmapMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: HeatmapMaterial.vertexShader,
      fragmentShader: HeatmapMaterial.fragmentShader,
      uniforms: {
        maxHeight: { value: 30.0 },
        windColor: { value: new THREE.Color(COLORS.wind) },
        solarColor: { value: new THREE.Color(COLORS.solar) },
        opacity: { value: 0.4 }
      },
      transparent: true,
      depthWrite: false, // Overlay
    })
  }, []);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (editorMode) {
        e.stopPropagation();
        onPlace(e.point);
    }
  };

  return (
    <group>
      <mesh 
        geometry={geom} 
        rotation={[-Math.PI / 2, 0, 0]} 
        receiveShadow 
        onClick={handleClick}
        onPointerOver={() => document.body.style.cursor = editorMode ? 'crosshair' : 'default'}
        onPointerOut={() => document.body.style.cursor = 'default'}
      >
        <meshStandardMaterial vertexColors roughness={0.9} metalness={0.1} />
      </mesh>
      
      {/* Computational Heatmap Overlay */}
      {editorMode && (
          <mesh geometry={geom} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
             <primitive object={heatmapMat} attach="material" />
          </mesh>
      )}
    </group>
  );
};

/// Enhanced City Building Component with Types
// Enhanced City Building Component with Rich Rooftop & Architectural Details
const CityBuilding: React.FC<BuildingData & { onClick?: (e: any) => void; nightFactor?: number }> = ({ type, position, scale, rotation, variant, onClick, nightFactor = 0 }) => {
  const [w, h, d] = scale;
  
  const Foundation = () => (
      <mesh position={[0, 0.2, 0]}>
          <boxGeometry args={[w + 1, 0.4, d + 1]} />
          <meshStandardMaterial color="#334155" />
      </mesh>
  );

  // -- RESIDENTIAL --
  if (type === BuildingType.Residential) {
      const style = variant % 3;

      const WindowBand: React.FC<{ y: number }> = ({ y }) => (
          <mesh position={[0, y, 0]}>
              <boxGeometry args={[w + 0.1, 1.4, d + 0.1]} />
              <meshStandardMaterial 
                color={COLORS.cityEmissive} 
                emissive="#f59e0b" 
                emissiveIntensity={0.8 + nightFactor * 2.4} 
                transparent 
                opacity={0.75} 
              />
          </mesh>
      );

      return (
          <group position={position} rotation={rotation} onClick={onClick}>
              <Foundation />
              
              {/* V0: The Eco-Pod (Rooftop solar canopy & botanical terrace) */}
              {style === 0 && (
                  <>
                      <mesh position={[0, h/2, 0]} castShadow receiveShadow>
                          <boxGeometry args={[w, h, d]} />
                          <meshStandardMaterial color="#f1f5f9" roughness={0.4} />
                      </mesh>
                      {/* Staggered Windows */}
                      {Array.from({ length: Math.floor(h/4) }).map((_, i) => (
                           <WindowBand key={i} y={(i * 4) + 2} />
                      ))}
                      {/* Rooftop Garden Base */}
                      <mesh position={[0, h + 0.2, 0]}>
                           <boxGeometry args={[w * 0.92, 0.4, d * 0.92]} />
                           <meshStandardMaterial color="#15803d" />
                      </mesh>
                      {/* Rooftop Shrubs */}
                      <mesh position={[-w * 0.25, h + 0.9, -d * 0.25]}>
                           <dodecahedronGeometry args={[0.9]} />
                           <meshStandardMaterial color="#16a34a" />
                      </mesh>
                      <mesh position={[w * 0.25, h + 0.8, -d * 0.2]}>
                           <dodecahedronGeometry args={[0.7]} />
                           <meshStandardMaterial color="#22c55e" />
                      </mesh>
                      {/* Tilted Rooftop Photovoltaic Canopy */}
                      <group position={[0, h + 1.6, d * 0.15]} rotation={[0.2, 0, 0]}>
                          <mesh castShadow>
                              <boxGeometry args={[w * 0.75, 0.12, d * 0.45]} />
                              <meshPhysicalMaterial 
                                color="#0f172a" 
                                roughness={0.1} 
                                metalness={0.9} 
                                emissive="#0284c7" 
                                emissiveIntensity={0.2 + nightFactor * 0.4}
                              />
                          </mesh>
                          {/* Metal Mounting Struts */}
                          <mesh position={[-w * 0.3, -0.6, 0]}>
                              <cylinderGeometry args={[0.06, 0.06, 1.2]} />
                              <meshStandardMaterial color="#94a3b8" metalness={0.8} />
                          </mesh>
                          <mesh position={[w * 0.3, -0.6, 0]}>
                              <cylinderGeometry args={[0.06, 0.06, 1.2]} />
                              <meshStandardMaterial color="#94a3b8" metalness={0.8} />
                          </mesh>
                      </group>
                  </>
              )}

              {/* V1: The Solar A-Frame (High Tech Solar Shingle Roof & Micro HVAC) */}
              {style === 1 && (
                  <>
                       <mesh position={[0, h/2, 0]} castShadow receiveShadow>
                          <boxGeometry args={[w, h, d]} />
                          <meshStandardMaterial color="#fff7ed" roughness={0.4} />
                      </mesh>
                      {Array.from({ length: Math.floor(h/3) }).map((_, i) => (
                          <mesh key={i} position={[0, i*3 + 1.5, 0]}>
                              <boxGeometry args={[w+0.1, 1, d+0.1]} />
                              <meshStandardMaterial color="#334155" />
                          </mesh>
                      ))}
                      {/* Monocrystalline Solar Roof */}
                      <mesh position={[0, h + 1.6, 0]} rotation={[0, Math.PI/4, 0]}>
                           <coneGeometry args={[w*0.82, 3.2, 4]} />
                           <meshPhysicalMaterial 
                                color="#1e3a8a" 
                                roughness={0.15} 
                                metalness={0.85} 
                                emissive="#38bdf8" 
                                emissiveIntensity={0.25 + nightFactor * 0.5} 
                           />
                      </mesh>
                      {/* Rooftop Micro-HVAC Fan Box */}
                      <mesh position={[w * 0.28, h + 0.6, d * 0.28]} castShadow>
                          <boxGeometry args={[1.2, 0.9, 1.2]} />
                          <meshStandardMaterial color="#64748b" metalness={0.6} />
                      </mesh>
                  </>
              )}

               {/* V2: The Vertical Garden (Cascading Green Terraces & Solarium Dome) */}
               {style === 2 && (
                  <>
                       {Array.from({ length: Math.floor(h/3) }).map((_, i) => (
                          <group key={i} position={[0, i*3 + 1.5, 0]}>
                              <mesh castShadow receiveShadow>
                                  <boxGeometry args={[w - (i*0.5), 2.8, d - (i*0.5)]} />
                                  <meshStandardMaterial color="#e2e8f0" />
                              </mesh>
                              {/* Green Planter Ledge */}
                              <mesh position={[0, 1.4, 0]}>
                                  <boxGeometry args={[w - (i*0.5) + 0.6, 0.4, d - (i*0.5) + 0.6]} />
                                  <meshStandardMaterial color={i % 2 === 0 ? "#16a34a" : "#22c55e"} />
                              </mesh>
                              {/* Warm Window */}
                              <mesh position={[0, 0, d/2 - (i*0.25)]}>
                                  <planeGeometry args={[2.2, 1.8]} />
                                  <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.8 + nightFactor * 2.2} />
                              </mesh>
                          </group>
                      ))}
                      {/* Rooftop Glass Solarium Dome */}
                      <mesh position={[0, h + 0.8, 0]}>
                          <sphereGeometry args={[1.5, 12, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
                          <meshPhysicalMaterial 
                            color="#e0f2fe" 
                            transmission={0.4} 
                            roughness={0.1} 
                            metalness={0.2} 
                            emissive="#fef08a" 
                            emissiveIntensity={0.4 + nightFactor * 1.8}
                          />
                      </mesh>
                  </>
              )}
          </group>
      )
  }

  // -- COMMERCIAL (Skyscraper) --
  if (type === BuildingType.Commercial) {
      const style = variant % 3;

      const GlassMat = <meshPhysicalMaterial 
            color="#e0f2fe" 
            transmission={0.25} 
            opacity={0.9} 
            metalness={0.6} 
            roughness={0.1} 
            emissive="#0ea5e9"
            emissiveIntensity={0.25 + nightFactor * 1.8}
      />;

      return (
        <group position={position} rotation={rotation} onClick={onClick}>
          <Foundation />
          
          {/* V0: Crystalline Spire (Glass monolith with observation deck & beacon mast) */}
          {style === 0 && (
              <>
                <mesh position={[0, h/2, 0]} castShadow receiveShadow>
                    <boxGeometry args={[w, h, d]} />
                    {GlassMat}
                </mesh>
                {/* Internal Glow Core */}
                <mesh position={[0, h/2, 0]}>
                    <boxGeometry args={[w*0.6, h, d*0.6]} />
                    <meshBasicMaterial color="#0284c7" />
                </mesh>
                {/* Structural Bands */}
                {Array.from({ length: Math.floor(h / 8) }).map((_, i) => (
                    <mesh key={i} position={[0, (i * 8) + 4, 0]}>
                        <boxGeometry args={[w + 0.2, 0.5, d + 0.2]} />
                        <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
                    </mesh>
                ))}
                {/* Rooftop Skydeck */}
                <mesh position={[0, h + 0.2, 0]}>
                    <boxGeometry args={[w * 0.9, 0.4, d * 0.9]} />
                    <meshStandardMaterial color="#334155" metalness={0.8} />
                </mesh>
                {/* Antenna Mast */}
                <mesh position={[0, h + 3.5, 0]}>
                    <cylinderGeometry args={[0.1, 0.4, 7, 8]} />
                    <meshStandardMaterial color="#94a3b8" metalness={0.9} />
                </mesh>
                {/* Flashing Red Aviation Beacon Tip */}
                <mesh position={[0, h + 7.2, 0]}>
                    <sphereGeometry args={[0.4, 8, 8]} />
                    <meshStandardMaterial 
                        color="#f43f5e" 
                        emissive="#f43f5e" 
                        emissiveIntensity={3.0 + nightFactor * 2.5} 
                        toneMapped={false} 
                    />
                </mesh>
              </>
          )}

          {/* V1: Tiered Bio-Tower (Stepped sky terraces with canopy trees) */}
          {style === 1 && (
              <>
                  {/* Base */}
                  <mesh position={[0, h * 0.25, 0]} castShadow receiveShadow>
                      <boxGeometry args={[w, h * 0.5, d]} />
                      <meshStandardMaterial color="#f8fafc" roughness={0.3} />
                  </mesh>
                  {/* Mid */}
                  <mesh position={[0, h * 0.65, 0]} castShadow receiveShadow>
                      <boxGeometry args={[w * 0.75, h * 0.3, d * 0.75]} />
                      {GlassMat}
                  </mesh>
                  {/* Top */}
                  <mesh position={[0, h * 0.9, 0]} castShadow receiveShadow>
                      <boxGeometry args={[w * 0.5, h * 0.2, d * 0.5]} />
                      {GlassMat}
                  </mesh>
                  {/* Green Terraces */}
                  <mesh position={[0, h * 0.5 + 0.1, 0]}>
                       <boxGeometry args={[w + 0.1, 0.2, d + 0.1]} />
                       <meshStandardMaterial color="#16a34a" />
                  </mesh>
                  <mesh position={[w * 0.35, h * 0.5 + 0.8, d * 0.35]}>
                       <dodecahedronGeometry args={[0.8]} />
                       <meshStandardMaterial color="#15803d" />
                  </mesh>
                  <mesh position={[0, h * 0.8 + 0.1, 0]}>
                       <boxGeometry args={[w * 0.75 + 0.1, 0.2, d * 0.75 + 0.1]} />
                       <meshStandardMaterial color="#16a34a" />
                  </mesh>
                  {/* Rooftop Solar Pergola */}
                  <mesh position={[0, h + 0.6, 0]}>
                       <boxGeometry args={[w * 0.45, 0.1, d * 0.45]} />
                       <meshPhysicalMaterial color="#0284c7" transmission={0.5} roughness={0.1} emissive="#0284c7" emissiveIntensity={0.5} />
                  </mesh>
              </>
          )}

          {/* V2: Exoskeleton Hub (Tech center with illuminated Drone Helipad) */}
          {style === 2 && (
              <>
                   <mesh position={[0, h/2, 0]} castShadow receiveShadow>
                        <boxGeometry args={[w * 0.9, h, d * 0.9]} />
                        <meshStandardMaterial color="#1e293b" roughness={0.5} />
                   </mesh>
                   {/* Cyber Lines */}
                   {Array.from({ length: 4 }).map((_, i) => (
                        <mesh key={i} position={[(i%2===0?1:-1)*w/2, h/2, (i<2?1:-1)*d/2]}>
                             <boxGeometry args={[0.5, h, 0.5]} />
                             <meshStandardMaterial color="#94a3b8" metalness={0.8} />
                        </mesh>
                   ))}
                   {/* Horizontal Cross Bracing */}
                   {Array.from({ length: Math.floor(h/6) }).map((_, i) => (
                       <group key={i} position={[0, i*6 + 3, 0]}>
                            <mesh>
                                <boxGeometry args={[w+0.2, 0.3, d+0.2]} />
                                <meshStandardMaterial color="#0ea5e9" emissive="#0ea5e9" emissiveIntensity={0.6 + nightFactor * 2.0} />
                            </mesh>
                       </group>
                   ))}
                   {/* Rooftop Drone Landing Helipad */}
                   <group position={[0, h + 0.1, 0]}>
                       <mesh receiveShadow>
                           <cylinderGeometry args={[w * 0.42, w * 0.44, 0.3, 24]} />
                           <meshStandardMaterial color="#0f172a" roughness={0.7} />
                       </mesh>
                       {/* Illuminated Helipad Target Ring */}
                       <mesh position={[0, 0.16, 0]} rotation={[-Math.PI/2, 0, 0]}>
                           <ringGeometry args={[w * 0.28, w * 0.34, 24]} />
                           <meshBasicMaterial color="#38bdf8" />
                       </mesh>
                       {/* Helipad 'H' Indicator Bar 1 */}
                       <mesh position={[-w * 0.1, 0.17, 0]} rotation={[-Math.PI/2, 0, 0]}>
                           <planeGeometry args={[0.3, w * 0.3]} />
                           <meshBasicMaterial color="#fbbf24" />
                       </mesh>
                       <mesh position={[w * 0.1, 0.17, 0]} rotation={[-Math.PI/2, 0, 0]}>
                           <planeGeometry args={[0.3, w * 0.3]} />
                           <meshBasicMaterial color="#fbbf24" />
                       </mesh>
                       <mesh position={[0, 0.17, 0]} rotation={[-Math.PI/2, 0, 0]}>
                           <planeGeometry args={[w * 0.2, 0.3]} />
                           <meshBasicMaterial color="#fbbf24" />
                       </mesh>
                   </group>
              </>
          )}

        </group>
      )
  }

  // -- PARK --
  if (type === BuildingType.Park) {
      return (
          <group position={position} onClick={onClick}>
              <mesh position={[0, 0.2, 0]} receiveShadow>
                  <boxGeometry args={[w, 0.4, d]} />
                  <meshStandardMaterial color="#22c55e" roughness={1} />
              </mesh>
              {/* Trees */}
              <mesh position={[-2, 1.5, -2]}>
                  <dodecahedronGeometry args={[1.2]} />
                  <meshStandardMaterial color="#15803d" />
              </mesh>
              <mesh position={[2, 2, 1]}>
                  <dodecahedronGeometry args={[1.5]} />
                  <meshStandardMaterial color="#166534" />
              </mesh>
              <mesh position={[0, 0.5, 0]}>
                  <cylinderGeometry args={[1, 1, 0.5]} />
                  <meshStandardMaterial color="#0ea5e9" roughness={0.1} />
              </mesh>
          </group>
      )
  }

  // -- ROAD --
  if (type === BuildingType.Road) {
      return (
          <group position={position} rotation={rotation} onClick={onClick}>
               <mesh position={[0, 0.1, 0]} receiveShadow>
                   <boxGeometry args={[12, 0.2, 12]} />
                   <meshStandardMaterial color="#1e293b" roughness={0.9} />
               </mesh>
               <mesh position={[-5.5, 0.2, 0]}>
                   <boxGeometry args={[1, 0.3, 12]} />
                   <meshStandardMaterial color="#cbd5e1" />
               </mesh>
               <mesh position={[5.5, 0.2, 0]}>
                   <boxGeometry args={[1, 0.3, 12]} />
                   <meshStandardMaterial color="#cbd5e1" />
               </mesh>
               <mesh position={[0, 0.21, 0]} rotation={[-Math.PI/2, 0, 0]}>
                   <planeGeometry args={[0.5, 8]} />
                   <meshBasicMaterial color="#fcd34d" transparent opacity={0.8} />
               </mesh>
               
               {/* Solarpunk Street Lamp */}
               <group position={[5, 0, 0]}>
                  <mesh position={[0, 2, 0]}>
                      <cylinderGeometry args={[0.1, 0.15, 4]} />
                      <meshStandardMaterial color="#64748b" />
                  </mesh>
                  <mesh position={[-0.5, 4, 0]} rotation={[0,0,Math.PI/4]}>
                      <boxGeometry args={[1.5, 0.1, 0.4]} />
                      <meshStandardMaterial color="#64748b" />
                  </mesh>
                  <mesh position={[-1, 3.8, 0]}>
                      <boxGeometry args={[0.5, 0.1, 0.3]} />
                      <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={1.2 + nightFactor * 3.5} />
                  </mesh>
               </group>
          </group>
      )
  }
  
  // -- FOREST (Procedural Grove) --
  if (type === BuildingType.Forest) {
      const seed = Math.abs(Math.sin(position[0] * 12.9898 + position[2] * 78.233));
      const treeCount = 5 + Math.floor(seed * 4);
      const trees = Array.from({length: treeCount}).map((_, i) => {
          const tSeed = (seed * (i + 1)) % 1;
          return {
              x: (tSeed - 0.5) * 8,
              z: ((tSeed * 10) % 1 - 0.5) * 8,
              scale: 0.8 + (tSeed * 0.8),
              type: tSeed > 0.6 ? 'oak' : 'pine',
              rot: tSeed * Math.PI * 2
          }
      });

      return (
        <group position={position} onClick={onClick}>
            {trees.map((t, i) => (
                 <group key={i} position={[t.x, 0, t.z]} rotation={[0, t.rot, 0]} scale={t.scale}>
                    {t.type === 'pine' ? (
                         <>
                            <mesh position={[0, 0.5, 0]}>
                                <cylinderGeometry args={[0.2, 0.3, 1, 6]} />
                                <meshStandardMaterial color="#3f2c20" roughness={1} />
                            </mesh>
                            <mesh position={[0, 2.0, 0]} castShadow receiveShadow>
                                <coneGeometry args={[1.5, 3, 5]} />
                                <meshStandardMaterial color="#14532d" flatShading roughness={0.9} />
                            </mesh>
                            <mesh position={[0, 3.5, 0]} castShadow receiveShadow>
                                <coneGeometry args={[1.0, 2.5, 5]} />
                                <meshStandardMaterial color="#166534" flatShading roughness={0.9} />
                            </mesh>
                         </>
                    ) : (
                         <>
                            <mesh position={[0, 0.4, 0]}>
                                <cylinderGeometry args={[0.3, 0.4, 0.8, 6]} />
                                <meshStandardMaterial color="#3f2c20" roughness={1} />
                            </mesh>
                            <mesh position={[0, 1.8, 0]} castShadow receiveShadow>
                                <dodecahedronGeometry args={[1.3]} />
                                <meshStandardMaterial color="#4ade80" flatShading roughness={0.9} />
                            </mesh>
                         </>
                    )}
                 </group>
            ))}
        </group>
      )
  }

  // -- MOUNTAIN (Procedural Peak) --
  if (type === BuildingType.Mountain) {
      const baseW = w * 0.5;
      const height = h;
      
      return (
          <group position={position} onClick={onClick}>
              <mesh position={[0, height * 0.4, 0]} castShadow receiveShadow>
                  <cylinderGeometry args={[0, baseW, height * 0.8, 4, 1]} />
                  <meshStandardMaterial color="#475569" flatShading roughness={0.9} />
              </mesh>
              <mesh position={[0, height * 0.65, 0]} rotation={[0, 0.1, 0]}>
                  <cylinderGeometry args={[0, baseW * 0.35, height * 0.3, 4, 1]} />
                  <meshStandardMaterial color="#f8fafc" flatShading roughness={0.1} />
              </mesh>
              <mesh position={[baseW * 0.6, height * 0.2, baseW * 0.2]} rotation={[0.2, 0.5, 0.1]} castShadow receiveShadow>
                  <cylinderGeometry args={[0, baseW * 0.5, height * 0.5, 4, 1]} />
                  <meshStandardMaterial color="#334155" flatShading roughness={0.9} />
              </mesh>
              <mesh position={[-baseW * 0.5, height * 0.15, -baseW * 0.3]} rotation={[-0.2, 1.2, -0.1]} castShadow receiveShadow>
                  <cylinderGeometry args={[0, baseW * 0.4, height * 0.4, 4, 1]} />
                  <meshStandardMaterial color="#334155" flatShading roughness={0.9} />
              </mesh>
          </group>
      )
  }

  return null;
};

// High-Tech Wind Turbine with Strobe Warning Beacon & Rotor Trail
const SingleTurbine = ({ position, scale, rotation, pulseIntensity }: any) => {
  const blades = useRef<THREE.Group>(null);
  const beaconRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state, delta) => {
    if (blades.current) {
        const speed = 0.5 + (pulseIntensity * 8.0); 
        blades.current.rotation.z -= speed * delta;
    }
    if (beaconRef.current) {
        // Synchronized aviation flash
        const flash = (Math.sin(state.clock.elapsedTime * 6.0) > 0.4) ? 3.5 : 0.2;
        beaconRef.current.emissiveIntensity = flash;
    }
  });

  return (
    <group position={position} scale={scale} rotation={rotation}>
      {/* Foundation Concrete Pad */}
      <mesh position={[0, 0.5, 0]} receiveShadow>
          <cylinderGeometry args={[0.9, 1.1, 1.2, 8]} />
          <meshStandardMaterial color="#64748b" roughness={0.8} />
      </mesh>
      {/* Base Power Inverter / Transformer Box */}
      <mesh position={[0.7, 0.8, 0]} castShadow>
          <boxGeometry args={[0.6, 0.8, 0.6]} />
          <meshStandardMaterial color="#1e293b" />
      </mesh>
      <mesh position={[0.7, 1.25, 0]}>
          <boxGeometry args={[0.15, 0.15, 0.15]} />
          <meshBasicMaterial color={COLORS.windGlow} />
      </mesh>
      {/* Slender Aerodynamic Tower */}
      <mesh position={[0, 9, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.2, 0.5, 18, 12]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.3} metalness={0.2} />
      </mesh>
      {/* Nacelle & Rotor Assembly */}
      <group position={[0, 18, 0]}>
         <mesh position={[0, 0, -0.6]} castShadow>
            <boxGeometry args={[0.7, 0.8, 2]} />
            <meshStandardMaterial color="#ffffff" roughness={0.2} metalness={0.4} />
         </mesh>
         {/* Aviation Strobe Beacon on top of nacelle */}
         <mesh position={[0, 0.5, -0.5]}>
             <sphereGeometry args={[0.18, 8, 8]} />
             <meshStandardMaterial 
                ref={beaconRef}
                color="#f43f5e" 
                emissive="#f43f5e" 
                emissiveIntensity={2.0} 
                toneMapped={false}
             />
         </mesh>
         {/* Luminous Intake Ring */}
         <mesh position={[0, 0, 0.4]} rotation={[Math.PI/2, 0, 0]}>
             <torusGeometry args={[0.3, 0.05, 8, 16]} />
             <meshStandardMaterial 
                color={COLORS.wind} 
                emissive={COLORS.windGlow} 
                emissiveIntensity={0.6 + pulseIntensity * 3} 
             />
         </mesh>
         {/* Rotor Blades */}
         <group ref={blades} position={[0, 0, 0.5]}>
            <mesh rotation={[Math.PI/2, 0, 0]}>
                 <sphereGeometry args={[0.45, 16, 16]} />
                 <meshStandardMaterial color="#e2e8f0" metalness={0.5} roughness={0.2} />
            </mesh>
            {[0, 1, 2].map((k) => (
                <group key={k} rotation={[0, 0, (k * Math.PI * 2) / 3]}>
                    <mesh position={[0, 4.2, 0]}>
                        <boxGeometry args={[0.35, 9, 0.12]} />
                        <meshStandardMaterial color="#ffffff" metalness={0.3} />
                    </mesh>
                    {/* Glowing Wingtip Fin */}
                    <mesh position={[0, 7.8, 0.06]}>
                         <planeGeometry args={[0.12, 1.8]} />
                         <meshBasicMaterial color={COLORS.windGlow} side={THREE.DoubleSide} toneMapped={false} />
                    </mesh>
                </group>
            ))}
         </group>
      </group>
    </group>
  )
};

// Centerpiece Solarpunk Energy Spire with Kinetic Gyro Rings, Floating Plasma Core & Apex Beacon
const CentralSpire: React.FC<{ nightFactor: number; gridEfficiency?: number }> = ({ nightFactor, gridEfficiency = 1.0 }) => {
    const ring1Ref = useRef<THREE.Group>(null);
    const ring2Ref = useRef<THREE.Group>(null);
    const ring3Ref = useRef<THREE.Group>(null);
    const coreRef = useRef<THREE.Mesh>(null);
    const shieldRef = useRef<THREE.Mesh>(null);
    const waveRing1 = useRef<THREE.Mesh>(null);
    const waveRing2 = useRef<THREE.Mesh>(null);

    useFrame((state, delta) => {
        const time = state.clock.getElapsedTime();

        // 3-Axis Concentric Gyro Gimbal Rotations
        if (ring1Ref.current) ring1Ref.current.rotation.x += delta * 1.1;
        if (ring2Ref.current) ring2Ref.current.rotation.y += delta * 1.6;
        if (ring3Ref.current) ring3Ref.current.rotation.z += delta * 0.85;

        // Breathing Plasma Core
        if (coreRef.current) {
            const scale = 1.0 + Math.sin(time * 3.5) * 0.15;
            coreRef.current.scale.set(scale, scale, scale);
            coreRef.current.rotation.y += delta * 0.5;
        }

        // Translucent Energy Containment Shield rotation
        if (shieldRef.current) {
            shieldRef.current.rotation.y -= delta * 0.3;
            shieldRef.current.rotation.x = Math.sin(time * 0.5) * 0.15;
        }

        // Ascending Energy Wave Pulses
        if (waveRing1.current) {
            const y1 = ((time * 18) % 65) + 5;
            waveRing1.current.position.y = y1;
            const op1 = Math.sin((y1 / 65) * Math.PI);
            waveRing1.current.scale.set(1 + op1 * 0.5, 1, 1 + op1 * 0.5);
        }
        if (waveRing2.current) {
            const y2 = (((time * 18) + 32.5) % 65) + 5;
            waveRing2.current.position.y = y2;
            const op2 = Math.sin((y2 / 65) * Math.PI);
            waveRing2.current.scale.set(1 + op2 * 0.5, 1, 1 + op2 * 0.5);
        }
    });

    return (
        <group position={[0, 0, 0]}>
            {/* Ground Podium & Energy Conduits */}
            <mesh position={[0, 0.4, 0]} receiveShadow>
                <cylinderGeometry args={[14, 16, 0.8, 12]} />
                <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[0, 0.85, 0]}>
                <ringGeometry args={[8, 12, 24]} />
                <meshBasicMaterial color="#38bdf8" transparent opacity={0.6 + nightFactor * 0.4} />
            </mesh>

            {/* Stepped Base Spire Structure */}
            <mesh position={[0, 15, 0]} castShadow receiveShadow>
                <cylinderGeometry args={[2.0, 5.5, 30, 8]} />
                <meshStandardMaterial 
                    color="#f8fafc" 
                    metalness={0.4} 
                    roughness={0.2} 
                />
            </mesh>
            {/* Vertical Conduit Light Guides */}
            {Array.from({ length: 4 }).map((_, i) => (
                <mesh key={i} position={[Math.cos(i * Math.PI / 2) * 3.6, 15, Math.sin(i * Math.PI / 2) * 3.6]}>
                    <boxGeometry args={[0.25, 28, 0.25]} />
                    <meshBasicMaterial color="#38bdf8" />
                </mesh>
            ))}

            {/* Ascending Energy Wave Rings */}
            <mesh ref={waveRing1} position={[0, 20, 0]} rotation={[Math.PI/2, 0, 0]}>
                <torusGeometry args={[3.2, 0.12, 8, 24]} />
                <meshBasicMaterial color="#38bdf8" transparent opacity={0.6} />
            </mesh>
            <mesh ref={waveRing2} position={[0, 35, 0]} rotation={[Math.PI/2, 0, 0]}>
                <torusGeometry args={[3.2, 0.12, 8, 24]} />
                <meshBasicMaterial color="#67e8f9" transparent opacity={0.6} />
            </mesh>

            {/* Upper Slender Spire Mast */}
            <mesh position={[0, 48, 0]} castShadow receiveShadow>
                <cylinderGeometry args={[0.8, 2.0, 36, 8]} />
                <meshStandardMaterial 
                    color="#f1f5f9" 
                    metalness={0.6} 
                    roughness={0.2} 
                />
            </mesh>

            {/* Kinetic Energy Chamber at Height Y=36 */}
            <group position={[0, 36, 0]}>
                {/* 1. Pulsating Plasma Energy Core */}
                <mesh ref={coreRef}>
                    <icosahedronGeometry args={[2.2, 2]} />
                    <meshBasicMaterial color="#38bdf8" toneMapped={false} />
                </mesh>
                <mesh>
                    <sphereGeometry args={[1.5, 16, 16]} />
                    <meshBasicMaterial color="#ffffff" toneMapped={false} />
                </mesh>

                {/* 2. Concentric Kinetic Gyro Rings */}
                <group ref={ring1Ref}>
                    <mesh>
                        <torusGeometry args={[4.2, 0.18, 8, 32]} />
                        <meshStandardMaterial 
                            color="#e2e8f0" 
                            metalness={0.9} 
                            roughness={0.1} 
                            emissive="#38bdf8" 
                            emissiveIntensity={0.8 + nightFactor * 1.5}
                        />
                    </mesh>
                </group>
                <group ref={ring2Ref}>
                    <mesh>
                        <torusGeometry args={[5.2, 0.18, 8, 32]} />
                        <meshStandardMaterial 
                            color="#cbd5e1" 
                            metalness={0.9} 
                            roughness={0.1} 
                            emissive="#0284c7" 
                            emissiveIntensity={0.8 + nightFactor * 1.5}
                        />
                    </mesh>
                </group>
                <group ref={ring3Ref}>
                    <mesh>
                        <torusGeometry args={[6.2, 0.18, 8, 32]} />
                        <meshStandardMaterial 
                            color="#94a3b8" 
                            metalness={0.9} 
                            roughness={0.1} 
                            emissive="#f59e0b" 
                            emissiveIntensity={0.7 + nightFactor * 1.5}
                        />
                    </mesh>
                </group>

                {/* 3. Translucent Quantum Forcefield */}
                <mesh ref={shieldRef}>
                    <icosahedronGeometry args={[7.2, 1]} />
                    <meshPhysicalMaterial 
                        color="#38bdf8" 
                        wireframe 
                        transparent 
                        opacity={0.35 + nightFactor * 0.3} 
                        emissive="#38bdf8" 
                        emissiveIntensity={0.5} 
                    />
                </mesh>
            </group>

            {/* Apex Crown & Luminescent Beacon at Height Y=68 */}
            <group position={[0, 68, 0]}>
                {/* Crown Solar Collector Fins */}
                {[0, 1, 2, 3].map((idx) => (
                    <mesh key={idx} rotation={[0, idx * Math.PI / 2, 0.18]} position={[Math.cos(idx*Math.PI/2)*0.8, 0, Math.sin(idx*Math.PI/2)*0.8]}>
                        <boxGeometry args={[0.1, 4.5, 0.8]} />
                        <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.2} />
                    </mesh>
                ))}
                {/* Glowing Apex Beacon Gem */}
                <mesh position={[0, 3.2, 0]}>
                    <octahedronGeometry args={[1.5, 0]} />
                    <meshBasicMaterial color={nightFactor > 0.4 ? "#38bdf8" : "#f59e0b"} toneMapped={false} />
                </mesh>
                {/* Soft Point Light radiating on rooftops */}
                <pointLight 
                    position={[0, 3.2, 0]} 
                    color={nightFactor > 0.4 ? "#38bdf8" : "#fbbf24"} 
                    intensity={2.5 + nightFactor * 3.5} 
                    distance={180} 
                    decay={2} 
                />
            </group>
        </group>
    );
};

// Energy Streams with Dynamic Photon Packet Particles sliding on Bezier curves
const EnergyStreams = ({ 
    stations, 
    target, 
    speedMultiplier, 
    color 
}: { 
    stations: EnergyStation[], 
    target: THREE.Vector3, 
    speedMultiplier: number, 
    color: string 
}) => {
    const shaderRef = useRef<THREE.ShaderMaterial>(null);
    const particleGroup = useRef<THREE.Group>(null);
    
    const curves = useMemo(() => {
        return stations.map(s => {
            const p1 = new THREE.Vector3(...s.position).add(new THREE.Vector3(0, s.type === 'WIND' ? 18 : 2, 0));
            const p3 = target.clone().add(new THREE.Vector3(0, 20, 0));
            const mid = p1.clone().lerp(p3, 0.5);
            mid.y += 32 + Math.random() * 15; 
            return new THREE.QuadraticBezierCurve3(p1, mid, p3);
        });
    }, [stations.length, target]);

    const mat = useMemo(() => {
        return new THREE.ShaderMaterial({
            vertexShader: EnergyFlowMaterial.vertexShader,
            fragmentShader: EnergyFlowMaterial.fragmentShader,
            uniforms: {
                time: { value: 0 },
                color: { value: new THREE.Color(color) },
                speed: { value: 1.0 },
                opacity: { value: 1.0 }
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
    }, [color]);

    useFrame((state) => {
        const time = state.clock.elapsedTime;
        if (shaderRef.current) {
            shaderRef.current.uniforms.time.value = time;
            shaderRef.current.uniforms.speed.value = 0.4 + (speedMultiplier * 2.8);
            shaderRef.current.uniforms.opacity.value = 0.5 + (speedMultiplier * 0.5);
        }

        // Update Photon Packets along each Bezier curve
        if (particleGroup.current) {
            const children = particleGroup.current.children;
            let childIdx = 0;
            const speed = 0.25 + speedMultiplier * 0.75;

            curves.forEach((curve) => {
                // 3 packets per stream
                for (let p = 0; p < 3; p++) {
                    if (childIdx < children.length) {
                        const mesh = children[childIdx] as THREE.Mesh;
                        const t = ((time * speed + p * 0.33) % 1.0);
                        const pos = curve.getPointAt(t);
                        mesh.position.copy(pos);
                        
                        // Scale pulses as it approaches center
                        const sc = 0.5 + Math.sin(t * Math.PI) * 0.6;
                        mesh.scale.set(sc, sc, sc);
                        childIdx++;
                    }
                }
            });
        }
    });

    if (shaderRef.current === null) {
        // @ts-ignore
        shaderRef.current = mat;
    }

    return (
        <group>
            {/* Stream Tubes */}
            {curves.map((curve, i) => (
                <mesh key={i}>
                    <tubeGeometry args={[curve, 48, 0.28, 8, false]} />
                    <primitive object={mat} attach="material" />
                </mesh>
            ))}

            {/* Photon Energy Packets */}
            <group ref={particleGroup}>
                {curves.map((_, curveIdx) => (
                    <React.Fragment key={curveIdx}>
                        <mesh>
                            <sphereGeometry args={[0.6, 8, 8]} />
                            <meshBasicMaterial color={color} toneMapped={false} />
                        </mesh>
                        <mesh>
                            <sphereGeometry args={[0.6, 8, 8]} />
                            <meshBasicMaterial color="#ffffff" toneMapped={false} />
                        </mesh>
                        <mesh>
                            <sphereGeometry args={[0.6, 8, 8]} />
                            <meshBasicMaterial color={color} toneMapped={false} />
                        </mesh>
                    </React.Fragment>
                ))}
            </group>
        </group>
    );
};

const PlacementCursor = ({ active, tool }: { active: boolean, tool: EditorTool }) => {
    const ref = useRef<THREE.Group>(null);
    
    useFrame(({ raycaster, scene, camera, pointer }) => {
        if (!active || !ref.current) return;
        
        raycaster.setFromCamera(pointer, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        const hit = intersects.find(i => (i.object as THREE.Mesh).geometry?.type === 'PlaneGeometry');
        
        if (hit) {
            let p = hit.point.clone();
            
            // Grid Snap for Urban tools
            if (['ADD_RESIDENTIAL', 'ADD_COMMERCIAL', 'ADD_PARK', 'ADD_ROAD', 'ADD_FOREST', 'ADD_MOUNTAIN'].includes(tool)) {
                p.x = Math.round(p.x / 12) * 12; // 12 unit spacing
                p.z = Math.round(p.z / 12) * 12;
                p.y = getTerrainHeight(p.x, p.z);
            }

            ref.current.position.copy(p);
            ref.current.visible = true;
        } else {
            ref.current.visible = false;
        }
    });

    if (!active || tool === 'SELECT' || tool === 'REMOVE') return null;

    let ghost = null;
    const isUrban = ['ADD_RESIDENTIAL', 'ADD_COMMERCIAL', 'ADD_PARK', 'ADD_ROAD', 'ADD_FOREST', 'ADD_MOUNTAIN'].includes(tool);

    if (tool === 'ADD_TURBINE') {
        ghost = <cylinderGeometry args={[0.2, 0.5, 12]} />;
    } else if (tool === 'ADD_SOLAR') {
        ghost = <boxGeometry args={[3, 0.5, 4]} />;
    } else if (tool === 'ADD_FOREST') {
        ghost = <cylinderGeometry args={[1, 1, 4]} />;
    } else if (tool === 'ADD_MOUNTAIN') {
        ghost = <coneGeometry args={[4, 8, 4]} />;
    } else if (isUrban) {
        ghost = <boxGeometry args={[8, 4, 8]} />;
    }

    return (
        <group ref={ref}>
            <mesh position={[0, 0.1, 0]} rotation={[-Math.PI/2, 0, 0]}>
                <ringGeometry args={[1, isUrban ? 5 : 1.5, 32]} />
                <meshBasicMaterial color="#10b981" opacity={0.5} transparent />
            </mesh>
            {ghost && (
                 <mesh position={[0, 2, 0]}>
                     {ghost}
                     <meshBasicMaterial color={isUrban ? "#6366f1" : COLORS.wind} wireframe opacity={0.3} transparent />
                 </mesh>
            )}
        </group>
    )
};

// --- Main Scene ---

// Preset Camera Coordinates for Cinematic Director
const CAMERA_PRESETS: Record<CameraPreset, { pos: THREE.Vector3; target: THREE.Vector3 }> = {
  OVERVIEW: { pos: new THREE.Vector3(-110, 85, 110), target: new THREE.Vector3(0, 15, 0) },
  SPIRE: { pos: new THREE.Vector3(-28, 44, 28), target: new THREE.Vector3(0, 36, 0) },
  WIND_RIDGE: { pos: new THREE.Vector3(115, 36, -85), target: new THREE.Vector3(50, 15, -45) },
  SKYLINE: { pos: new THREE.Vector3(-55, 16, -45), target: new THREE.Vector3(0, 12, 0) },
  ECO_LAKE: { pos: new THREE.Vector3(130, 40, 70), target: new THREE.Vector3(75, 4, 25) },
};

const SceneContent = ({ 
    gestureState, 
    appMode, 
    sceneData, 
    editorTool, 
    onStationUpdate, 
    onBuildingUpdate, 
    envSettings,
    cameraPreset,
    autoRotate,
}: { 
    gestureState: React.MutableRefObject<GestureState>, 
    appMode: AppMode, 
    sceneData: SceneData, 
    editorTool: EditorTool, 
    onStationUpdate: (s: EnergyStation[]) => void, 
    onBuildingUpdate: (b: BuildingData[]) => void, 
    envSettings: { windSpeed: number, sunPos: number, cloudCover: number },
    cameraPreset: CameraPreset,
    autoRotate: boolean,
}) => {
  const dirLight = useRef<THREE.DirectionalLight>(null);
  const hemiLight = useRef<THREE.HemisphereLight>(null);
  const ambLight = useRef<THREE.AmbientLight>(null);
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const isTransitioningRef = useRef(false);
  const targetCamPos = useRef(new THREE.Vector3(-110, 85, 110));
  const targetCamTarget = useRef(new THREE.Vector3(0, 15, 0));

  useEffect(() => {
    const config = CAMERA_PRESETS[cameraPreset];
    if (config) {
      targetCamPos.current.copy(config.pos);
      targetCamTarget.current.copy(config.target);
      isTransitioningRef.current = true;
    }
  }, [cameraPreset]);
  
  const [solarPulse, setSolarPulse] = useState(0);
  const [windPulse, setWindPulse] = useState(0);
  const [nightFactor, setNightFactor] = useState(0);
  const [duskFactor, setDuskFactor] = useState(0);
  const [fogColor, setFogColor] = useState(COLORS.fog);

  const sunTarget = useRef(new THREE.Vector3(100, 150, 50));
  const sunPosVec = useRef(new THREE.Vector3(100, 150, 50));

  // Color caches for lighting transitions
  const daySunCol = useMemo(() => new THREE.Color('#fffdf5'), []);
  const sunsetSunCol = useMemo(() => new THREE.Color('#f97316'), []);
  const nightMoonCol = useMemo(() => new THREE.Color('#93c5fd'), []);

  const dayHemiSky = useMemo(() => new THREE.Color('#bae6fd'), []);
  const sunsetHemiSky = useMemo(() => new THREE.Color('#fdba74'), []);
  const nightHemiSky = useMemo(() => new THREE.Color('#1e1b4b'), []);

  const dayHemiGround = useMemo(() => new THREE.Color('#334155'), []);
  const sunsetHemiGround = useMemo(() => new THREE.Color('#451a03'), []);
  const nightHemiGround = useMemo(() => new THREE.Color('#020617'), []);

  const dayFogCol = useMemo(() => new THREE.Color('#cbd5e1'), []);
  const sunsetFogCol = useMemo(() => new THREE.Color('#9a3412'), []);
  const nightFogCol = useMemo(() => new THREE.Color('#020617'), []);

  const currentSunCol = useRef(new THREE.Color());
  const currentSkyHemi = useRef(new THREE.Color());
  const currentGroundHemi = useRef(new THREE.Color());
  const currentFogCol = useRef(new THREE.Color());

  useFrame((state, delta) => {
    const time = state.clock.getElapsedTime();

    // Smooth Camera Transition toward active preset
    if (isTransitioningRef.current) {
      state.camera.position.lerp(targetCamPos.current, delta * 3.5);
      if (controlsRef.current) {
        controlsRef.current.target.lerp(targetCamTarget.current, delta * 3.5);
        controlsRef.current.update();
      }
      if (state.camera.position.distanceTo(targetCamPos.current) < 0.5) {
        isTransitioningRef.current = false;
      }
    }

    if (appMode === 'EXPERIENCE') {
        const gs = gestureState.current;
        
        // Joystick Orbit control
        if (gs.joystick.active && controlsRef.current) {
            isTransitioningRef.current = false;
            const rotateSpeed = 2.0 * delta;
            controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + gs.joystick.deltaX * rotateSpeed);
            const polarSpeed = 1.5 * delta;
            const currentPolar = controlsRef.current.getPolarAngle();
            const newPolar = THREE.MathUtils.clamp(currentPolar - gs.joystick.deltaY * polarSpeed, 0.5, Math.PI / 2.1);
            controlsRef.current.setPolarAngle(newPolar);
            controlsRef.current.update();
        } else if (controlsRef.current) {
            controlsRef.current.autoRotate = autoRotate;
        }

        // Helios Sun Positioning
        if (gs.helios.active) {
            const angle = gs.helios.x * Math.PI * 2;
            const radius = 220;
            const elevation = (gs.helios.y - 0.2) * Math.PI / 1.6;
            sunTarget.current.set(
                Math.cos(angle) * Math.cos(elevation) * radius,
                Math.sin(elevation) * radius,
                Math.sin(angle) * Math.cos(elevation) * radius
            );
        } else {
            const tAngle = time * 0.06;
            sunTarget.current.set(
                Math.cos(tAngle) * 180,
                Math.sin(Math.PI * (0.28 + Math.sin(time * 0.08) * 0.24)) * 170,
                Math.sin(tAngle) * 180
            );
        }

        // Pulse
        const targetSolar = gs.helios.active ? 0.5 + (gs.helios.pinching ? gs.helios.pinchStrength * 0.5 : 0) : 0.05;
        const targetWind = gs.wind.active ? 0.6 + gs.wind.strength * 1.4 : 0.05;
        setSolarPulse(THREE.MathUtils.lerp(solarPulse, targetSolar, delta * 4));
        setWindPulse(THREE.MathUtils.lerp(windPulse, targetWind, delta * 4));

    } else {
        // Planner Mode: Solar Arc synced with sunPos slider
        if (controlsRef.current) controlsRef.current.autoRotate = autoRotate;
        
        // Solar azimuth: sweeps from East (-70 deg) to West (+70 deg)
        const azAngle = (envSettings.sunPos - 0.5) * Math.PI * 0.75;
        // Sun elevation: rises at 0.0, peaks at 0.5, sets at 1.0, dips slightly negative at endpoints for twilight
        const elevAngle = Math.sin(envSettings.sunPos * Math.PI);
        const radius = 220;
        
        const sx = Math.sin(azAngle) * radius;
        const sy = (elevAngle * 190) - ((envSettings.sunPos > 0.94 || envSettings.sunPos < 0.06) ? 20 : 0);
        const sz = Math.cos(azAngle) * (radius * 0.55);
        
        sunTarget.current.set(sx, sy, sz);

        setWindPulse(THREE.MathUtils.lerp(windPulse, envSettings.windSpeed, delta * 2));
        
        const sunFactor = Math.max(0, Math.sin(envSettings.sunPos * Math.PI));
        const cloudFactor = 1 - (envSettings.cloudCover * 0.8);
        setSolarPulse(THREE.MathUtils.lerp(solarPulse, sunFactor * cloudFactor * 0.5, delta * 2));
    }
    
    // Smoothly track sun position
    sunPosVec.current.lerp(sunTarget.current, delta * 2.5);

    // Calculate Day, Dusk, and Night transitions
    const sunElevRatio = Math.max(-0.25, sunPosVec.current.y / 180);
    const targetNight = THREE.MathUtils.clamp((0.18 - sunElevRatio) / 0.28, 0, 1);
    const targetDusk = THREE.MathUtils.clamp(1.0 - Math.abs(sunElevRatio - 0.12) * 5.5, 0, 1);

    const newNight = THREE.MathUtils.lerp(nightFactor, targetNight, delta * 3.5);
    const newDusk = THREE.MathUtils.lerp(duskFactor, targetDusk, delta * 3.5);
    setNightFactor(newNight);
    setDuskFactor(newDusk);

    // Dynamic Light Colors & Intensities
    if (dirLight.current) {
        dirLight.current.position.copy(sunPosVec.current);
        
        // Sun color blend: Day -> Sunset -> Moonlight
        currentSunCol.current.copy(daySunCol).lerp(sunsetSunCol, newDusk * (1 - newNight * 0.8));
        currentSunCol.current.lerp(nightMoonCol, newNight);
        dirLight.current.color.copy(currentSunCol.current);

        // Intensity: Bright warm sun at noon -> soft amber at sunset -> cool dim moonlight at night
        const dayIntensity = 2.4 * (1 - envSettings.cloudCover * 0.5);
        const duskIntensity = 1.8 * (1 - envSettings.cloudCover * 0.4);
        const nightIntensity = 0.45 * (1 - envSettings.cloudCover * 0.3);

        const targetIntensity = THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(dayIntensity, duskIntensity, newDusk),
            nightIntensity,
            newNight
        );
        dirLight.current.intensity = THREE.MathUtils.lerp(dirLight.current.intensity, targetIntensity, delta * 3);
    }

    if (hemiLight.current) {
        currentSkyHemi.current.copy(dayHemiSky).lerp(sunsetHemiSky, newDusk);
        currentSkyHemi.current.lerp(nightHemiSky, newNight);
        hemiLight.current.color.copy(currentSkyHemi.current);

        currentGroundHemi.current.copy(dayHemiGround).lerp(sunsetHemiGround, newDusk);
        currentGroundHemi.current.lerp(nightHemiGround, newNight);
        hemiLight.current.groundColor.copy(currentGroundHemi.current);

        const hemiTargetIntensity = THREE.MathUtils.lerp(0.65, 0.25, newNight);
        hemiLight.current.intensity = THREE.MathUtils.lerp(hemiLight.current.intensity, hemiTargetIntensity, delta * 3);
    }

    if (ambLight.current) {
        const ambTarget = THREE.MathUtils.lerp(0.35, 0.18, newNight);
        ambLight.current.intensity = THREE.MathUtils.lerp(ambLight.current.intensity, ambTarget, delta * 3);
    }

    // Dynamic Fog calculation
    currentFogCol.current.copy(dayFogCol).lerp(sunsetFogCol, newDusk);
    currentFogCol.current.lerp(nightFogCol, newNight);
    setFogColor(`#${currentFogCol.current.getHexString()}`);
  });

  const handleTerrainClick = (point: THREE.Vector3) => {
    if (appMode !== 'PLANNER' || editorTool === 'SELECT' || editorTool === 'REMOVE') return;

    // Energy Placement
    if (['ADD_TURBINE', 'ADD_SOLAR'].includes(editorTool)) {
        const y = point.y;
        const heightEff = Math.min(1.0, (y + 10) / 30); 
        
        const newStation: EnergyStation = {
            id: Date.now().toString(),
            type: editorTool === 'ADD_TURBINE' ? 'WIND' : 'SOLAR',
            position: [point.x, point.y, point.z],
            rotation: [0, Math.random() * 6, 0],
            scale: editorTool === 'ADD_TURBINE' ? (0.8 + Math.random()*0.3) : 1,
            efficiency: editorTool === 'ADD_TURBINE' ? 0.8 + heightEff * 0.2 : 0.9,
            output: 0
        };
        onStationUpdate([...sceneData.stations, newStation]);
        return;
    }

    // Urban Placement: Snap to 12 unit grid
    const sx = Math.round(point.x / 12) * 12;
    const sz = Math.round(point.z / 12) * 12;
    const sy = getTerrainHeight(sx, sz);

    let type = BuildingType.Residential;
    let scale: [number, number, number] = [8, 10, 8];
    
    if (editorTool === 'ADD_COMMERCIAL') { type = BuildingType.Commercial; scale = [8, 25, 8]; }
    else if (editorTool === 'ADD_PARK') { type = BuildingType.Park; scale = [8, 0.5, 8]; }
    else if (editorTool === 'ADD_ROAD') { type = BuildingType.Road; scale = [12, 0.2, 12]; }
    else if (editorTool === 'ADD_FOREST') { type = BuildingType.Forest; scale = [10, 1, 10]; }
    else if (editorTool === 'ADD_MOUNTAIN') { type = BuildingType.Mountain; scale = [12, 18, 12]; }

    const filtered = sceneData.city.buildings.filter(b => {
        const dx = b.position[0] - sx;
        const dz = b.position[2] - sz;
        return Math.sqrt(dx*dx + dz*dz) > 4;
    });

    const newBuilding: BuildingData = {
        id: `build-${Date.now()}`,
        type: type,
        position: [sx, sy, sz],
        scale: scale,
        rotation: [0, 0, 0],
        variant: Math.floor(Math.random() * 3)
    };

    onBuildingUpdate([...filtered, newBuilding]);
  };

  const handleObjectClick = (e: ThreeEvent<MouseEvent>, id: string, kind: 'STATION' | 'BUILDING') => {
      if (appMode === 'PLANNER' && editorTool === 'REMOVE') {
          e.stopPropagation();
          if (kind === 'STATION') {
              onStationUpdate(sceneData.stations.filter(s => s.id !== id));
          } else {
              onBuildingUpdate(sceneData.city.buildings.filter(b => b.id !== id));
          }
      }
  };

  const windStations = useMemo(() => sceneData.stations.filter(s => s.type === 'WIND'), [sceneData.stations]);
  const solarStations = useMemo(() => sceneData.stations.filter(s => s.type === 'SOLAR'), [sceneData.stations]);

  // Atmospheric parameters for Drei Sky
  const skyTurbidity = 6.0 + duskFactor * 14.0 + nightFactor * 8.0;
  const skyRayleigh = 0.4 + duskFactor * 3.6 + nightFactor * 0.2;
  const skyMieCoeff = 0.005 + duskFactor * 0.035;

  return (
    <>
      <fog attach="fog" args={[fogColor, 90, 480]} />
      
      {/* Soft Outdoor Ambient & Hemisphere Bounce Lighting */}
      <ambientLight ref={ambLight} intensity={0.3} color="#e0f2fe" />
      <hemisphereLight 
        ref={hemiLight}
        skyColor="#bae6fd"
        groundColor="#334155"
        intensity={0.65}
      />
      
      {/* Dynamic Key Sun / Moon Directional Light with Tuned Soft Shadows */}
      <directionalLight 
        ref={dirLight}
        intensity={2.2} 
        color="#fffbeb"
        castShadow 
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00015}
        shadow-normalBias={0.025}
      >
        <orthographicCamera attach="shadow-camera" args={[-170, 170, 170, -170, 10, 550]} />
      </directionalLight>

      {/* Dynamic Procedural Sky & Night Starfield */}
      <Sky 
        distance={1200}
        sunPosition={[
            sunPosVec.current.x, 
            Math.max(sunPosVec.current.y, 2), 
            sunPosVec.current.z
        ]}
        turbidity={skyTurbidity}
        rayleigh={skyRayleigh}
        mieCoefficient={skyMieCoeff}
        mieDirectionalG={0.82}
      />

      {nightFactor > 0.1 && (
        <Stars 
            radius={280} 
            depth={60} 
            count={3500} 
            factor={4.5} 
            saturation={0} 
            fade 
            speed={1.2} 
        />
      )}

      {/* Diorama Island Cliff Base */}
      <DioramaBase nightFactor={nightFactor} />

      {/* Main Terrain */}
      <Terrain editorMode={appMode === 'PLANNER'} onPlace={handleTerrainClick} />

      {/* Animated Water Basin & Wetland Lily Filters */}
      <WaterBasin nightFactor={nightFactor} />
      
      {/* City Buildings */}
      <group>
        {sceneData.city.buildings.map((b) => (
             <CityBuilding 
                key={b.id} 
                {...b} 
                nightFactor={nightFactor}
                onClick={(e) => handleObjectClick(e, b.id, 'BUILDING')}
             />
        ))}
         {/* Central Solarpunk Energy Spire */}
         <CentralSpire nightFactor={nightFactor} />
      </group>
      
      {/* Stations */}
      <group> 
          {windStations.map(s => (
              <group key={s.id} onClick={(e) => handleObjectClick(e, s.id, 'STATION')}>
                 <SingleTurbine position={s.position} scale={s.scale} rotation={s.rotation} pulseIntensity={windPulse} />
              </group>
          ))}
          
          <Instances range={solarStations.length} castShadow receiveShadow>
            <boxGeometry args={[3, 0.15, 4]} />
            <meshPhysicalMaterial 
                color="#0f172a" 
                roughness={0.15} 
                metalness={0.85} 
                emissive={COLORS.solar} 
                emissiveIntensity={0.15 + nightFactor * 0.4} 
            />
            {solarStations.map(s => (
                <group key={s.id} onClick={(e) => handleObjectClick(e, s.id, 'STATION')}>
                     <Instance position={s.position} rotation={s.rotation} />
                </group>
            ))}
          </Instances>
      </group>

      {/* Autonomous Ground & Aerial Transit Network */}
      <TransitNetwork buildings={sceneData.city.buildings} nightFactor={nightFactor} />

      <EnergyStreams stations={windStations} target={sceneData.city.target} speedMultiplier={windPulse} color={COLORS.windGlow} />
      <EnergyStreams stations={solarStations} target={sceneData.city.target} speedMultiplier={solarPulse} color={COLORS.solarGlow} />

      <PlacementCursor active={appMode === 'PLANNER'} tool={editorTool} />
      
      <OrbitControls 
        ref={controlsRef}
        autoRotate={autoRotate}
        autoRotateSpeed={0.5} 
        minDistance={30}
        maxDistance={380}
        enableDamping
        enabled={true}
        onStart={() => {
          isTransitioningRef.current = false;
        }}
      />
    </>
  );
};

const IsoMap = ({ appMode }: { appMode: AppMode }) => {
  const [sceneData, setSceneData] = useState<SceneData>(() => generateInitialData());
  const [editorTool, setEditorTool] = useState<EditorTool>('SELECT');
  const [envSettings, setEnvSettings] = useState({ windSpeed: 0.5, sunPos: 0.5, cloudCover: 0.1 });
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('OVERVIEW');
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  
  // Computational Design Engine: Calculate Metrics
  const metrics = useMemo<SimulationMetrics>(() => {
    let windOut = 0;
    let solarOut = 0;
    let cost = 0;
    let consume = SIM_CONFIG.CITY_DEMAND_BASE;
    let pop = 0;

    // 1. Calculate Supply & Cost
    sceneData.stations.forEach(s => {
        if (s.type === 'WIND') {
            const power = SIM_CONFIG.BASE_WIND_OUTPUT * s.efficiency * (0.5 + envSettings.windSpeed);
            windOut += power;
            cost += SIM_CONFIG.COST_TURBINE;
        } else {
            const sunFactor = Math.max(0, Math.sin(envSettings.sunPos * Math.PI));
            const weatherFactor = 1 - (envSettings.cloudCover * 0.9);
            const power = SIM_CONFIG.BASE_SOLAR_OUTPUT * s.efficiency * sunFactor * weatherFactor;
            solarOut += power;
            cost += SIM_CONFIG.COST_SOLAR;
        }
    });

    // 2. Calculate Consumption & Population
    sceneData.city.buildings.forEach(b => {
        const def = BUILDINGS[b.type];
        if (def) {
            consume += def.powerConsume;
            cost += def.cost / 1000; // Scaled down for display
            pop += def.popGen;
        }
    });

    const total = windOut + solarOut;
    const net = total - consume;
    
    return {
        totalPower: total,
        consumption: consume,
        netStatus: net > 10 ? 'SURPLUS' : net < -5 ? 'DEFICIT' : 'BALANCED',
        windOutput: windOut,
        solarOutput: solarOut,
        gridLoad: (total / consume) * 100,
        efficiencyScore: 85,
        cost: cost,
        population: pop
    };
  }, [sceneData, envSettings]);

  const gestureStateRef = useRef<GestureState>({
    joystick: { active: false, deltaX: 0, deltaY: 0, position: { x: 0, y: 0 } },
    helios: { active: false, x: 0.5, y: 0.5, pinching: false, pinchStrength: 0 },
    wind: { active: false, strength: 0 }
  });

  return (
    <div className="w-full h-full relative">
      {/* Floating Cinematic Camera Director Dock */}
      <div className="absolute top-6 left-6 z-40">
        <CameraDock
          currentPreset={cameraPreset}
          onSelectPreset={(p) => {
            setCameraPreset(p);
          }}
          autoRotate={autoRotate}
          onToggleAutoRotate={() => setAutoRotate((prev) => !prev)}
        />
      </div>

      <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}>
        <PerspectiveCamera makeDefault position={[-110, 85, 110]} fov={35} />
        
        <SceneContent 
            appMode={appMode}
            gestureState={gestureStateRef} 
            sceneData={sceneData}
            editorTool={editorTool}
            onStationUpdate={(stations) => setSceneData(prev => ({ ...prev, stations }))}
            onBuildingUpdate={(buildings) => setSceneData(prev => ({ ...prev, city: { ...prev.city, buildings } }))}
            envSettings={envSettings}
            cameraPreset={cameraPreset}
            autoRotate={autoRotate}
        />

        <EffectComposer disableNormalPass>
            <Bloom luminanceThreshold={0.7} mipmapBlur intensity={1.2} radius={0.5} />
            <Vignette eskil={false} offset={0.1} darkness={0.4} />
            <ToneMapping mode={THREE.ACESFilmicToneMapping} />
        </EffectComposer>
      </Canvas>

      {appMode === 'EXPERIENCE' && (
          <HandControlSystem onGestureUpdate={(s) => gestureStateRef.current = s} />
      )}
      
      {appMode === 'PLANNER' && (
          <PlannerUI 
            activeTool={editorTool} 
            onToolChange={setEditorTool} 
            metrics={metrics}
            envSettings={envSettings}
            onEnvChange={(k, v) => setEnvSettings(p => ({...p, [k]: v}))}
          />
      )}
    </div>
  );
};

export default IsoMap;