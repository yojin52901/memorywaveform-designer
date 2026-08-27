export const SCHEMA_VERSION = '1.0';

export const TIMELINE_START_ID = 'tm_start';
export const TIMELINE_END_ID = 'tm_end';

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
