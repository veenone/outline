import { Op } from "sequelize";
import { GroupPermission, UserRole } from "@shared/types";
import Logger from "@server/logging/Logger";
import {
  Team,
  User,
  UserAuthentication,
  AuthenticationProvider,
  Group,
  GroupUser,
} from "@server/models";
import { sequelize } from "@server/storage/database";
import { APIContext } from "@server/types";

/**
 * User data from an external identity provider for synchronization.
 */
export interface SyncUser {
  /** External provider user ID (e.g., Keycloak user ID) */
  providerId: string;
  /** User's email address */
  email: string;
  /** User's display name */
  name: string;
  /** User's avatar URL (optional) */
  avatarUrl?: string | null;
}

/**
 * Result of a user synchronization operation.
 */
export interface UserSyncerResult {
  /** Number of new users created */
  created: number;
  /** Number of existing users updated */
  updated: number;
  /** Number of users suspended (removed from provider) */
  suspended: number;
  /** Number of users unchanged */
  unchanged: number;
  /** Number of users reactivated (were suspended, now in provider) */
  reactivated: number;
  /** Number of users added to default group */
  addedToGroup: number;
  /** Any errors encountered during sync */
  errors: string[];
}

interface Props {
  /** The team ID to sync users for */
  teamId: string;
  /** The authentication provider ID */
  authenticationProviderId: string;
  /** List of users from the external provider */
  users: SyncUser[];
  /** Optional: ID of a group to assign newly created users to */
  defaultGroupId?: string | null;
  /** Optional: Name of a group to assign newly created users to (fallback if ID not provided) */
  defaultGroupName?: string;
}

/**
 * Synchronizes users from an external identity provider.
 * - Creates new users that exist in the provider but not in Outline
 * - Suspends users that exist in Outline but not in the provider
 * - Updates existing users if their details have changed
 * - Reactivates suspended users if they reappear in the provider
 *
 * @param ctx - API context with request info
 * @param props - Sync properties
 * @returns Result summary of the sync operation
 */
export default async function userSyncer(
  ctx: APIContext,
  {
    teamId,
    authenticationProviderId,
    users,
    defaultGroupId,
    defaultGroupName,
  }: Props
): Promise<UserSyncerResult> {
  const result: UserSyncerResult = {
    created: 0,
    updated: 0,
    suspended: 0,
    unchanged: 0,
    reactivated: 0,
    addedToGroup: 0,
    errors: [],
  };

  Logger.info("commands", `Starting user sync for team ${teamId}`, {
    teamId,
    authenticationProviderId,
    providerUserCount: users.length,
  });

  // Safety check: Don't suspend all users if provider returns empty list
  if (users.length === 0) {
    Logger.warn("Provider returned empty user list, skipping sync", {
      teamId,
    });
    result.errors.push(
      "Provider returned empty user list - sync aborted to prevent mass suspension"
    );
    return result;
  }

  // Get team with default role setting
  const team = await Team.findByPk(teamId);
  if (!team) {
    result.errors.push(`Team ${teamId} not found`);
    return result;
  }

  // Get authentication provider
  const authProvider = await AuthenticationProvider.findByPk(
    authenticationProviderId
  );
  if (!authProvider) {
    result.errors.push(
      `Authentication provider ${authenticationProviderId} not found`
    );
    return result;
  }

  // Look up default group if specified (by ID first, then by name as fallback)
  let defaultGroup: Group | null = null;
  if (defaultGroupId) {
    defaultGroup = await Group.findOne({
      where: {
        id: defaultGroupId,
        teamId,
      },
    });
    if (!defaultGroup) {
      Logger.warn(
        `Default group with ID "${defaultGroupId}" not found, users will not be auto-assigned`,
        { teamId }
      );
    }
  } else if (defaultGroupName) {
    defaultGroup = await Group.findOne({
      where: {
        teamId,
        name: defaultGroupName,
      },
    });
    if (!defaultGroup) {
      Logger.warn(
        `Default group "${defaultGroupName}" not found, users will not be auto-assigned`,
        { teamId }
      );
    }
  }

  if (defaultGroup) {
    Logger.info(
      "commands",
      `Will assign new users to group "${defaultGroup.name}"`,
      {
        teamId,
        groupId: defaultGroup.id,
      }
    );
  }

  // Build a map of provider users by providerId for quick lookup
  const providerUsersMap = new Map<string, SyncUser>();
  for (const user of users) {
    providerUsersMap.set(user.providerId, user);
  }

  // Also build a map by email for matching users without authentication records
  const providerUsersByEmail = new Map<string, SyncUser>();
  for (const user of users) {
    if (user.email) {
      providerUsersByEmail.set(user.email.toLowerCase(), user);
    }
  }

  // Get all existing UserAuthentication records for this provider
  const existingAuths = await UserAuthentication.findAll({
    where: {
      authenticationProviderId,
    },
    include: [
      {
        model: User,
        as: "user",
        where: { teamId },
        required: true,
      },
    ],
  });

  // Track which provider IDs we've processed
  const processedProviderIds = new Set<string>();

  // Process existing users with authentication records
  for (const auth of existingAuths) {
    const { user } = auth;
    if (!user) {
      continue;
    }

    const providerUser = providerUsersMap.get(auth.providerId);
    processedProviderIds.add(auth.providerId);

    if (providerUser) {
      // User exists in both systems
      try {
        const updated = await updateUserIfNeeded(user, providerUser, result);

        // Reactivate if user was suspended but now exists in provider
        if (user.suspendedAt && !updated) {
          await user.update({ suspendedAt: null, suspendedById: null });
          result.reactivated++;
          Logger.info("commands", `Reactivated user ${user.id}`, {
            email: user.email,
          });
        } else if (user.suspendedAt) {
          // Was updated and reactivated
          await user.update({ suspendedAt: null, suspendedById: null });
          result.reactivated++;
        }
      } catch (err) {
        result.errors.push(
          `Failed to update user ${user.email}: ${err.message}`
        );
        Logger.error("Failed to update user during sync", err, {
          userId: user.id,
        });
      }
    } else {
      // User exists in Outline but not in provider - suspend
      if (!user.suspendedAt) {
        try {
          await user.update({
            suspendedAt: new Date(),
            // Note: suspendedById is null since this is a system action
          });
          result.suspended++;
          Logger.info(
            "commands",
            `Suspended user ${user.id} (not in provider)`,
            {
              email: user.email,
            }
          );
        } catch (err) {
          result.errors.push(
            `Failed to suspend user ${user.email}: ${err.message}`
          );
          Logger.error("Failed to suspend user during sync", err, {
            userId: user.id,
          });
        }
      } else {
        result.unchanged++;
      }
    }
  }

  // Create new users that don't have authentication records
  for (const providerUser of users) {
    if (processedProviderIds.has(providerUser.providerId)) {
      continue; // Already processed
    }

    if (!providerUser.email) {
      result.errors.push(
        `Skipping user ${providerUser.providerId}: no email address`
      );
      continue;
    }

    try {
      // Check if user exists by email (might be an invited user or from another provider)
      const existingUser = await User.findOne({
        where: {
          teamId,
          email: {
            [Op.iLike]: providerUser.email,
          },
        },
      });

      if (existingUser) {
        // User exists by email but doesn't have auth record for this provider
        // Create authentication record and update user details
        await sequelize.transaction(async (transaction) => {
          await UserAuthentication.create(
            {
              providerId: providerUser.providerId,
              authenticationProviderId,
              userId: existingUser.id,
              scopes: [],
            },
            { transaction }
          );

          const updated = await updateUserIfNeeded(
            existingUser,
            providerUser,
            result,
            transaction
          );

          // Reactivate if suspended
          if (existingUser.suspendedAt) {
            await existingUser.update(
              { suspendedAt: null, suspendedById: null },
              { transaction }
            );
            result.reactivated++;
          } else if (!updated) {
            result.unchanged++;
          }
        });

        Logger.info(
          "commands",
          `Linked existing user ${existingUser.id} to provider`,
          {
            email: existingUser.email,
            providerId: providerUser.providerId,
          }
        );
      } else {
        // Create new user with authentication record
        await sequelize.transaction(async (transaction) => {
          const user = await User.create(
            {
              name: providerUser.name,
              email: providerUser.email,
              role: team.defaultUserRole ?? UserRole.Member,
              teamId,
              avatarUrl: providerUser.avatarUrl || null,
              // User hasn't logged in yet
              lastActiveAt: null,
            },
            { transaction }
          );

          // Create authentication record
          await UserAuthentication.create(
            {
              providerId: providerUser.providerId,
              authenticationProviderId,
              userId: user.id,
              scopes: [],
            },
            { transaction }
          );

          result.created++;
          Logger.info("commands", `Created new user ${user.id}`, {
            email: user.email,
            providerId: providerUser.providerId,
          });

          // Add user to default group if configured
          if (defaultGroup) {
            await GroupUser.create(
              {
                userId: user.id,
                groupId: defaultGroup.id,
                permission: GroupPermission.Member,
                // No createdById since this is a system action
              },
              { transaction }
            );
            result.addedToGroup++;
            Logger.info(
              "commands",
              `Added user ${user.id} to group ${defaultGroup.name}`,
              {
                email: user.email,
                groupId: defaultGroup.id,
              }
            );
          }
        });
      }
    } catch (err) {
      result.errors.push(
        `Failed to create user ${providerUser.email}: ${err.message}`
      );
      Logger.error("Failed to create user during sync", err, {
        email: providerUser.email,
        providerId: providerUser.providerId,
      });
    }
  }

  Logger.info("commands", `User sync completed for team ${teamId}`, {
    ...result,
    errorCount: result.errors.length,
  });

  return result;
}

/**
 * Updates a user's details if they have changed.
 *
 * @param user - The existing user
 * @param providerUser - The provider user data
 * @param result - The result object to update
 * @param transaction - Optional transaction
 * @returns true if user was updated
 */
async function updateUserIfNeeded(
  user: User,
  providerUser: SyncUser,
  result: UserSyncerResult,
  transaction?: ReturnType<typeof sequelize.transaction> extends Promise<
    infer T
  >
    ? T
    : never
): Promise<boolean> {
  const updates: Partial<User> = {};

  // Check if name changed
  if (providerUser.name && user.name !== providerUser.name) {
    updates.name = providerUser.name;
  }

  // Check if email changed (case-insensitive comparison)
  if (
    providerUser.email &&
    user.email?.toLowerCase() !== providerUser.email.toLowerCase()
  ) {
    updates.email = providerUser.email;
  }

  // Check if avatar changed (only if provider has one and user hasn't set their own)
  if (providerUser.avatarUrl && user.avatarUrl !== providerUser.avatarUrl) {
    // Only update avatar if it looks like it's from the same provider
    // (avoid overwriting user-uploaded avatars)
    if (!user.avatarUrl || user.avatarUrl.includes("keycloak")) {
      updates.avatarUrl = providerUser.avatarUrl;
    }
  }

  if (Object.keys(updates).length > 0) {
    await user.update(updates, { transaction });
    result.updated++;
    Logger.debug("commands", `Updated user ${user.id}`, { updates });
    return true;
  }

  result.unchanged++;
  return false;
}
