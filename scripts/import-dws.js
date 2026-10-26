import { importLatestDwsDamLevel } from '../server/dws-importer.js';

try {
  const result = await importLatestDwsDamLevel();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`DWS import failed: ${error.message}`);
  process.exitCode = 1;
}
