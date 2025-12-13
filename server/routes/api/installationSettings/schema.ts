import { z } from "zod";
import wellKnownServices from "nodemailer/lib/well-known/services.json";
import { BaseSchema } from "../schema";

/**
 * Schema for getting SMTP configuration.
 */
export const InstallationSettingsSmtpSchema = BaseSchema;

export type InstallationSettingsSmtpReq = z.infer<
  typeof InstallationSettingsSmtpSchema
>;

/**
 * Schema for updating SMTP configuration.
 */
export const InstallationSettingsSmtpUpdateSchema = BaseSchema.extend({
  body: z.object({
    /** SMTP server hostname */
    smtpHost: z.string().nullable().optional(),

    /** Well-known SMTP service name */
    smtpService: z
      .string()
      .refine(
        (val) =>
          !val ||
          Object.keys(wellKnownServices).some(
            (s) => s.toLowerCase() === val.toLowerCase()
          ),
        { message: "Invalid SMTP service" }
      )
      .nullable()
      .optional(),

    /** SMTP server port */
    smtpPort: z.number().int().min(1).max(65535).nullable().optional(),

    /** SMTP authentication username */
    smtpUsername: z.string().nullable().optional(),

    /** SMTP authentication password */
    smtpPassword: z.string().nullable().optional(),

    /** Sender email address */
    smtpFromEmail: z.string().email().nullable().optional(),

    /** Reply-to email address */
    smtpReplyEmail: z.string().email().nullable().optional(),

    /** Client hostname identifier */
    smtpName: z.string().nullable().optional(),

    /** Use TLS for connection */
    smtpSecure: z.boolean().nullable().optional(),

    /** Disable STARTTLS */
    smtpDisableStarttls: z.boolean().nullable().optional(),

    /** Custom TLS ciphers */
    smtpTlsCiphers: z.string().nullable().optional(),
  }),
});

export type InstallationSettingsSmtpUpdateReq = z.infer<
  typeof InstallationSettingsSmtpUpdateSchema
>;

/**
 * Schema for testing SMTP configuration.
 */
export const InstallationSettingsSmtpTestSchema = BaseSchema.extend({
  body: z.object({
    /** Email address to send test email to */
    testEmail: z.string().email(),
  }),
});

export type InstallationSettingsSmtpTestReq = z.infer<
  typeof InstallationSettingsSmtpTestSchema
>;
