
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { AppMode, BuildingDef, BuildingType } from './types';

// Installation Settings
export const SCENE_SIZE = 400;
export const TURBINE_COUNT = 8;
export const SOLAR_COUNT = 12;

// Simulation Config (Computational Design)
export const SIM_CONFIG = {
  BASE_WIND_OUTPUT: 2.5, // MW per turbine
  BASE_SOLAR_OUTPUT: 0.8, // MW per panel
  COST_TURBINE: 1.2, // $M
  COST_SOLAR: 0.4, // $M
  CITY_DEMAND_BASE: 20, // Base MW required
  WIND_HEIGHT_BONUS: 0.05, // Power bonus per unit of height
};

// Palette - Solarpunk Aesthetic
export const COLORS = {
  background: '#f0fdf4', // Light mint
  fog: '#f0fdf4',
  
  // Terrain
  grassBase: '#15803d', // green-700
  grassPeak: '#86efac', // green-300
  
  // Elements
  city: '#ffffff',
  cityEmissive: '#e0f2fe', // sky-100
  
  // Energy
  wind: '#06b6d4', // cyan-500
  windGlow: '#67e8f9', // cyan-300
  solar: '#f59e0b', // amber-500
  solarGlow: '#fcd34d', // amber-300
  
  // Flow
  flowBase: '#ffffff',
  
  // UI
  uiBg: 'rgba(15, 23, 42, 0.9)',
  uiBorder: 'rgba(255, 255, 255, 0.1)',
};

// Building Definitions
export const BUILDINGS: Record<string, BuildingDef> = {
  [BuildingType.None]: { type: BuildingType.None, cost: 0, popGen: 0, incomeGen: 0, powerConsume: 0, label: 'Empty' },
  [BuildingType.Residential]: { type: BuildingType.Residential, cost: 100, popGen: 50, incomeGen: 5, powerConsume: 2.5, label: 'Housing' },
  [BuildingType.Commercial]: { type: BuildingType.Commercial, cost: 300, popGen: 10, incomeGen: 50, powerConsume: 8.0, label: 'Office Tower' },
  [BuildingType.Industrial]: { type: BuildingType.Industrial, cost: 500, popGen: 0, incomeGen: 100, powerConsume: 15.0, label: 'Factory' },
  [BuildingType.Park]: { type: BuildingType.Park, cost: 50, popGen: 5, incomeGen: 0, powerConsume: 0.1, label: 'Green Park' },
  [BuildingType.Road]: { type: BuildingType.Road, cost: 20, popGen: 0, incomeGen: 0, powerConsume: 0.05, label: 'Road' },
  [BuildingType.Forest]: { type: BuildingType.Forest, cost: 80, popGen: 0, incomeGen: 2, powerConsume: 0, label: 'Forest' },
  [BuildingType.Mountain]: { type: BuildingType.Mountain, cost: 500, popGen: 0, incomeGen: 10, powerConsume: 0, label: 'Mountain' },
};
