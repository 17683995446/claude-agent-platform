#!/usr/bin/env bun
// Claude Agent CLI Entry Point

import { main } from './index.js';

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
