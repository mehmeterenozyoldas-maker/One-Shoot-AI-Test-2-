/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Environment, Instances, Instance, BakeShadows, PerspectiveCamera } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { COLORS, SCENE_SIZE, TURBINE_COUNT, SOLAR_COUNT, SIM_CONFIG, BUILDINGS } from '../constants';
import { AppMode, EditorTool, EnergyStation, GestureState, SceneData, SimulationMetrics, BuildingData, BuildingType } from '../types';
import { HandControlSystem } from './HandControlSystem';
import { PlannerUI } from './PlannerUI';

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
      // Create distinct "packets" of energy traveling down the line
      float segments = 3.0; // Number of concurrent pulses
      float travel = vUv.x * segments - time * speed * 3.0;
      
      // The "Sawtooth" wave for the pulse (0.0 to 1.0)
      float pulseShape = fract(travel);
      
      // Shape it into a bolt: Sharp head (near 1.0), long tail (towards 0.0)
      float intensity = pow(pulseShape, 12.0); 
      
      // Add a subtle secondary shimmer layer
      float shimmer = sin(vUv.x * 30.0 - time * 10.0) * 0.5 + 0.5;
      intensity += shimmer * 0.05;

      // Base visibility so the line is never fully invisible
      float baseGlow = 0.1;
      
      // Calculate final alpha
      float alpha = (baseGlow + intensity) * opacity;
      
      // Soft fade at start and end of the tube
      alpha *= smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
      
      // Color Logic: Mix base color with white at high intensity
      vec3 finalColor = mix(color, vec3(1.0), intensity * 0.7);
      
      // Bloom Boost: Multiply color values > 1.0 for HDR glow
      finalColor *= (1.2 + intensity * 8.0);
      
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

// Enhanced City Building Component with Types
const CityBuilding: React.FC<BuildingData & { onClick?: (e: any) => void }> = ({ type, position, scale, rotation, variant, onClick }) => {
  const [w, h, d] = scale;
  
  const isNature = type === BuildingType.Forest || type === BuildingType.Mountain;

  const Foundation = () => (
      <mesh position={[0, 0.2, 0]}>
          <boxGeometry args={[w + 1, 0.4, d + 1]} />
          <meshStandardMaterial color="#334155" />
      </mesh>
  );

  // -- RESIDENTIAL --
  if (type === BuildingType.Residential) {
      const style = variant % 3;

      // Common: Warm light for homes
      const WindowBand: React.FC<{ y: number }> = ({ y }) => (
          <mesh position={[0, y, 0]}>
              <boxGeometry args={[w + 0.1, 1.5, d + 0.1]} />
              <meshStandardMaterial color={COLORS.cityEmissive} emissive="#f59e0b" emissiveIntensity={1.0} transparent opacity={0.6} />
          </mesh>
      );

      return (
          <group position={position} rotation={rotation} onClick={onClick}>
              <Foundation />
              
              {/* V0: The Eco-Pod (Modern, Flat, Balconies) */}
              {style === 0 && (
                  <>
                      <mesh position={[0, h/2, 0]} castShadow receiveShadow>
                          <boxGeometry args={[w, h, d]} />
                          <meshStandardMaterial color="#f1f5f9" />
                      </mesh>
                      {/* Staggered Windows */}
                      {Array.from({ length: Math.floor(h/4) }).map((_, i) => (
                           <WindowBand key={i} y={(i * 4) + 2} />
                      ))}
                      {/* Rooftop Garden */}
                      <mesh position={[0, h + 0.2, 0]}>
                           <boxGeometry args={[w * 0.9, 0.4, d * 0.9]} />
                           <meshStandardMaterial color="#4ade80" />
                      </mesh>
                      <mesh position={[1, h + 1, 1]}>
                           <dodecahedronGeometry args={[1]} />
                           <meshStandardMaterial color="#166534" />
                      </mesh>
                  </>
              )}

              {/* V1: The Solar A-Frame (Classic shape, High Tech Roof) */}
              {style === 1 && (
                  <>
                       <mesh position={[0, h/2, 0]} castShadow receiveShadow>
                          <boxGeometry args={[w, h, d]} />
                          <meshStandardMaterial color="#fff7ed" />
                      </mesh>
                      {Array.from({ length: Math.floor(h/3) }).map((_, i) => (
                          <mesh key={i} position={[0, i*3 + 1.5, 0]}>
                              <boxGeometry args={[w+0.1, 1, d+0.1]} />
                              <meshStandardMaterial color="#334155" />
                          </mesh>
                      ))}
                      {/* Solar Roof */}
                      <mesh position={[0, h + 1.5, 0]} rotation={[0, Math.PI/4, 0]}>
                           <coneGeometry args={[w*0.8, 3, 4]} />
                           <meshPhysicalMaterial color="#1e3a8a" roughness={0.2} metalness={0.8} />
                      </mesh>
                  </>
              )}

               {/* V2: The Vertical Garden (Stacked, Greenery heavy) */}
               {style === 2 && (
                  <>
                       {Array.from({ length: Math.floor(h/3) }).map((_, i) => (
                          <group key={i} position={[0, i*3 + 1.5, 0]}>
                              <mesh castShadow receiveShadow>
                                  <boxGeometry args={[w - (i*0.5), 2.8, d - (i*0.5)]} />
                                  <meshStandardMaterial color="#e2e8f0" />
                              </mesh>
                              {/* Green Ledge */}
                              <mesh position={[0, 1.4, 0]}>
                                  <boxGeometry args={[w - (i*0.5) + 0.5, 0.4, d - (i*0.5) + 0.5]} />
                                  <meshStandardMaterial color="#22c55e" />
                              </mesh>
                              {/* Warm Window */}
                              <mesh position={[0, 0, d/2]}>
                                  <planeGeometry args={[2, 2]} />
                                  <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.8} />
                              </mesh>
                          </group>
                      ))}
                  </>
              )}
          </group>
      )
  }

  // -- COMMERCIAL (Skyscraper) --
  if (type === BuildingType.Commercial) {
      const style = variant % 3;

      // Common: Cool light for offices
      const GlassMat = <meshPhysicalMaterial 
            color="#e0f2fe" 
            transmission={0.2} 
            opacity={0.9}
            metalness={0.5} 
            roughness={0.1} 
            emissive="#0ea5e9"
            emissiveIntensity={0.3}
      />;

      return (
        <group position={position} rotation={rotation} onClick={onClick}>
          <Foundation />
          
          {/* V0: Crystalline Spire (Glass monolith) */}
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
                {/* Antenna */}
                <mesh position={[0, h + 3, 0]}>
                    <cylinderGeometry args={[0.1, 0.5, 6]} />
                    <meshStandardMaterial color="#94a3b8" emissive="#f43f5e" emissiveIntensity={2} />
                </mesh>
              </>
          )}

          {/* V1: Tiered Bio-Tower (Setbacks with green roofs) */}
          {style === 1 && (
              <>
                  {/* Base */}
                  <mesh position={[0, h * 0.25, 0]} castShadow receiveShadow>
                      <boxGeometry args={[w, h * 0.5, d]} />
                      <meshStandardMaterial color="#f8fafc" />
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
                       <boxGeometry args={[w, 0.2, d]} />
                       <meshStandardMaterial color="#16a34a" />
                  </mesh>
                  <mesh position={[0, h * 0.8 + 0.1, 0]}>
                       <boxGeometry args={[w * 0.75, 0.2, d * 0.75]} />
                       <meshStandardMaterial color="#16a34a" />
                  </mesh>
              </>
          )}

          {/* V2: Exoskeleton Hub (Tech/Data Center look) */}
          {style === 2 && (
              <>
                   <mesh position={[0, h/2, 0]} castShadow receiveShadow>
                        <boxGeometry args={[w * 0.9, h, d * 0.9]} />
                        <meshStandardMaterial color="#1e293b" />
                   </mesh>
                   {/* Cyber Lines */}
                   {Array.from({ length: 4 }).map((_, i) => (
                        <mesh key={i} position={[(i%2===0?1:-1)*w/2, h/2, (i<2?1:-1)*d/2]}>
                             <boxGeometry args={[0.5, h, 0.5]} />
                             <meshStandardMaterial color="#94a3b8" />
                        </mesh>
                   ))}
                   {/* Horizontal Cross Bracing */}
                   {Array.from({ length: Math.floor(h/6) }).map((_, i) => (
                       <group key={i} position={[0, i*6 + 3, 0]}>
                            <mesh>
                                <boxGeometry args={[w+0.2, 0.3, d+0.2]} />
                                <meshStandardMaterial color="#0ea5e9" emissive="#0ea5e9" emissiveIntensity={0.8} />
                            </mesh>
                       </group>
                   ))}
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
               {/* Asphalt - Lifted slightly to 0.1 and thickened to 0.2 to prevent z-fighting with terrain */}
               <mesh position={[0, 0.1, 0]} receiveShadow>
                   <boxGeometry args={[12, 0.2, 12]} />
                   <meshStandardMaterial color="#1e293b" roughness={0.9} />
               </mesh>
               {/* Sidewalks - Lifted to match */}
               <mesh position={[-5.5, 0.2, 0]}>
                   <boxGeometry args={[1, 0.3, 12]} />
                   <meshStandardMaterial color="#cbd5e1" />
               </mesh>
               <mesh position={[5.5, 0.2, 0]}>
                   <boxGeometry args={[1, 0.3, 12]} />
                   <meshStandardMaterial color="#cbd5e1" />
               </mesh>
               {/* Center Markings (Dashed Yellow) */}
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
                  {/* Glowing Solar Light */}
                  <mesh position={[-1, 3.8, 0]}>
                      <boxGeometry args={[0.5, 0.1, 0.3]} />
                      <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={2} />
                  </mesh>
               </group>
          </group>
      )
  }
  
  // -- FOREST (Procedural Grove) --
  if (type === BuildingType.Forest) {
      // Deterministic layout based on position
      const seed = Math.abs(Math.sin(position[0] * 12.9898 + position[2] * 78.233));
      const treeCount = 5 + Math.floor(seed * 4); // 5-8 trees
      const trees = Array.from({length: treeCount}).map((_, i) => {
          const tSeed = (seed * (i + 1)) % 1;
          return {
              x: (tSeed - 0.5) * 8, // Spread within 10x10 area
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
                            {/* Pine Trunk */}
                            <mesh position={[0, 0.5, 0]}>
                                <cylinderGeometry args={[0.2, 0.3, 1, 6]} />
                                <meshStandardMaterial color="#3f2c20" roughness={1} />
                            </mesh>
                            {/* Pine Foliage - Low Poly Stack */}
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
                            {/* Oak Trunk */}
                            <mesh position={[0, 0.4, 0]}>
                                <cylinderGeometry args={[0.3, 0.4, 0.8, 6]} />
                                <meshStandardMaterial color="#3f2c20" roughness={1} />
                            </mesh>
                            {/* Oak Foliage */}
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
      // Use dimensions to create a main peak and sub-peaks
      const baseW = w * 0.5; // Radius
      const height = h;
      
      return (
          <group position={position} onClick={onClick}>
              {/* Main Peak - 4 Sided Pyramid Style */}
              <mesh position={[0, height * 0.4, 0]} castShadow receiveShadow>
                  <cylinderGeometry args={[0, baseW, height * 0.8, 4, 1]} />
                  <meshStandardMaterial color="#475569" flatShading roughness={0.9} />
              </mesh>
              
              {/* Snow Cap */}
              <mesh position={[0, height * 0.65, 0]} rotation={[0, 0.1, 0]}>
                  <cylinderGeometry args={[0, baseW * 0.35, height * 0.3, 4, 1]} />
                  <meshStandardMaterial color="#f8fafc" flatShading roughness={0.1} />
              </mesh>

              {/* Sub Peak 1 */}
              <mesh position={[baseW * 0.6, height * 0.2, baseW * 0.2]} rotation={[0.2, 0.5, 0.1]} castShadow receiveShadow>
                  <cylinderGeometry args={[0, baseW * 0.5, height * 0.5, 4, 1]} />
                  <meshStandardMaterial color="#334155" flatShading roughness={0.9} />
              </mesh>

              {/* Sub Peak 2 */}
              <mesh position={[-baseW * 0.5, height * 0.15, -baseW * 0.3]} rotation={[-0.2, 1.2, -0.1]} castShadow receiveShadow>
                  <cylinderGeometry args={[0, baseW * 0.4, height * 0.4, 4, 1]} />
                  <meshStandardMaterial color="#334155" flatShading roughness={0.9} />
              </mesh>
          </group>
      )
  }

  // Fallback
  return null;
}

const SingleTurbine = ({ position, scale, rotation, pulseIntensity }: any) => {
  const blades = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (blades.current) {
        const speed = 0.5 + (pulseIntensity * 8.0); 
        blades.current.rotation.z -= speed * delta;
    }
  });

  return (
    <group position={position} scale={scale} rotation={rotation}>
      <mesh position={[0, 0.5, 0]} receiveShadow>
          <cylinderGeometry args={[0.7, 0.9, 1.2, 8]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.8} />
      </mesh>
      <mesh position={[0, 9, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.2, 0.5, 18, 12]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.3} />
      </mesh>
      <group position={[0, 18, 0]}>
         <mesh position={[0, 0, -0.6]} castShadow>
            <boxGeometry args={[0.7, 0.8, 2]} />
            <meshStandardMaterial color="#ffffff" roughness={0.2} />
         </mesh>
         <mesh position={[0, 0, 0.4]} rotation={[Math.PI/2, 0, 0]}>
             <torusGeometry args={[0.3, 0.05, 8, 16]} />
             <meshStandardMaterial 
                color={COLORS.wind} 
                emissive={COLORS.windGlow} 
                emissiveIntensity={0.5 + pulseIntensity * 3} 
             />
         </mesh>
         <group ref={blades} position={[0, 0, 0.5]}>
            <mesh rotation={[Math.PI/2, 0, 0]}>
                 <sphereGeometry args={[0.45, 16, 16]} />
                 <meshStandardMaterial color="#e2e8f0" metalness={0.5} roughness={0.2} />
            </mesh>
            {[0, 1, 2].map((k) => (
                <group key={k} rotation={[0, 0, (k * Math.PI * 2) / 3]}>
                    <mesh position={[0, 4.2, 0]}>
                        <boxGeometry args={[0.4, 9, 0.15]} />
                        <meshStandardMaterial color="#ffffff" />
                    </mesh>
                    <mesh position={[0, 7.5, 0.08]}>
                         <planeGeometry args={[0.1, 2]} />
                         <meshBasicMaterial color={COLORS.windGlow} side={THREE.DoubleSide} toneMapped={false} />
                    </mesh>
                </group>
            ))}
         </group>
      </group>
    </group>
  )
}

const EnergyStreams = ({ stations, target, speedMultiplier, color }: { stations: EnergyStation[], target: THREE.Vector3, speedMultiplier: number, color: string }) => {
    const shaderRef = useRef<THREE.ShaderMaterial>(null);
    
    const curves = useMemo(() => {
        return stations.map(s => {
            const p1 = new THREE.Vector3(...s.position).add(new THREE.Vector3(0, s.type === 'WIND' ? 18 : 2, 0));
            const p3 = target;
            const mid = p1.clone().lerp(p3, 0.5);
            mid.y += 30 + Math.random() * 20; 
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
        if (shaderRef.current) {
            shaderRef.current.uniforms.time.value = state.clock.elapsedTime;
            shaderRef.current.uniforms.speed.value = 0.3 + (speedMultiplier * 2.5);
            shaderRef.current.uniforms.opacity.value = 0.4 + (speedMultiplier * 0.6);
        }
    });

    if (shaderRef.current === null) {
        // @ts-ignore
        shaderRef.current = mat;
    }

    return (
        <group>
            {curves.map((curve, i) => (
                <mesh key={i}>
                    <tubeGeometry args={[curve, 40, 0.25, 6, false]} />
                    <primitive object={mat} attach="material" />
                </mesh>
            ))}
        </group>
    )
}

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

    // Ghost visual based on tool
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
}

// --- Main Scene ---

const SceneContent = ({ 
    gestureState, 
    appMode, 
    sceneData, 
    editorTool, 
    onStationUpdate,
    onBuildingUpdate,
    envSettings
}: { 
    gestureState: React.MutableRefObject<GestureState>, 
    appMode: AppMode, 
    sceneData: SceneData,
    editorTool: EditorTool,
    onStationUpdate: (s: EnergyStation[]) => void,
    onBuildingUpdate: (b: BuildingData[]) => void,
    envSettings: { windSpeed: number, sunPos: number, cloudCover: number }
}) => {
  const dirLight = useRef<THREE.DirectionalLight>(null);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  
  const [solarPulse, setSolarPulse] = useState(0);
  const [windPulse, setWindPulse] = useState(0);
  const sunTarget = useRef(new THREE.Vector3(100, 150, 50));

  useFrame((state, delta) => {
    // Shared Logic
    const time = state.clock.getElapsedTime();

    if (appMode === 'EXPERIENCE') {
        const gs = gestureState.current;
        
        // Joystick
        if (gs.joystick.active && controlsRef.current) {
            const rotateSpeed = 2.0 * delta;
            controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + gs.joystick.deltaX * rotateSpeed);
            const polarSpeed = 1.5 * delta;
            const currentPolar = controlsRef.current.getPolarAngle();
            const newPolar = THREE.MathUtils.clamp(currentPolar - gs.joystick.deltaY * polarSpeed, 0.5, Math.PI / 2.1);
            controlsRef.current.setPolarAngle(newPolar);
            controlsRef.current.update();
        } else if (controlsRef.current) {
            controlsRef.current.autoRotate = true;
        }

        // Helios
        if (gs.helios.active) {
            const angle = gs.helios.x * Math.PI * 2;
            const radius = 180;
            const elevation = Math.max(0.1, gs.helios.y) * Math.PI / 2;
            sunTarget.current.set(Math.cos(angle) * Math.cos(elevation) * radius, Math.sin(elevation) * radius, Math.sin(angle) * Math.cos(elevation) * radius);
        } else {
            sunTarget.current.set(100, Math.sin(Math.PI * (0.2 + Math.sin(time*0.1) * 0.2)) * 150, Math.cos(Math.PI * (0.2 + Math.sin(time*0.1) * 0.2)) * 150);
        }

        // Pulse
        const targetSolar = gs.helios.active ? 0.5 + (gs.helios.pinching ? gs.helios.pinchStrength * 0.5 : 0) : 0.05;
        const targetWind = gs.wind.active ? 0.6 + gs.wind.strength * 1.4 : 0.05;
        setSolarPulse(THREE.MathUtils.lerp(solarPulse, targetSolar, delta * 4));
        setWindPulse(THREE.MathUtils.lerp(windPulse, targetWind, delta * 4));

    } else {
        // Planner
        if (controlsRef.current) controlsRef.current.autoRotate = false;
        
        const angle = -Math.PI/2 + (envSettings.sunPos * Math.PI); 
        const radius = 200;
        sunTarget.current.set(Math.sin(angle)*radius, Math.abs(Math.cos(angle))*radius, 50);

        setWindPulse(THREE.MathUtils.lerp(windPulse, envSettings.windSpeed, delta * 2));
        
        // Solar Pulse depends on Sun Pos AND Cloud Cover in Planner Mode
        const sunFactor = Math.max(0, Math.sin(envSettings.sunPos * Math.PI));
        const cloudFactor = 1 - (envSettings.cloudCover * 0.8); // Clouds dampen signal
        setSolarPulse(THREE.MathUtils.lerp(solarPulse, sunFactor * cloudFactor * 0.5, delta * 2));
    }
    
    if (dirLight.current) {
        dirLight.current.position.lerp(sunTarget.current, delta * 2.0);
        // Dim light if cloudy
        const intensity = 2.0 * (1 - envSettings.cloudCover * 0.6);
        dirLight.current.intensity = THREE.MathUtils.lerp(dirLight.current.intensity, intensity, delta);
    }
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

    // Urban Placement
    // Snap to grid for buildings
    const sx = Math.round(point.x / 12) * 12; // 12 unit spacing matches generated city
    const sz = Math.round(point.z / 12) * 12;
    const sy = getTerrainHeight(sx, sz);

    let type = BuildingType.Residential;
    let scale: [number, number, number] = [8, 10, 8];
    
    if (editorTool === 'ADD_COMMERCIAL') { type = BuildingType.Commercial; scale = [8, 25, 8]; }
    else if (editorTool === 'ADD_PARK') { type = BuildingType.Park; scale = [8, 0.5, 8]; }
    else if (editorTool === 'ADD_ROAD') { type = BuildingType.Road; scale = [12, 0.2, 12]; }
    else if (editorTool === 'ADD_FOREST') { type = BuildingType.Forest; scale = [10, 1, 10]; }
    else if (editorTool === 'ADD_MOUNTAIN') { type = BuildingType.Mountain; scale = [12, 18, 12]; }

    // Remove existing building at same spot to prevent overlap
    const filtered = sceneData.city.buildings.filter(b => {
        const dx = b.position[0] - sx;
        const dz = b.position[2] - sz;
        return Math.sqrt(dx*dx + dz*dz) > 4; // Check close proximity
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

  return (
    <>
      <fog attach="fog" args={[COLORS.fog, 80, 400]} />
      <ambientLight intensity={0.4} color="#e0f2fe" />
      <directionalLight 
        ref={dirLight}
        intensity={2.0} 
        color="#fffbeb"
        castShadow 
        shadow-mapSize={[2048, 2048]}
      >
        <orthographicCamera attach="shadow-camera" args={[-150, 150, 150, -150]} />
      </directionalLight>

      <Terrain editorMode={appMode === 'PLANNER'} onPlace={handleTerrainClick} />
      
      {/* City Buildings */}
      <group>
        {sceneData.city.buildings.map((b) => (
             <CityBuilding 
                key={b.id} 
                {...b} 
                onClick={(e) => handleObjectClick(e, b.id, 'BUILDING')}
             />
        ))}
         {/* Central Hub */}
         <mesh position={[0, 35, 0]} castShadow>
            <cylinderGeometry args={[1, 2.5, 80, 8]} />
            <meshStandardMaterial color="#ffffff" emissive="#e0f2fe" emissiveIntensity={0.6} />
        </mesh>
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
            <meshPhysicalMaterial color="#0f172a" roughness={0.15} metalness={0.85} emissive={COLORS.solar} emissiveIntensity={0.15} />
            {solarStations.map(s => (
                <group key={s.id} onClick={(e) => handleObjectClick(e, s.id, 'STATION')}>
                     <Instance position={s.position} rotation={s.rotation} />
                </group>
            ))}
          </Instances>
      </group>

      <EnergyStreams stations={windStations} target={sceneData.city.target} speedMultiplier={windPulse} color={COLORS.windGlow} />
      <EnergyStreams stations={solarStations} target={sceneData.city.target} speedMultiplier={solarPulse} color={COLORS.solarGlow} />

      <PlacementCursor active={appMode === 'PLANNER'} tool={editorTool} />

      <Environment preset="city" blur={1} background />
      <BakeShadows />
      
      <OrbitControls 
        ref={controlsRef}
        autoRotate={true}
        autoRotateSpeed={0.5} 
        minDistance={40}
        maxDistance={350}
        enableDamping
        enabled={true} 
      />
    </>
  );
};

const IsoMap = ({ appMode }: { appMode: AppMode }) => {
  const [sceneData, setSceneData] = useState<SceneData>(() => generateInitialData());
  const [editorTool, setEditorTool] = useState<EditorTool>('SELECT');
  const [envSettings, setEnvSettings] = useState({ windSpeed: 0.5, sunPos: 0.5, cloudCover: 0.1 });
  
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
            // New: Cloud cover reduces solar efficiency
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
      <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}>
        <PerspectiveCamera makeDefault position={[-100, 80, 100]} fov={35} />
        
        <SceneContent 
            appMode={appMode}
            gestureState={gestureStateRef} 
            sceneData={sceneData}
            editorTool={editorTool}
            onStationUpdate={(stations) => setSceneData(prev => ({ ...prev, stations }))}
            onBuildingUpdate={(buildings) => setSceneData(prev => ({ ...prev, city: { ...prev.city, buildings } }))}
            envSettings={envSettings}
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