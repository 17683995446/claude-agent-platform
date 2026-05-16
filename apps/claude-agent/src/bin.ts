#!/usr/bin/env bun
// Claude Agent Platform - CLI Entry Point

import ClaudeAgentApp from './index.js';

const app = new ClaudeAgentApp();
const exitCode = await app.runCLI(process.argv);
process.exit(exitCode);
