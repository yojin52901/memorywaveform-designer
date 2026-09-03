export const SCHEMA_VERSION = '1.1';

export const TIMELINE_START_ID = 'tm_start';
export const TIMELINE_END_ID = 'tm_end';
export const BASE_SLOT_WIDTH = 150;
export const SLOT_WIDTH_UNIT_MIN = 0.4;
export const SLOT_WIDTH_UNIT_MAX = 4;

export const SIGNAL_TYPES = Object.freeze([
  'control',
  'power',
  'data',
  'clock',
  'custom'
]);

export const STATES = Object.freeze([
  'HIGH',
  'LOW',
  'UNKNOWN',
  'UNSPECIFIED'
]);

export const ANNOTATION_ANCHOR_TYPES = Object.freeze([
  'document',
  'signal',
  'transition',
  'timingParameter',
  'phase'
]);
