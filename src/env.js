// Loads .env before anything reads process.env. Imported first in index.js, because ES modules
// evaluate their imports before the importing file's own code runs.
try {
  process.loadEnvFile();
} catch {
  // no .env file; rely on the real environment
}
