import Router from "koa-router";
import { UserRole } from "@shared/types";
import { AuthorizationError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { InstallationSettings } from "@server/models";
import { isInstanceAdmin } from "@server/policies/installationSettings";
import { presentInstallationSettings } from "@server/presenters";
import { APIContext } from "@server/types";
import { Mailer } from "@server/emails/mailer";
import * as T from "./schema";

const router = new Router();

/**
 * Get current SMTP configuration.
 */
router.post(
  "installationSettings.smtp",
  auth({ role: UserRole.Admin }),
  validate(T.InstallationSettingsSmtpSchema),
  async (ctx: APIContext<T.InstallationSettingsSmtpReq>) => {
    const { user } = ctx.state.auth;

    // Verify instance admin access
    if (!(await isInstanceAdmin(user))) {
      throw AuthorizationError("Instance admin access required");
    }

    const settings = await InstallationSettings.get();

    ctx.body = {
      data: presentInstallationSettings(settings),
    };
  }
);

/**
 * Update SMTP configuration.
 */
router.post(
  "installationSettings.smtp.update",
  auth({ role: UserRole.Admin }),
  validate(T.InstallationSettingsSmtpUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.InstallationSettingsSmtpUpdateReq>) => {
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const {
      smtpHost,
      smtpService,
      smtpPort,
      smtpUsername,
      smtpPassword,
      smtpFromEmail,
      smtpReplyEmail,
      smtpName,
      smtpSecure,
      smtpDisableStarttls,
      smtpTlsCiphers,
    } = ctx.input.body;

    // Verify instance admin access
    if (!(await isInstanceAdmin(user))) {
      throw AuthorizationError("Instance admin access required");
    }

    const settings = await InstallationSettings.getOrCreate();

    // Update fields if provided (null clears the field)
    if (smtpHost !== undefined) {
      settings.smtpHost = smtpHost;
    }
    if (smtpService !== undefined) {
      settings.smtpService = smtpService;
    }
    if (smtpPort !== undefined) {
      settings.smtpPort = smtpPort;
    }
    if (smtpUsername !== undefined) {
      settings.smtpUsername = smtpUsername;
    }
    // Only update password if explicitly provided (not just undefined)
    if (smtpPassword !== undefined) {
      settings.smtpPassword = smtpPassword;
    }
    if (smtpFromEmail !== undefined) {
      settings.smtpFromEmail = smtpFromEmail;
    }
    if (smtpReplyEmail !== undefined) {
      settings.smtpReplyEmail = smtpReplyEmail;
    }
    if (smtpName !== undefined) {
      settings.smtpName = smtpName;
    }
    if (smtpSecure !== undefined) {
      settings.smtpSecure = smtpSecure;
    }
    if (smtpDisableStarttls !== undefined) {
      settings.smtpDisableStarttls = smtpDisableStarttls;
    }
    if (smtpTlsCiphers !== undefined) {
      settings.smtpTlsCiphers = smtpTlsCiphers;
    }

    await settings.save({ transaction });

    ctx.body = {
      data: presentInstallationSettings(settings),
    };
  }
);

/**
 * Send a test email to verify SMTP configuration.
 */
router.post(
  "installationSettings.smtp.test",
  auth({ role: UserRole.Admin }),
  validate(T.InstallationSettingsSmtpTestSchema),
  async (ctx: APIContext<T.InstallationSettingsSmtpTestReq>) => {
    const { user } = ctx.state.auth;
    const { testEmail } = ctx.input.body;

    // Verify instance admin access
    if (!(await isInstanceAdmin(user))) {
      throw AuthorizationError("Instance admin access required");
    }

    const mailer = new Mailer();
    const result = await mailer.sendTestEmail(testEmail);

    ctx.body = {
      data: result,
    };
  }
);

export default router;
