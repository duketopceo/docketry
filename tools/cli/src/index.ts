#!/usr/bin/env node
import { program } from "commander";

program
  .name("dok")
  .description("docketry CLI — work the board from a shell")
  .version("0.0.0");

program
  .command("ready")
  .description("list unblocked issues ordered by priority")
  .option("--format <format>", "output format", "table")
  .action(() => {
    console.error("dok ready: API not yet available (see issue #4)");
    process.exitCode = 1;
  });

program.parse();
