import env from "@server/env";
import InstallationSettings from "@server/models/InstallationSettings";

/**
 * Present SMTP configuration settings for API response.
 * Passwords are masked for security.
 *
 * @param settings The InstallationSettings model instance.
 * @returns Formatted SMTP settings object.
 */
export default function presentInstallationSettings(
  settings: InstallationSettings | null
) {
  const hasDbConfig = settings?.isSmtpConfigured ?? false;
  const hasEnvConfig = !!(env.SMTP_HOST || env.SMTP_SERVICE);

  return {
    // Database configuration (active if set)
    smtpHost: settings?.smtpHost ?? null,
    smtpService: settings?.smtpService ?? null,
    smtpPort: settings?.smtpPort ?? null,
    smtpUsername: settings?.smtpUsername ?? null,
    smtpPassword: settings?.smtpPassword ? "••••••••" : null,
    smtpFromEmail: settings?.smtpFromEmail ?? null,
    smtpReplyEmail: settings?.smtpReplyEmail ?? null,
    smtpName: settings?.smtpName ?? null,
    smtpSecure: settings?.smtpSecure ?? null,
    smtpDisableStarttls: settings?.smtpDisableStarttls ?? null,
    smtpTlsCiphers: settings?.smtpTlsCiphers ?? null,

    // Status flags
    isConfigured: hasDbConfig || hasEnvConfig,
    isUsingDatabaseConfig: hasDbConfig,
    isUsingEnvConfig: !hasDbConfig && hasEnvConfig,

    // Instance admin email
    instanceAdminEmail: settings?.instanceAdminEmail ?? null,
  };
}
