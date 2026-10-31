import { defineConfig } from 'vitest/config';

// The desktop verification host reports more logical CPUs than its available
// memory/CPU budget. Limit workers without relaxing any test or hook timeout.
export default defineConfig({ test: { maxWorkers: 2 } });
