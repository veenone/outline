import Logger from "@server/logging/Logger";
import { PluginManager, Hook } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./auth/oidc";
import env from "./env";
import SyncOIDCUsersTask from "./tasks/SyncOIDCUsersTask";

// Check if OIDC is enabled with either manual configuration or issuer URL
const hasManualConfig = !!(
  env.OIDC_CLIENT_ID &&
  env.OIDC_CLIENT_SECRET &&
  env.OIDC_AUTH_URI &&
  env.OIDC_TOKEN_URI &&
  env.OIDC_USERINFO_URI
);

const hasIssuerConfig = !!(
  env.OIDC_CLIENT_ID &&
  env.OIDC_CLIENT_SECRET &&
  env.OIDC_ISSUER_URL
);

const enabled = hasManualConfig || hasIssuerConfig;

if (enabled) {
  // Register plugin with the router (which handles both manual and discovery config)
  PluginManager.add({
    ...config,
    type: Hook.AuthProvider,
    value: { router, id: config.id },
    name: env.OIDC_DISPLAY_NAME || config.name,
  });
  Logger.info("plugins", "OIDC plugin registered");

  // Register user sync task if sync is enabled
  if (env.OIDC_SYNC_ENABLED) {
    PluginManager.add({
      type: Hook.Task,
      value: SyncOIDCUsersTask,
    });
    Logger.info("plugins", "OIDC user sync task registered");
  }
}
