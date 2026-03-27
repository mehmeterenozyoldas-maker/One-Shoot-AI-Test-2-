/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GestureState } from '../types';

interface HandControlSystemProps {
  onGestureUpdate: (state: GestureState) => void;
}

// Configuration
const CONFIG = {
  // Logic
  JOYSTICK_CENTER: { x: 0.75, y: 0.6 }, // Raw coords (User Left = Image Right)
  JOYSTICK_DEADZONE: 0.04,
  JOYSTICK_RANGE: 0.2, 
  PINCH_THRESHOLD: 0.1, 
  
  // Blowing Logic (Vision based)
  PUCKER_THRESHOLD: 0.55, 
  OPEN_THRESHOLD: 0.05,
  
  // Visuals
  COLOR_ORBIT: '#06b6d4', // Cyan
  COLOR_HELIOS: '#f59e0b', // Amber (Sun)
  COLOR_WIND: '#a5f3fc', // Light Cyan (Wind)
  HUD_OPACITY: 0.3,
};

export const HandControlSystem = ({ onGestureUpdate }: HandControlSystemProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data Refs to sync between callbacks and render loop
  const latestHands = useRef<any>(null);
  const latestFace = useRef<any>(null);

  // Keep track of instances to clean up
  const instances = useRef<{hands: any, faceMesh: any, camera: any}>({ hands: null, faceMesh: null, camera: null });

  // Mutable state passed to parent
  const gestureState = useRef<GestureState>({
    joystick: { active: false, deltaX: 0, deltaY: 0, position: { x: 0, y: 0 } },
    helios: { active: false, x: 0.5, y: 0.5, pinching: false, pinchStrength: 0 },
    wind: { active: false, strength: 0 }
  });

  const triggerInit = useCallback(() => {
    // Force re-render to trigger useEffect logic if needed, 
    // or we can reload the page which is often cleaner for MediaPipe re-init
    window.location.reload();
  }, []);

  const handleGrantPermission = async () => {
      try {
          setError(null);
          setIsInitializing(true);
          // Explicitly request stream to trigger browser permission prompt
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          
          // If we get here, permission was granted.
          // Stop this temporary stream so MediaPipe can take over.
          stream.getTracks().forEach(t => t.stop());
          
          // Reloading ensures a clean slate for MediaPipe
          triggerInit();
      } catch (e: any) {
          console.error("Permission denied explicitly", e);
          setIsInitializing(false);
          if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
              setError("Camera permission denied. Please enable camera access in your browser settings.");
          } else {
              setError(`Camera error: ${e.message}`);
          }
      }
  };

  useEffect(() => {
    let isMounted = true;
    let animFrame: number;

    const waitForGlobals = async () => {
        let attempts = 0;
        // Poll for 10 seconds (20 * 500ms)
        while (attempts < 20) {
            if (window.Hands && window.FaceMesh && window.Camera) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }
        return false;
    };

    const loadModels = async () => {
      if (!isMounted) return;
      setIsInitializing(true);
      setError(null);

      try {
        if (!window.Hands || !window.FaceMesh || !window.Camera) {
            throw new Error("MediaPipe libraries failed to load from CDN.");
        }

        // --- 1. Initialize Hands ---
        const hands = new window.Hands({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });
        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        hands.onResults((results: any) => { 
            if (isMounted) latestHands.current = results; 
        });
        instances.current.hands = hands;

        // --- 2. Initialize Face Mesh ---
        const faceMesh = new window.FaceMesh({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        faceMesh.onResults((results: any) => { 
            if (isMounted) latestFace.current = results; 
        });
        instances.current.faceMesh = faceMesh;

        // --- 3. Initialize Camera ---
        if (videoRef.current) {
          const camera = new window.Camera(videoRef.current, {
            onFrame: async () => {
              if (!isMounted || !videoRef.current) return;
              
              try {
                  if (instances.current.hands) {
                     await instances.current.hands.send({image: videoRef.current});
                  }
                  if (instances.current.faceMesh) {
                     await instances.current.faceMesh.send({image: videoRef.current});
                  }
              } catch (err) {
                  // Ignore send errors during teardown
              }
            },
            width: 640,
            height: 480
          });
          
          try {
            await camera.start();
            instances.current.camera = camera;
          } catch (cameraErr: any) {
            // Check specifically for permission errors from MediaPipe's internal getUserMedia call
            console.error("MediaPipe Camera start error:", cameraErr);
            throw new Error("Camera permission denied or device unavailable.");
          }
        }

        if (isMounted) setIsInitializing(false);

      } catch (e: any) {
        console.error("Failed to load MediaPipe/Camera", e);
        if (isMounted) {
            setIsInitializing(false);
            if (e.message.includes("permission") || e.name === "NotAllowedError") {
                setError("Camera permission denied.");
            } else {
                setError("System error: Failed to access camera.");
            }
        }
      }
    };

    // --- Main Render & Logic Loop ---
    const renderLoop = () => {
      if (!isMounted) return;
      if (canvasRef.current) {
         processFrame();
      }
      animFrame = requestAnimationFrame(renderLoop);
    };

    const processFrame = () => {
      if (!canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;
      const width = canvasRef.current.width;
      const height = canvasRef.current.height;

      // 1. Clear & Setup
      ctx.save();
      ctx.clearRect(0, 0, width, height);
      ctx.translate(width, 0);
      ctx.scale(-1, 1);

      // 2. Static Zones
      drawHudZones(ctx, width, height);

      // 3. Process State
      const currentJoystick = { ...gestureState.current.joystick, active: false };
      const currentHelios = { ...gestureState.current.helios, active: false };
      const currentWind = { ...gestureState.current.wind, active: false, strength: 0 };

      // --- HANDS LOGIC ---
      if (latestHands.current && latestHands.current.multiHandLandmarks) {
        for (let i = 0; i < latestHands.current.multiHandLandmarks.length; i++) {
          const landmarks = latestHands.current.multiHandLandmarks[i];
          const isLeftHandZone = landmarks[0].x > 0.5;

          if (isLeftHandZone) {
            // Left Hand: Joystick
            const palmX = landmarks[9].x;
            const palmY = landmarks[9].y;
            const rawDx = palmX - CONFIG.JOYSTICK_CENTER.x;
            const rawDy = palmY - CONFIG.JOYSTICK_CENTER.y;
            const dist = Math.sqrt(rawDx*rawDx + rawDy*rawDy);
            let deltaX = 0, deltaY = 0;

            if (dist > CONFIG.JOYSTICK_DEADZONE) {
               const effectiveDist = Math.min(dist, CONFIG.JOYSTICK_RANGE) - CONFIG.JOYSTICK_DEADZONE;
               const normalizedMag = effectiveDist / (CONFIG.JOYSTICK_RANGE - CONFIG.JOYSTICK_DEADZONE);
               const angle = Math.atan2(rawDy, rawDx);
               deltaX = Math.cos(angle) * normalizedMag;
               deltaY = Math.sin(angle) * normalizedMag;
            }

            drawJoystickVisuals(ctx, width, height, landmarks, deltaX, deltaY, CONFIG.COLOR_ORBIT);
            
            currentJoystick.active = Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01;
            currentJoystick.deltaX = -deltaX; 
            currentJoystick.deltaY = deltaY;
            currentJoystick.position = { x: palmX, y: palmY };

          } else {
            // Right Hand: Helios
            const palm = landmarks[9];
            const thumb = landmarks[4];
            const index = landmarks[8];
            
            let controlX = (0.5 - palm.x) * 2.0; 
            controlX = Math.max(0, Math.min(1, controlX));
            let controlY = 1.0 - palm.y;
            controlY = Math.max(0, Math.min(1, controlY));

            const distance = Math.hypot(thumb.x - index.x, thumb.y - index.y);
            const clampDist = Math.max(0, Math.min(distance, CONFIG.PINCH_THRESHOLD));
            const rawStrength = 1 - (clampDist / CONFIG.PINCH_THRESHOLD);
            const pinchStrength = Math.pow(rawStrength, 2);

            drawHeliosVisuals(ctx, width, height, landmarks, pinchStrength, CONFIG.COLOR_HELIOS);

            currentHelios.active = true;
            currentHelios.x = controlX;
            currentHelios.y = controlY;
            currentHelios.pinching = pinchStrength > 0.1;
            currentHelios.pinchStrength = pinchStrength;
          }
        }
      }

      // --- FACE LOGIC (Blowing) ---
      if (latestFace.current && latestFace.current.multiFaceLandmarks && latestFace.current.multiFaceLandmarks.length > 0) {
        const landmarks = latestFace.current.multiFaceLandmarks[0];
        
        const mouthLeft = landmarks[61];
        const mouthRight = landmarks[291];
        const faceLeft = landmarks[454];
        const faceRight = landmarks[234];
        const lipTop = landmarks[13];
        const lipBot = landmarks[14];

        const mouthWidth = Math.hypot(mouthLeft.x - mouthRight.x, mouthLeft.y - mouthRight.y);
        const faceWidth = Math.hypot(faceLeft.x - faceRight.x, faceLeft.y - faceRight.y);
        const lipHeight = Math.hypot(lipTop.x - lipBot.x, lipTop.y - lipBot.y);
        
        const puckerRatio = mouthWidth / (faceWidth || 1); 
        const openRatio = lipHeight / (mouthWidth || 1); 

        if (puckerRatio < CONFIG.PUCKER_THRESHOLD && openRatio > CONFIG.OPEN_THRESHOLD) {
            const range = 0.25;
            const val = Math.max(0, CONFIG.PUCKER_THRESHOLD - puckerRatio);
            const strength = Math.min(1, val / range);
            
            currentWind.active = true;
            currentWind.strength = 0.3 + (strength * 0.7); 
            
            drawWindVisuals(ctx, width, height, landmarks, currentWind.strength, CONFIG.COLOR_WIND);
        }
      }

      gestureState.current = { joystick: currentJoystick, helios: currentHelios, wind: currentWind };
      onGestureUpdate(gestureState.current);
      ctx.restore();
    };

    const init = async () => {
        setIsInitializing(true);
        const ready = await waitForGlobals();
        
        if (!isMounted) return;
        
        if (ready) {
            loadModels();
            renderLoop();
        } else {
            setError("Failed to load computer vision libraries. Please check internet connection.");
            setIsInitializing(false);
        }
    };

    init();

    // CLEANUP
    return () => {
      isMounted = false;
      cancelAnimationFrame(animFrame);
      
      if (instances.current.camera) {
          try { instances.current.camera.stop(); } catch(e) {}
          instances.current.camera = null;
      }
      if (instances.current.hands) {
          try { instances.current.hands.close(); } catch(e) {}
          instances.current.hands = null;
      }
      if (instances.current.faceMesh) {
          try { instances.current.faceMesh.close(); } catch(e) {}
          instances.current.faceMesh = null;
      }
    };
  }, [onGestureUpdate]);

  return (
    <div className="absolute top-4 right-4 z-20 flex flex-col items-end pointer-events-none select-none">
      <div className="relative rounded-xl overflow-hidden border border-slate-700/50 bg-slate-900/90 shadow-2xl w-56 h-40 backdrop-blur-sm pointer-events-auto">
        
        {isInitializing && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 z-20">
            <div className="flex flex-col items-center gap-2">
                <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-[10px] text-emerald-400 font-mono tracking-widest uppercase">Initializing Vision</span>
            </div>
          </div>
        )}
        
        {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-slate-900 z-30">
                <p className="text-[10px] text-rose-400 font-mono leading-relaxed mb-3">{error}</p>
                <button 
                  onClick={handleGrantPermission}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded uppercase tracking-wide transition-colors"
                >
                  Enable Camera
                </button>
            </div>
        )}

        <video 
            ref={videoRef} 
            className="absolute inset-0 w-full h-full object-cover opacity-30 transform scale-x-[-1] filter grayscale" 
            playsInline 
            muted
        />
        <canvas 
            ref={canvasRef} 
            className="absolute inset-0 w-full h-full object-cover" 
            width={640} 
            height={480} 
        />
        
        {/* Labels */}
        {!error && !isInitializing && (
            <div className="absolute inset-0 flex pointer-events-none">
                <div className="w-1/2 h-full flex items-end justify-start p-2 border-r border-white/5">
                    <div className="flex flex-col">
                        <span className={`text-[8px] font-bold tracking-widest uppercase transition-colors ${gestureState.current.helios.active ? 'text-amber-400' : 'text-white/30'}`}>
                            Right Hand
                        </span>
                        <span className={`text-[8px] font-bold tracking-widest uppercase transition-colors ${gestureState.current.wind.active ? 'text-cyan-300' : 'text-white/30'}`}>
                            Face (Blow)
                        </span>
                    </div>
                </div>
                <div className="w-1/2 h-full flex items-end justify-end p-2">
                    <span className={`text-[8px] font-bold tracking-widest uppercase transition-colors ${gestureState.current.joystick.active ? 'text-cyan-400' : 'text-white/30'}`}>
                        Left Hand
                    </span>
                </div>
            </div>
        )}
      </div>
      
      {/* Instructions */}
      {!error && (
        <div className="mt-2 flex flex-col items-end gap-1.5 opacity-80">
            <div className="flex gap-2">
                <div className="flex items-center gap-1.5 text-amber-400 bg-amber-950/30 px-2 py-1 rounded border border-amber-500/20">
                    <span className="text-xs">☀️</span> <span className="text-[9px] font-bold uppercase">Right Hand</span>
                </div>
                <div className="flex items-center gap-1.5 text-cyan-400 bg-cyan-950/30 px-2 py-1 rounded border border-cyan-500/20">
                    <span className="text-xs">✋</span> <span className="text-[9px] font-bold uppercase">Left Hand</span>
                </div>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-300 bg-emerald-950/30 px-2 py-1 rounded border border-emerald-500/20">
                <span className="text-xs">💨</span> <span className="text-[9px] font-bold uppercase">Blow Air to Boost Wind</span>
            </div>
        </div>
      )}
    </div>
  );
};

// --- Visualization Helpers ---

function drawHudZones(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Joystick Base
    const jcx = CONFIG.JOYSTICK_CENTER.x * w;
    const jY = CONFIG.JOYSTICK_CENTER.y * h;
    
    ctx.beginPath();
    ctx.arc(jcx, jY, w * CONFIG.JOYSTICK_DEADZONE, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(jcx, jY, w * CONFIG.JOYSTICK_RANGE, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.1)';
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawJoystickVisuals(ctx: CanvasRenderingContext2D, w: number, h: number, landmarks: any[], dx: number, dy: number, color: string) {
    const palm = landmarks[9];
    const px = palm.x * w;
    const py = palm.y * h;
    
    const jcx = CONFIG.JOYSTICK_CENTER.x * w;
    const jcy = CONFIG.JOYSTICK_CENTER.y * h;

    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        ctx.beginPath();
        ctx.moveTo(jcx, jcy);
        ctx.lineTo(px, py);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(px, py, 8, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    
    if (window.drawConnectors) {
        window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, { color: color + '44', lineWidth: 1 });
    }
}

function drawHeliosVisuals(ctx: CanvasRenderingContext2D, w: number, h: number, landmarks: any[], strength: number, color: string) {
    const palm = landmarks[9];
    const px = palm.x * w;
    const py = palm.y * h;
    
    // Sun Core
    const baseRadius = 8 + strength * 4;
    
    ctx.beginPath();
    ctx.arc(px, py, baseRadius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // Sun Rays
    const rayCount = 8;
    const rayLen = 15 + strength * 20;
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    
    for(let i=0; i<rayCount; i++) {
        const angle = (Date.now() / 1000) + (i * Math.PI * 2 / rayCount);
        const sx = px + Math.cos(angle) * (baseRadius + 4);
        const sy = py + Math.sin(angle) * (baseRadius + 4);
        const ex = px + Math.cos(angle) * (baseRadius + 4 + rayLen);
        const ey = py + Math.sin(angle) * (baseRadius + 4 + rayLen);
        
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
    }
    
    if (window.drawConnectors) {
        window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, { color: color + '44', lineWidth: 1 });
    }
}

function drawWindVisuals(ctx: CanvasRenderingContext2D, w: number, h: number, landmarks: any[], strength: number, color: string) {
    const lipTop = landmarks[13];
    const lipBot = landmarks[14];
    const mx = (lipTop.x + lipBot.x) / 2 * w;
    const my = (lipTop.y + lipBot.y) / 2 * h;

    // Draw "Wind Tunnel" / Air Stream effect coming from mouth
    const particleCount = 10 + Math.floor(strength * 20); // More particles
    
    ctx.fillStyle = color;
    
    for(let i=0; i<particleCount; i++) {
        const offset = (Date.now() / 100 + i * 0.1) % 1; 
        const spread = (Math.random() - 0.5) * 40;
        
        // Blowing slightly downwards and out
        const px = mx + spread * offset * 2;
        const py = my + offset * 120; 
        const radius = 2 + Math.random() * 5 * offset;
        const alpha = 1.0 - offset;

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, 2 * Math.PI);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Highlight Mouth
    ctx.beginPath();
    ctx.arc(mx, my, 20, 0, 2 * Math.PI);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 + strength * 4;
    ctx.stroke();
    
    // Add text label
    ctx.fillStyle = color;
    ctx.font = '10px monospace';
    ctx.fillText("AIRFLOW", mx + 25, my);
}
