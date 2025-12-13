import { observer } from "mobx-react";
import { EmailIcon } from "outline-icons";
import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslation, Trans } from "react-i18next";
import { toast } from "sonner";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import Input from "~/components/Input";
import InputSelect, { Option } from "~/components/InputSelect";
import Notice from "~/components/Notice";
import Scene from "~/components/Scene";
import Switch from "~/components/Switch";
import Text from "~/components/Text";
import useCurrentUser from "~/hooks/useCurrentUser";
import { client } from "~/utils/ApiClient";
import SettingRow from "./components/SettingRow";

interface SmtpConfig {
  smtpHost: string | null;
  smtpService: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  smtpPassword: string | null;
  smtpFromEmail: string | null;
  smtpReplyEmail: string | null;
  smtpName: string | null;
  smtpSecure: boolean | null;
  smtpDisableStarttls: boolean | null;
  smtpTlsCiphers: string | null;
  isConfigured: boolean;
  isUsingDatabaseConfig: boolean;
  isUsingEnvConfig: boolean;
  instanceAdminEmail: string | null;
}

interface FormData {
  smtpHost: string;
  smtpService: string;
  smtpPort: string;
  smtpUsername: string;
  smtpPassword: string;
  smtpFromEmail: string;
  smtpReplyEmail: string;
  smtpName: string;
  smtpSecure: boolean;
  smtpDisableStarttls: boolean;
  smtpTlsCiphers: string;
  useService: boolean;
}

// Common SMTP services supported by nodemailer
const smtpServices: Option[] = [
  { type: "item", label: "Custom Host", value: "" },
  { type: "item", label: "Gmail", value: "gmail" },
  { type: "item", label: "Outlook365", value: "Outlook365" },
  { type: "item", label: "Yahoo", value: "Yahoo" },
  { type: "item", label: "Zoho", value: "Zoho" },
  { type: "item", label: "SendGrid", value: "SendGrid" },
  { type: "item", label: "Mailgun", value: "Mailgun" },
  { type: "item", label: "Postmark", value: "Postmark" },
  { type: "item", label: "SES", value: "SES" },
];

function Smtp() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const [config, setConfig] = React.useState<SmtpConfig | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testEmail, setTestEmail] = React.useState(user.email || "");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { isDirty },
  } = useForm<FormData>({
    defaultValues: {
      smtpHost: "",
      smtpService: "",
      smtpPort: "",
      smtpUsername: "",
      smtpPassword: "",
      smtpFromEmail: "",
      smtpReplyEmail: "",
      smtpName: "",
      smtpSecure: true,
      smtpDisableStarttls: false,
      smtpTlsCiphers: "",
      useService: false,
    },
  });

  const useService = watch("useService");

  // Fetch current config on mount
  React.useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await client.post<{ data: SmtpConfig }>(
          "/installationSettings.smtp"
        );
        setConfig(res.data);

        // Populate form with existing values
        const data = res.data;
        reset({
          smtpHost: data.smtpHost || "",
          smtpService: data.smtpService || "",
          smtpPort: data.smtpPort?.toString() || "",
          smtpUsername: data.smtpUsername || "",
          smtpPassword: "", // Never show the password
          smtpFromEmail: data.smtpFromEmail || "",
          smtpReplyEmail: data.smtpReplyEmail || "",
          smtpName: data.smtpName || "",
          smtpSecure: data.smtpSecure ?? true,
          smtpDisableStarttls: data.smtpDisableStarttls ?? false,
          smtpTlsCiphers: data.smtpTlsCiphers || "",
          useService: !!data.smtpService,
        });
      } catch (err) {
        toast.error(t("Failed to load SMTP configuration"));
      } finally {
        setLoading(false);
      }
    };

    void fetchConfig();
  }, [reset, t]);

  const onSubmit = async (data: FormData) => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        smtpFromEmail: data.smtpFromEmail || null,
        smtpReplyEmail: data.smtpReplyEmail || null,
        smtpUsername: data.smtpUsername || null,
        smtpSecure: data.smtpSecure,
        smtpDisableStarttls: data.smtpDisableStarttls,
        smtpTlsCiphers: data.smtpTlsCiphers || null,
      };

      // Only include password if user entered a new one
      if (data.smtpPassword) {
        payload.smtpPassword = data.smtpPassword;
      }

      if (data.useService) {
        payload.smtpService = data.smtpService || null;
        payload.smtpHost = null;
        payload.smtpPort = null;
        payload.smtpName = null;
      } else {
        payload.smtpHost = data.smtpHost || null;
        payload.smtpPort = data.smtpPort ? parseInt(data.smtpPort, 10) : null;
        payload.smtpName = data.smtpName || null;
        payload.smtpService = null;
      }

      const res = await client.post<{ data: SmtpConfig }>(
        "/installationSettings.smtp.update",
        payload
      );
      setConfig(res.data);
      toast.success(t("SMTP configuration saved"));

      // Reset form dirty state but keep values
      reset(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("Failed to save configuration")
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmail) {
      toast.error(t("Please enter a test email address"));
      return;
    }

    setTesting(true);
    try {
      const res = await client.post<{
        data: { success: boolean; error?: string; previewUrl?: string };
      }>("/installationSettings.smtp.test", {
        testEmail,
      });

      if (res.data.success) {
        toast.success(t("Test email sent successfully"));
        if (res.data.previewUrl) {
          window.open(res.data.previewUrl, "_blank");
        }
      } else {
        toast.error(res.data.error || t("Failed to send test email"));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("Failed to send test email")
      );
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Scene title={t("SMTP Configuration")} icon={<EmailIcon />}>
        <Heading>{t("SMTP Configuration")}</Heading>
        <Text as="p" type="secondary">
          {t("Loading...")}
        </Text>
      </Scene>
    );
  }

  return (
    <Scene title={t("SMTP Configuration")} icon={<EmailIcon />}>
      <Heading>{t("SMTP Configuration")}</Heading>
      <Text as="p" type="secondary">
        <Trans>
          Configure email delivery settings for this Outline instance. Email is
          required for user invitations, notifications, and password resets.
        </Trans>
      </Text>

      {config?.isUsingEnvConfig && !config?.isUsingDatabaseConfig && (
        <Notice>
          <Trans>
            Currently using environment variable configuration. Settings saved
            here will override the environment variables.
          </Trans>
        </Notice>
      )}

      <form onSubmit={handleSubmit(onSubmit)}>
        <Heading as="h2">{t("Connection")}</Heading>

        <SettingRow
          label={t("Use well-known service")}
          name="useService"
          description={t(
            "Select a pre-configured email service or enter custom SMTP settings."
          )}
        >
          <Switch
            checked={useService}
            onChange={(checked) => setValue("useService", checked)}
          />
        </SettingRow>

        {useService ? (
          <SettingRow
            label={t("Email Service")}
            name="smtpService"
            description={t("Select your email service provider.")}
          >
            <InputSelect
              value={watch("smtpService")}
              options={smtpServices}
              onChange={(value) =>
                setValue("smtpService", value as string, { shouldDirty: true })
              }
              ariaLabel={t("Email Service")}
            />
          </SettingRow>
        ) : (
          <>
            <SettingRow
              label={t("SMTP Host")}
              name="smtpHost"
              description={t("The hostname of your SMTP server.")}
            >
              <Input
                {...register("smtpHost")}
                placeholder="smtp.example.com"
              />
            </SettingRow>

            <SettingRow
              label={t("SMTP Port")}
              name="smtpPort"
              description={t("The port of your SMTP server (usually 587 or 465).")}
            >
              <Input
                {...register("smtpPort")}
                type="number"
                placeholder="587"
              />
            </SettingRow>

            <SettingRow
              label={t("Client Hostname")}
              name="smtpName"
              description={t(
                "Optional hostname used to identify the client to the SMTP server."
              )}
            >
              <Input {...register("smtpName")} placeholder="outline.example.com" />
            </SettingRow>
          </>
        )}

        <Heading as="h2">{t("Authentication")}</Heading>

        <SettingRow
          label={t("Username")}
          name="smtpUsername"
          description={t("The username for SMTP authentication.")}
        >
          <Input {...register("smtpUsername")} autoComplete="off" />
        </SettingRow>

        <SettingRow
          label={t("Password")}
          name="smtpPassword"
          description={t(
            "The password for SMTP authentication. Leave empty to keep the current password."
          )}
        >
          <Input
            {...register("smtpPassword")}
            type="password"
            autoComplete="new-password"
            placeholder={config?.smtpPassword ? "••••••••" : ""}
          />
        </SettingRow>

        <Heading as="h2">{t("Email Addresses")}</Heading>

        <SettingRow
          label={t("From Email")}
          name="smtpFromEmail"
          description={t(
            "The email address that will appear as the sender."
          )}
        >
          <Input
            {...register("smtpFromEmail")}
            type="email"
            placeholder="notifications@example.com"
          />
        </SettingRow>

        <SettingRow
          label={t("Reply-To Email")}
          name="smtpReplyEmail"
          description={t(
            "Optional reply-to address. If not set, replies will go to the from address."
          )}
        >
          <Input
            {...register("smtpReplyEmail")}
            type="email"
            placeholder="support@example.com"
          />
        </SettingRow>

        <Heading as="h2">{t("Security")}</Heading>

        <SettingRow
          label={t("Use TLS")}
          name="smtpSecure"
          description={t(
            "Use TLS for the connection. Recommended for port 465."
          )}
        >
          <Switch
            checked={watch("smtpSecure")}
            onChange={(checked) =>
              setValue("smtpSecure", checked, { shouldDirty: true })
            }
          />
        </SettingRow>

        <SettingRow
          label={t("Disable STARTTLS")}
          name="smtpDisableStarttls"
          description={t(
            "Disable STARTTLS even if the server supports it. Not recommended."
          )}
        >
          <Switch
            checked={watch("smtpDisableStarttls")}
            onChange={(checked) =>
              setValue("smtpDisableStarttls", checked, { shouldDirty: true })
            }
          />
        </SettingRow>

        <SettingRow
          label={t("TLS Ciphers")}
          name="smtpTlsCiphers"
          description={t("Optional custom TLS cipher configuration.")}
        >
          <Input {...register("smtpTlsCiphers")} placeholder="" />
        </SettingRow>

        <Flex gap={8} style={{ marginTop: 24 }}>
          <Button type="submit" disabled={!isDirty || saving}>
            {saving ? t("Saving...") : t("Save")}
          </Button>
        </Flex>
      </form>

      <Heading as="h2" style={{ marginTop: 48 }}>
        {t("Test Configuration")}
      </Heading>
      <Text as="p" type="secondary">
        <Trans>
          Send a test email to verify your SMTP configuration is working
          correctly.
        </Trans>
      </Text>

      <Flex gap={8} align="flex-end" style={{ marginTop: 16 }}>
        <Input
          label={t("Test Email Address")}
          type="email"
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          placeholder="test@example.com"
          style={{ width: 300 }}
        />
        <Button
          onClick={handleSendTestEmail}
          disabled={testing || !config?.isConfigured}
          neutral
        >
          {testing ? t("Sending...") : t("Send Test Email")}
        </Button>
      </Flex>

      {!config?.isConfigured && (
        <Notice muted style={{ marginTop: 16 }}>
          <Trans>
            Save your SMTP configuration before sending a test email.
          </Trans>
        </Notice>
      )}
    </Scene>
  );
}

export default observer(Smtp);
