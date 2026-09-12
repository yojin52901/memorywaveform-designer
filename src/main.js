import { createEditor } from './ui/controller.js';
import { initializeAccountActions } from './ui/account.js';

if (await initializeAccountActions(document)) {
  createEditor(document);
}
