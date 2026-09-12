import * as auth from './auth.js';
import { createWorker } from './worker.js';

export function createProductionWorker(assets) {
  return createWorker({ assets, auth });
}
