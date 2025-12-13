import { EmailAddress } from "addressparser";
import nodemailer, { Transporter } from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import Oy from "oy-vey";
import env from "@server/env";
import { InternalError } from "@server/errors";
import Logger from "@server/logging/Logger";
import { trace } from "@server/logging/tracing";
import { InstallationSettings } from "@server/models";
import { baseStyles } from "./templates/components/EmailLayout";

const useTestEmailService = env.isDevelopment && !env.SMTP_USERNAME;

type SendMailOptions = {
  to: string;
  from: EmailAddress;
  replyTo?: string;
  messageId?: string;
  references?: string[];
  subject: string;
  previewText?: string;
  text: string;
  component: JSX.Element;
  headCSS?: string;
  unsubscribeUrl?: string;
};

/**
 * Mailer class to send emails.
 */
@trace({
  serviceName: "mailer",
})
export class Mailer {
  transporter: Transporter | undefined;

  constructor() {
    if (env.SMTP_HOST || env.SMTP_SERVICE) {
      this.transporter = nodemailer.createTransport(this.getOptions());
    }
    if (useTestEmailService) {
      Logger.info(
        "email",
        "SMTP_USERNAME not provided, generating test account…"
      );

      void this.getTestTransportOptions().then((options) => {
        if (!options) {
          Logger.info(
            "email",
            "Couldn't generate a test account with ethereal.email at this time – emails will not be sent."
          );
          return;
        }

        this.transporter = nodemailer.createTransport(options);
      });
    }
  }

  template = ({
    title,
    bodyContent,
    headCSS = "",
    bgColor = "#FFFFFF",
    lang,
    dir = "ltr" /* https://www.w3.org/TR/html4/struct/dirlang.html#blocklevel-bidi */,
  }: Oy.CustomTemplateRenderOptions) => {
    if (!title) {
      throw InternalError("`title` is a required option for `renderTemplate`");
    }
    if (!bodyContent) {
      throw InternalError(
        "`bodyContent` is a required option for `renderTemplate`"
      );
    }

    // the template below is a slightly modified form of https://github.com/revivek/oy/blob/master/src/utils/HTML4.js
    return `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
    <html
      ${lang ? 'lang="' + lang + '"' : ""}
      dir="${dir}"
      xmlns="http://www.w3.org/1999/xhtml"
      xmlns:v="urn:schemas-microsoft-com:vml"
      xmlns:o="urn:schemas-microsoft-com:office:office">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <meta http-equiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width"/>

        <title>${title}</title>

        <style type="text/css">
          ${headCSS}

          #__bodyTable__ {
            margin: 0;
            padding: 0;
            width: 100% !important;
          }
        </style>

        <!--[if gte mso 9]>
          <xml>
            <o:OfficeDocumentSettings>
              <o:AllowPNG/>
              <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
          </xml>
        <![endif]-->
      </head>
      <body bgcolor="${bgColor}" width="100%" style="-webkit-font-smoothing: antialiased; width:100% !important; background:${bgColor};-webkit-text-size-adjust:none; margin:0; padding:0; min-width:100%; direction: ${dir};">
        ${bodyContent}
      </body>
    </html>
  `;
  };

  /**
   *
   * @param data Email headers and body
   * @returns Message ID header from SMTP server
   */
  sendMail = async (data: SendMailOptions): Promise<void> => {
    const { transporter } = this;

    if (env.isDevelopment) {
      Logger.debug(
        "email",
        [
          `Sending email:`,
          ``,
          `--------------`,
          `From:      ${data.from.address}`,
          `To:        ${data.to}`,
          `Subject:   ${data.subject}`,
          `Preview:   ${data.previewText}`,
          `--------------`,
          ``,
          data.text,
        ].join("\n")
      );
    }
    if (!transporter) {
      Logger.warn("No mail transport available");
      return;
    }

    const html = Oy.renderTemplate(
      data.component,
      {
        title: data.subject,
        headCSS: [baseStyles, data.headCSS].join(" "),
      } as Oy.RenderOptions,
      this.template
    );

    try {
      Logger.info("email", `Sending email "${data.subject}" to ${data.to}`);

      // Get reply-to from database or env
      const settings = await InstallationSettings.get();
      const replyTo =
        data.replyTo ??
        settings?.smtpReplyEmail ??
        env.SMTP_REPLY_EMAIL ??
        settings?.smtpFromEmail ??
        env.SMTP_FROM_EMAIL;

      const info = await transporter.sendMail({
        from: data.from,
        replyTo,
        to: data.to,
        messageId: data.messageId,
        references: data.references,
        inReplyTo: data.references?.at(-1),
        subject: data.subject,
        html,
        text: data.text,
        list: data.unsubscribeUrl
          ? {
              unsubscribe: {
                url: data.unsubscribeUrl,
                comment: "Unsubscribe from these emails",
              },
            }
          : undefined,
        attachments: env.isCloudHosted
          ? undefined
          : [
              {
                filename: "header-logo.png",
                path: process.cwd() + "/public/email/header-logo.png",
                cid: "header-image",
              },
            ],
      });

      if (useTestEmailService) {
        Logger.info(
          "email",
          `Preview Url: ${nodemailer.getTestMessageUrl(info)}`
        );
      }
    } catch (err) {
      Logger.error(`Error sending email to ${data.to}`, err);
      throw err; // Re-throw for queue to re-try
    }
  };

  /**
   * Send a test email to verify SMTP configuration.
   *
   * @param to Email address to send test to.
   * @returns Result object with success status and optional error message.
   */
  async sendTestEmail(
    to: string
  ): Promise<{ success: boolean; error?: string; previewUrl?: string }> {
    try {
      const options = await this.getOptionsFromDatabase();
      if (!options) {
        return {
          success: false,
          error: "SMTP is not configured. Please configure SMTP settings first.",
        };
      }

      const testTransporter = nodemailer.createTransport(options);

      // Verify connection
      await testTransporter.verify();

      // Get the from email from database or env
      const settings = await InstallationSettings.get();
      const fromEmail =
        settings?.smtpFromEmail ?? env.SMTP_FROM_EMAIL ?? "test@example.com";

      const info = await testTransporter.sendMail({
        from: fromEmail,
        to,
        subject: "Outline SMTP Test Email",
        text: "This is a test email from Outline to verify your SMTP configuration is working correctly.",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>SMTP Configuration Test</h2>
            <p>This is a test email from Outline to verify your SMTP configuration is working correctly.</p>
            <p>If you received this email, your SMTP settings are configured properly.</p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;" />
            <p style="color: #666; font-size: 12px;">Sent from Outline</p>
          </div>
        `,
      });

      const previewUrl = useTestEmailService
        ? nodemailer.getTestMessageUrl(info) || undefined
        : undefined;

      Logger.info("email", `Test email sent successfully to ${to}`);

      return {
        success: true,
        previewUrl: previewUrl ? String(previewUrl) : undefined,
      };
    } catch (err) {
      Logger.error(`Failed to send test email to ${to}`, err);
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error occurred",
      };
    }
  }

  /**
   * Get SMTP options from database configuration, falling back to environment variables.
   *
   * @returns SMTP transport options or null if not configured.
   */
  private async getOptionsFromDatabase(): Promise<SMTPTransport.Options | null> {
    // Try database configuration first
    const settings = await InstallationSettings.get();

    if (settings?.isSmtpConfigured) {
      return this.buildOptionsFromSettings(settings);
    }

    // Fall back to environment variables
    if (env.SMTP_HOST || env.SMTP_SERVICE) {
      return this.getOptions();
    }

    return null;
  }

  /**
   * Build SMTP transport options from InstallationSettings model.
   *
   * @param settings The InstallationSettings instance.
   * @returns SMTP transport options.
   */
  private buildOptionsFromSettings(
    settings: InstallationSettings
  ): SMTPTransport.Options {
    // Use service-based config if service is specified
    if (settings.smtpService) {
      return {
        service: settings.smtpService,
        auth: settings.smtpUsername
          ? {
              user: settings.smtpUsername,
              pass: settings.smtpPassword ?? undefined,
            }
          : undefined,
      };
    }

    return {
      name: settings.smtpName ?? undefined,
      host: settings.smtpHost ?? undefined,
      port: settings.smtpPort ?? undefined,
      secure: settings.smtpSecure ?? env.isProduction,
      auth: settings.smtpUsername
        ? {
            user: settings.smtpUsername,
            pass: settings.smtpPassword ?? undefined,
          }
        : undefined,
      ignoreTLS: settings.smtpDisableStarttls ?? false,
      tls:
        settings.smtpSecure ?? env.isProduction
          ? settings.smtpTlsCiphers
            ? { ciphers: settings.smtpTlsCiphers }
            : undefined
          : { rejectUnauthorized: false },
    };
  }

  private getOptions(): SMTPTransport.Options {
    // nodemailer will use the service config to determine host/port
    if (env.SMTP_SERVICE) {
      return {
        service: env.SMTP_SERVICE,
        auth: {
          user: env.SMTP_USERNAME,
          pass: env.SMTP_PASSWORD,
        },
      };
    }

    return {
      name: env.SMTP_NAME,
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // If not explicitly configured we default to using TLS in production
      secure: env.SMTP_SECURE ?? env.isProduction,
      // Allow connections with no authentication if no username is provided
      auth: env.SMTP_USERNAME
        ? {
            user: env.SMTP_USERNAME,
            pass: env.SMTP_PASSWORD,
          }
        : undefined,
      // Disable STARTTLS entirely when SMTP_DISABLE_STARTTLS is set to true
      ignoreTLS: env.SMTP_DISABLE_STARTTLS,
      tls: env.SMTP_SECURE
        ? env.SMTP_TLS_CIPHERS
          ? {
              ciphers: env.SMTP_TLS_CIPHERS,
            }
          : undefined
        : {
            rejectUnauthorized: false,
          },
    };
  }

  private async getTestTransportOptions(): Promise<
    SMTPTransport.Options | undefined
  > {
    try {
      const testAccount = await nodemailer.createTestAccount();
      return {
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      };
    } catch (_err) {
      return undefined;
    }
  }
}

export default new Mailer();
