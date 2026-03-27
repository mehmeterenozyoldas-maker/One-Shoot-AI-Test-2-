
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState } from 'react';
import IsoMap from './components/IsoMap';
import UIOverlay from './components/UIOverlay';
import StartScreen from './components/StartScreen';
import { AppMode } from './types';

function App() {
  const [started, setStarted] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>('EXPERIENCE');

  const handleStart = () => {
    setStarted(true);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-emerald-50">
      {/* The 3D Installation */}
      <IsoMap appMode={appMode} />
      
      {/* Experience Overlay (Only in Experience Mode) */}
      {started && appMode === 'EXPERIENCE' && <UIOverlay />}

      {/* Mode Switcher (Always visible when started) */}
      {started && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 backdrop-blur rounded-full p-1 border border-slate-700 shadow-xl flex gap-1">
             <button 
                onClick={() => setAppMode('EXPERIENCE')}
                className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${appMode === 'EXPERIENCE' ? 'bg-emerald-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
             >
                Live View
             </button>
             <button 
                onClick={() => setAppMode('PLANNER')}
                className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${appMode === 'PLANNER' ? 'bg-cyan-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
             >
                Planner
             </button>
        </div>
      )}

      {/* Intro */}
      {!started && <StartScreen onStart={handleStart} />}
    </div>
  );
}

export default App;
