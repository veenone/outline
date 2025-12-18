import Logger from "@server/logging/Logger";
import { AuthenticationProvider } from "@server/models";
import { TaskPriority } from "@server/queues/tasks/base/BaseTask";
import {
  CronTask,
  TaskInterval,
  Props,
} from "@server/queues/tasks/base/CronTask";
import { createContext } from "@server/context";
import userSyncer, { SyncUser } from "@server/commands/userSyncer";
import { Hour } from "@shared/utils/time";
import KeycloakAdminClient, { KeycloakUser } from "../keycloakAdmin";
import env from "../env";

/**
 * Periodically synchronizes users from Keycloak OIDC provider.
 * Creates new users, updates existing users, and suspends users
 * that have been removed from Keycloak.
 */
export default class SyncOIDCUsersTask extends CronTask {
  public async perform({ partition }: Props) {
    // Check if sync is enabled
    if (!env.OIDC_SYNC_ENABLED) {
      Logger.debug("task", "OIDC user sync is disabled");
      return;
    }

    // Check if required config is present
    if (!env.OIDC_SYNC_ADMIN_URL || !env.OIDC_SYNC_REALM) {
      Logger.warn(
        "task",
        "OIDC sync enabled but OIDC_SYNC_ADMIN_URL or OIDC_SYNC_REALM not configured"
      );
      return;
    }

    Logger.info("task", "Starting OIDC user sync task");

    // Find all teams with OIDC authentication provider
    const authProviders = await AuthenticationProvider.findAll({
      where: {
        name: "oidc",
        enabled: true,
        ...this.getPartitionWhereClause("id", partition),
      },
    });

    if (authProviders.length === 0) {
      Logger.debug("task", "No OIDC authentication providers found");
      return;
    }

    Logger.info(
      "task",
      `Found ${authProviders.length} OIDC authentication providers to sync`
    );

    // Create Keycloak admin client
    let keycloakClient: KeycloakAdminClient;
    try {
      keycloakClient = new KeycloakAdminClient();
    } catch (err) {
      Logger.error("Failed to create Keycloak admin client", err);
      return;
    }

    // Test connection before proceeding
    const connected = await keycloakClient.testConnection();
    if (!connected) {
      Logger.error(
        "task",
        "Failed to connect to Keycloak Admin API, skipping sync"
      );
      return;
    }

    // Fetch all users from Keycloak (enabled users only)
    let keycloakUsers: KeycloakUser[];
    try {
      keycloakUsers = await keycloakClient.getAllUsers(100, true);
    } catch (err) {
      Logger.error("Failed to fetch users from Keycloak", err);
      return;
    }

    if (keycloakUsers.length === 0) {
      Logger.warn(
        "task",
        "Keycloak returned no users, skipping sync to prevent mass suspension"
      );
      return;
    }

    // Convert Keycloak users to sync format
    const syncUsers: SyncUser[] = keycloakUsers
      .filter((u) => u.email) // Must have email
      .map((u) => ({
        providerId: u.id,
        email: u.email!,
        name: buildUserName(u),
        avatarUrl: null, // Keycloak doesn't provide avatar URLs in admin API
      }));

    Logger.info("task", `Prepared ${syncUsers.length} users for sync`);

    // Create a system context for the sync operation
    const ctx = createContext({ ip: "system" });

    // Sync users for each team with OIDC provider
    for (const authProvider of authProviders) {
      try {
        Logger.info("task", `Syncing users for team ${authProvider.teamId}`);

        const result = await userSyncer(ctx, {
          teamId: authProvider.teamId,
          authenticationProviderId: authProvider.id,
          users: syncUsers,
        });

        Logger.info("task", `Sync completed for team ${authProvider.teamId}`, {
          created: result.created,
          updated: result.updated,
          suspended: result.suspended,
          reactivated: result.reactivated,
          unchanged: result.unchanged,
          errors: result.errors.length,
        });

        if (result.errors.length > 0) {
          Logger.warn(
            "task",
            `Sync errors for team ${authProvider.teamId}`,
            { errors: result.errors.slice(0, 10) } // Log first 10 errors
          );
        }
      } catch (err) {
        Logger.error(
          `Failed to sync users for team ${authProvider.teamId}`,
          err
        );
      }
    }

    Logger.info("task", "OIDC user sync task completed");
  }

  public get cron() {
    return {
      interval: TaskInterval.Hour,
      partitionWindow: (10 * Hour.ms) / 60, // 10 minutes
    };
  }

  public get options() {
    return {
      attempts: 2,
      priority: TaskPriority.Background,
    };
  }
}

/**
 * Builds a display name from Keycloak user data.
 *
 * @param user - Keycloak user
 * @returns Display name
 */
function buildUserName(user: KeycloakUser): string {
  if (user.firstName && user.lastName) {
    return `${user.firstName} ${user.lastName}`.trim();
  }
  if (user.firstName) {
    return user.firstName;
  }
  if (user.lastName) {
    return user.lastName;
  }
  return user.username || user.email || "Unknown User";
}
