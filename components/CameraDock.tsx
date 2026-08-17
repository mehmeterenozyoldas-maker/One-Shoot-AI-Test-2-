/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';

export type CameraPreset = 'OVERVIEW' | 'SPIRE' | 'WIND_RIDGE' | 'SKYLINE' | 'ECO_LAKE';

interface CameraDockProps {
  currentPreset: CameraPreset;
  onSelectPreset: (preset: CameraPreset) => void;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
}

export const CameraDock: React.FC<CameraDockProps> = ({
  currentPreset,
  onSelectPreset,
  autoRotate,
  onToggleAutoRotate,
}) => {
  const presets: { id: CameraPreset; label: string; icon: string; desc: string }[] = [
    { id: 'OVERVIEW', label: 'Diorama', icon: '🌐', desc: 'Full isometric vantage' },
    { id: 'SPIRE', label: 'Energy Core', icon: '⚡', desc: 'Solarpunk kinetic spire' },
    { id: 'WIND_RIDGE', label: 'Wind Ridge', icon: '💨', desc: 'High-altitude turbines' },
    { id: 'SKYLINE', label: 'Skyline', icon: '🏙️', desc: 'Street-level boulevard' },
    { id: 'ECO_LAKE', label: 'Eco Lake', icon: '💧', desc: 'Wetland & bio-filters' },
  ];

  return (
    <div className="flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md p-1.5 rounded-2xl border border-slate-700/80 shadow-2xl pointer-events-auto">
      {/* Auto Orbit Toggle */}
      <button
        onClick={onToggleAutoRotate}
        title={autoRotate ? 'Pause Orbit' : 'Resume Orbit'}
        className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
          autoRotate
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
            : 'text-slate-400 hover:text-white hover:bg-slate-800'
        }`}
      >
        <span className={autoRotate ? 'animate-spin' : ''}>🔄</span>
        <span className="hidden sm:inline text-[11px] uppercase tracking-wider font-mono">Orbit</span>
      </button>

      <div className="w-px h-5 bg-slate-700 mx-0.5" />

      {/* Preset View Buttons */}
      <div className="flex items-center gap-1">
        {presets.map((p) => {
          const isActive = currentPreset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onSelectPreset(p.id)}
              title={p.desc}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all ${
                isActive
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
              }`}
            >
              <span>{p.icon}</span>
              <span className="text-[11px] whitespace-nowrap">{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
