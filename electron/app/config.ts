import os from "os";
import path from "path";

export function getStableConfigPath(
  homeDirectory = os.homedir(),
  configDirectory = process.env.XDG_CONFIG_HOME,
) {
  const baseDirectory = configDirectory?.trim() || path.join(homeDirectory, ".config");
  return path.join(baseDirectory, "poe-dash", "config.json");
}
