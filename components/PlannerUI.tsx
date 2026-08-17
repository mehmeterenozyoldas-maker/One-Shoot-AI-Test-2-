/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState } from 'react';
import { EditorTool, SimulationMetrics } from '../types';
import { fetchStockholmWeather } from '../services/weatherService';

interface PlannerUIProps {
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  metrics: SimulationMetrics;
  envSettings: { windSpeed: number; sunPos: number; cloudCover: number };
  onEnvChange: (key: 'windSpeed' | 'sunPos' | 'cloudCover', val: number) => void;
}

export const PlannerUI = ({ activeTool, onToolChange, metrics, envSettings, onEnvChange }: PlannerUIProps) => {
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [activeTab, setActiveTab] = useState<'BUILD' | 'ENV' | 'DATA'>('BUILD');
  
  const handleSyncData = async () => {
      setIsLoadingData(true);
      const data = await fetchStockholmWeather();
      if (data) {
          onEnvChange('windSpeed', Math.min(1, data.windSpeed / 25));
          onEnvChange('cloudCover', data.cloudCover / 100);
      }
      setIsLoadingData(false);
  };

  const formatNumber = (num: number) => num.toLocaleString(undefined, { maximumFractionDigits: 1 });

  const ToolButton = ({ id, label, icon, colorClass }: { id: EditorTool, label: string, icon: React.ReactNode, colorClass: string }) => (
    <button
        onClick={() => onToolChange(id)}
        className={`group relative flex flex-col items-center justify-center p-3 rounded-xl border transition-all duration-200 ${
            activeTool === id 
            ? `${colorClass} bg-opacity-10 border-opacity-50 ring-1 ring-inset ring-white/10` 
            : 'bg-slate-800/40 border-slate-700/50 text-slate-500 hover:bg-slate-700/50 hover:text-slate-200'
        }`}
    >
        <div className={`mb-2 transition-transform group-hover:scale-110 ${activeTool === id ? 'text-current' : ''}`}>
            {icon}
        </div>
        <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
        {activeTool === id && (
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${colorClass.replace('text-', 'bg-')}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${colorClass.replace('text-', 'bg-')}`}></span>
            </span>
        )}
    </button>
  );

  return (
    <div className="absolute inset-0 z-40 pointer-events-none flex flex-col justify-between p-6 overflow-hidden">
        
        {/* Top Bar: System Status */}
        <div className="flex justify-between items-start pointer-events-auto">
            <div className="glass-panel px-6 py-4 rounded-2xl flex flex-col gap-1 min-w-[240px]">
                 <div className="flex items-center gap-2 mb-2">
                     <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                     <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest">System Online</span>
                 </div>
                 <h1 className="text-xl font-medium tracking-tight text-white">Muni-Grid <span className="font-light opacity-50">2030</span></h1>
                 <p className="text-xs text-slate-400">Stockholm District 4 • Simulation Mode</p>
            </div>

            {/* Metrics HUD */}
            <div className="flex gap-3">
                <div className="glass-panel p-4 rounded-2xl flex flex-col items-end min-w-[140px]">
                    <span className="text-[9px] text-slate-400 uppercase tracking-widest font-bold mb-1">Grid Balance</span>
                    <div className={`text-2xl font-mono font-bold ${metrics.netStatus === 'SURPLUS' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {metrics.netStatus === 'SURPLUS' ? '+' : ''}{(metrics.totalPower - metrics.consumption).toFixed(1)} <span className="text-xs text-slate-500 font-sans">MW</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1 mt-2 rounded-full overflow-hidden">
                        <div 
                           className={`h-full transition-all duration-700 ${metrics.netStatus === 'SURPLUS' ? 'bg-emerald-500' : 'bg-rose-500'}`}
                           style={{ width: `${Math.min(100, (metrics.totalPower / metrics.consumption) * 50)}%` }}
                        ></div>
                    </div>
                </div>
                <div className="glass-panel p-4 rounded-2xl flex flex-col items-end min-w-[120px]">
                    <span className="text-[9px] text-slate-400 uppercase tracking-widest font-bold mb-1">Population</span>
                    <div className="text-xl font-mono font-medium text-white">
                        {formatNumber(metrics.population)}
                    </div>
                </div>
                 <div className="glass-panel p-4 rounded-2xl flex flex-col items-end min-w-[120px]">
                    <span className="text-[9px] text-slate-400 uppercase tracking-widest font-bold mb-1">Budget</span>
                    <div className="text-xl font-mono font-medium text-white">
                        <span className="text-slate-500 mr-1">$</span>{formatNumber(metrics.cost)}<span className="text-sm text-slate-500">M</span>
                    </div>
                </div>
            </div>
        </div>

        {/* Right Floating Dock: Main Controls */}
        <div className="absolute right-6 top-1/2 -translate-y-1/2 glass-panel rounded-2xl w-72 flex flex-col pointer-events-auto max-h-[80vh] overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-white/5 p-1 bg-slate-900/50">
                {(['BUILD', 'ENV', 'DATA'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${
                            activeTab === tab ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
                        }`}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            <div className="p-4 overflow-y-auto custom-scrollbar flex-1">
                
                {activeTab === 'BUILD' && (
                    <div className="space-y-6">
                        <div>
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Selection</h3>
                                <div className="flex gap-1">
                                    <button onClick={() => onToolChange('SELECT')} className={`p-1.5 rounded ${activeTool==='SELECT'?'bg-indigo-500/20 text-indigo-400':'text-slate-500 hover:text-slate-300'}`}>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777" /></svg>
                                    </button>
                                    <button onClick={() => onToolChange('REMOVE')} className={`p-1.5 rounded ${activeTool==='REMOVE'?'bg-rose-500/20 text-rose-400':'text-slate-500 hover:text-slate-300'}`}>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Energy Assets</h3>
                            <div className="grid grid-cols-2 gap-2">
                                <ToolButton 
                                    id="ADD_TURBINE" label="Turbine" 
                                    colorClass="text-cyan-400 border-cyan-500"
                                    icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>} 
                                />
                                <ToolButton 
                                    id="ADD_SOLAR" label="Solar Array" 
                                    colorClass="text-amber-400 border-amber-500"
                                    icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>} 
                                />
                            </div>
                        </div>

                        <div>
                             <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Urban Zoning</h3>
                             <div className="grid grid-cols-2 gap-2">
                                <ToolButton 
                                    id="ADD_RESIDENTIAL" label="Residential" colorClass="text-indigo-400 border-indigo-500"
                                    icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>}
                                />
                                <ToolButton 
                                    id="ADD_COMMERCIAL" label="Commercial" colorClass="text-blue-400 border-blue-500"
                                    icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5" /></svg>}
                                />
                                <ToolButton 
                                    id="ADD_PARK" label="Park" colorClass="text-emerald-400 border-emerald-500"
                                    icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>}
                                />
                                <ToolButton 
                                    id="ADD_ROAD" label="Infrastructure" colorClass="text-slate-400 border-slate-500"
                                    icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0121 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>}
                                />
                             </div>
                        </div>

                        <div>
                            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Terraforming</h3>
                            <div className="grid grid-cols-2 gap-2">
                                <ToolButton 
                                    id="ADD_FOREST" label="Reforest" colorClass="text-lime-400 border-lime-500"
                                    icon={<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M5 19h14a1 1 0 00.866-1.5l-7-12.124a1 1 0 00-1.732 0l-7 12.124A1 1 0 005 19z" /></svg>}
                                />
                                <ToolButton 
                                    id="ADD_MOUNTAIN" label="Geo-Form" colorClass="text-stone-400 border-stone-500"
                                    icon={<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M13.73 3.51L6.78 15.54A3 3 0 009.33 20h11.34a3 3 0 002.55-4.46L16.27 3.51a3 3 0 00-2.54-1.51H16.27a3 3 0 00-2.54 1.51z M5 20l4-8 4 8H5z" /></svg>}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'ENV' && (
                    <div className="space-y-6 pt-2">
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                                </span>
                                <span className="text-[10px] font-bold uppercase text-blue-300">Satellite Uplink</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-mono text-slate-300">STOCKHOLM_ESA_SAT_2</span>
                                <button 
                                    onClick={handleSyncData}
                                    disabled={isLoadingData}
                                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold uppercase rounded transition-colors flex items-center gap-2"
                                >
                                    {isLoadingData ? 'Syncing...' : 'Sync Live Data'}
                                    <svg className={`w-3 h-3 ${isLoadingData ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                </button>
                            </div>
                        </div>

                        <div>
                             <div className="flex justify-between items-end mb-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Wind Velocity</span>
                                <span className="font-mono text-cyan-400 text-xs">{Math.round(envSettings.windSpeed * 100)} km/h</span>
                             </div>
                             <input 
                                type="range" min="0" max="1" step="0.01"
                                value={envSettings.windSpeed}
                                onChange={(e) => onEnvChange('windSpeed', parseFloat(e.target.value))}
                                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                             />
                        </div>

                        <div>
                             <div className="flex justify-between items-end mb-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Solar Angle / Time</span>
                                <span className="font-mono text-amber-400 text-xs">
                                    {envSettings.sunPos >= 0.98 ? 'Night (00:00)' : `${Math.floor(envSettings.sunPos * 12 + 6)}:${Math.floor(((envSettings.sunPos * 12 + 6) % 1) * 60).toString().padStart(2, '0')}`}
                                </span>
                             </div>
                             <input 
                                type="range" min="0" max="1" step="0.01"
                                value={envSettings.sunPos}
                                onChange={(e) => onEnvChange('sunPos', parseFloat(e.target.value))}
                                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                             />
                             <div className="grid grid-cols-4 gap-1 mt-2">
                                {[
                                    { label: 'Dawn', val: 0.05 },
                                    { label: 'Noon', val: 0.5 },
                                    { label: 'Dusk', val: 0.92 },
                                    { label: 'Night', val: 1.0 }
                                ].map((preset) => (
                                    <button
                                        key={preset.label}
                                        onClick={() => onEnvChange('sunPos', preset.val)}
                                        className={`px-1.5 py-1 text-[9px] font-bold rounded transition-colors ${
                                            Math.abs(envSettings.sunPos - preset.val) < 0.08
                                                ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                                        }`}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                             </div>
                        </div>

                        <div>
                             <div className="flex justify-between items-end mb-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Cloud Density</span>
                                <span className="font-mono text-slate-300 text-xs">{Math.round(envSettings.cloudCover * 100)}%</span>
                             </div>
                             <input 
                                type="range" min="0" max="1" step="0.01"
                                value={envSettings.cloudCover}
                                onChange={(e) => onEnvChange('cloudCover', parseFloat(e.target.value))}
                                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-400"
                             />
                        </div>
                    </div>
                )}
                
                {activeTab === 'DATA' && (
                    <div className="space-y-4 pt-2">
                        <div className="bg-slate-800/50 p-3 rounded border border-slate-700">
                            <span className="text-[9px] text-slate-500 uppercase font-bold block mb-2">Efficiency Rating</span>
                            <div className="flex items-end gap-2">
                                <span className="text-3xl font-mono text-white font-light">{metrics.efficiencyScore}</span>
                                <span className="text-xs text-slate-400 mb-1">/ 100</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                             <div className="flex justify-between text-xs border-b border-white/5 pb-1">
                                 <span className="text-slate-400">Total Generation</span>
                                 <span className="font-mono text-emerald-400">{formatNumber(metrics.totalPower)} MW</span>
                             </div>
                             <div className="flex justify-between text-xs border-b border-white/5 pb-1">
                                 <span className="text-slate-400">Wind Contribution</span>
                                 <span className="font-mono text-cyan-400">{formatNumber(metrics.windOutput)} MW</span>
                             </div>
                             <div className="flex justify-between text-xs border-b border-white/5 pb-1">
                                 <span className="text-slate-400">Solar Contribution</span>
                                 <span className="font-mono text-amber-400">{formatNumber(metrics.solarOutput)} MW</span>
                             </div>
                             <div className="flex justify-between text-xs border-b border-white/5 pb-1">
                                 <span className="text-slate-400">City Consumption</span>
                                 <span className="font-mono text-rose-400">{formatNumber(metrics.consumption)} MW</span>
                             </div>
                        </div>
                    </div>
                )}
            </div>
            
            {/* Footer of panel */}
            <div className="p-3 bg-slate-900/80 border-t border-white/5 text-[9px] text-slate-600 text-center font-mono">
                ENGINEERING V.2030.4.1
            </div>
        </div>

        {/* Bottom Status Bar */}
        <div className="pointer-events-auto flex items-center justify-between glass-panel px-4 py-2 rounded-xl text-xs text-slate-400">
            <div className="flex gap-4">
                <span className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full"></span>
                    LAT: 59.3293° N
                </span>
                <span className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full"></span>
                    LON: 18.0686° E
                </span>
            </div>
            <div className="font-mono">
                SIMULATION TIME: {(envSettings.sunPos * 24).toFixed(2)}00
            </div>
        </div>
    </div>
  );
};