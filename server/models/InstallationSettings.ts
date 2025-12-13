import { InferAttributes, InferCreationAttributes } from "sequelize";
import { DataType, Table, Column } from "sequelize-typescript";
import IdModel from "./base/IdModel";
import Encrypted from "./decorators/Encrypted";
import Fix from "./decorators/Fix";

/**
 * InstallationSettings is a singleton model that stores instance-wide configuration
 * settings, such as SMTP configuration. Only one row should exist in this table.
 */
@Table({
  tableName: "installation_settings",
  modelName: "installation_settings",
})
@Fix
class InstallationSettings extends IdModel<
  InferAttributes<InstallationSettings>,
  Partial<InferCreationAttributes<InstallationSettings>>
> {
  // SMTP Configuration

  @Column(DataType.STRING)
  smtpHost: string | null;

  @Column(DataType.STRING)
  smtpService: string | null;

  @Column(DataType.INTEGER)
  smtpPort: number | null;

  @Column(DataType.STRING)
  smtpUsername: string | null;

  @Column(DataType.BLOB)
  @Encrypted
  smtpPassword: string | null;

  @Column(DataType.STRING)
  smtpFromEmail: string | null;

  @Column(DataType.STRING)
  smtpReplyEmail: string | null;

  @Column(DataType.STRING)
  smtpName: string | null;

  @Column(DataType.BOOLEAN)
  smtpSecure: boolean | null;

  @Column(DataType.BOOLEAN)
  smtpDisableStarttls: boolean | null;

  @Column(DataType.STRING)
  smtpTlsCiphers: string | null;

  // Instance Admin Configuration

  @Column(DataType.STRING)
  instanceAdminEmail: string | null;

  // Static Methods

  /**
   * Get the singleton InstallationSettings instance.
   *
   * @returns The InstallationSettings instance or null if none exists.
   */
  static async get(): Promise<InstallationSettings | null> {
    return this.findOne();
  }

  /**
   * Get or create the singleton InstallationSettings instance.
   *
   * @returns The InstallationSettings instance.
   */
  static async getOrCreate(): Promise<InstallationSettings> {
    const existing = await this.findOne();
    if (existing) {
      return existing;
    }
    return this.create({});
  }

  // Instance Methods

  /**
   * Check if SMTP is configured in the database settings.
   *
   * @returns True if SMTP host or service is configured.
   */
  get isSmtpConfigured(): boolean {
    return !!(this.smtpHost || this.smtpService);
  }
}

export default InstallationSettings;
