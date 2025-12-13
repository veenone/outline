import env from "@server/env";
import { User, InstallationSettings } from "@server/models";
import { allow } from "./cancan";

/**
 * Check if a user is an instance administrator.
 * Instance admins can configure instance-level settings like SMTP.
 *
 * @param user The user to check.
 * @returns True if the user is an instance admin.
 */
export async function isInstanceAdmin(user: User): Promise<boolean> {
  // Check if user is a team admin first (required)
  if (!user.isAdmin) {
    return false;
  }

  // Check environment variable override
  if (env.INSTANCE_ADMIN_EMAIL && user.email === env.INSTANCE_ADMIN_EMAIL) {
    return true;
  }

  // Check if user is the designated instance admin in settings
  const settings = await InstallationSettings.get();
  if (settings?.instanceAdminEmail && user.email === settings.instanceAdminEmail) {
    return true;
  }

  return false;
}

// Note: InstallationSettings policies use async checks, so they must be
// verified manually in routes using isInstanceAdmin() helper function.
// The allow() function doesn't support async predicates.

allow(User, "read", InstallationSettings, (actor) => actor.isAdmin);

allow(User, "update", InstallationSettings, (actor) => actor.isAdmin);
