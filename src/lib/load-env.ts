/**
 * Must run before config reads process.env.
 * Imports are hoisted, so bot entrypoints cannot call dotenv before importing config.
 */
import { config as loadEnv } from "dotenv";
import path from "path";
import { installDnsFallback } from "./dns-fallback";

installDnsFallback();

const cwd = process.cwd();
loadEnv({ path: path.join(cwd, "..", ".env"), quiet: true });
loadEnv({ path: path.join(cwd, ".env"), override: true, quiet: true });
