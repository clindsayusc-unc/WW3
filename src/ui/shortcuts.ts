/** Every keyboard shortcut, in one place: the `?` overlay lists exactly these (D-080). */
export interface Shortcut {
  readonly keys: readonly string[];
  readonly action: string;
  readonly group: 'Turn' | 'Screens' | 'Map' | 'Orders' | 'Help';
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['Enter'], action: 'End the turn', group: 'Turn' },
  { keys: ['Ctrl', 'Z'], action: 'Undo the last order this turn', group: 'Turn' },
  { keys: ['S'], action: 'Intelligence briefing (last month)', group: 'Turn' },
  { keys: ['A'], action: 'Show or hide the advisor', group: 'Turn' },
  { keys: ['B'], action: 'Budget', group: 'Screens' },
  { keys: ['E'], action: 'Economy', group: 'Screens' },
  { keys: ['P'], action: 'Production', group: 'Screens' },
  { keys: ['R'], action: 'Research', group: 'Screens' },
  { keys: ['D'], action: 'Diplomacy', group: 'Screens' },
  { keys: ['M'], action: 'Military', group: 'Screens' },
  { keys: ['N'], action: 'The WW3 Wire (news)', group: 'Screens' },
  { keys: ['X'], action: 'Escalation ladder', group: 'Screens' },
  { keys: ['Esc'], action: 'Close the screen, or clear the selection', group: 'Screens' },
  { keys: ['1'], action: 'Political map', group: 'Map' },
  { keys: ['2'], action: 'Blocs map', group: 'Map' },
  { keys: ['3'], action: 'Relations map', group: 'Map' },
  { keys: ['4'], action: 'Economy map and trade routes', group: 'Map' },
  { keys: ['5'], action: 'Military map', group: 'Map' },
  { keys: ['6'], action: 'Tension map', group: 'Map' },
  { keys: ['7'], action: 'Terrain map', group: 'Map' },
  { keys: ['8'], action: 'Supply map', group: 'Map' },
  { keys: ['9'], action: 'Resources map', group: 'Map' },
  { keys: ['L'], action: 'Labels on or off', group: 'Map' },
  { keys: ['C'], action: 'Chokepoint overlay on or off', group: 'Map' },
  { keys: ['Left click'], action: 'Select a region or a unit stack', group: 'Orders' },
  { keys: ['Right click'], action: 'Order the selected units to move or attack', group: 'Orders' },
  { keys: ['Drag'], action: 'Rotate the globe; scroll to zoom', group: 'Orders' },
  { keys: ['?'], action: 'This list', group: 'Help' },
  { keys: ['H'], action: 'Restart the tutorial', group: 'Help' },
];
