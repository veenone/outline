import fetch from "@server/utils/fetch";
import Logger from "@server/logging/Logger";
import { AuthenticationError, InvalidRequestError } from "@server/errors";
import env from "./env";

/**
 * Represents a user from the Keycloak Admin API.
 */
export interface KeycloakUser {
  /** Keycloak user ID (UUID) */
  id: string;
  /** Username */
  username: string;
  /** Email address */
  email?: string;
  /** First name */
  firstName?: string;
  /** Last name */
  lastName?: string;
  /** Whether user is enabled in Keycloak */
  enabled: boolean;
  /** Whether email is verified */
  emailVerified?: boolean;
  /** Custom attributes */
  attributes?: Record<string, string[]>;
  /** Created timestamp in milliseconds */
  createdTimestamp?: number;
}

/**
 * Token response from Keycloak token endpoint.
 */
interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
}

/**
 * Client for interacting with the Keycloak Admin REST API.
 * Used to fetch users for synchronization purposes.
 */
export default class KeycloakAdminClient {
  private adminUrl: string;
  private realm: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor() {
    // Use sync-specific credentials if provided, otherwise fall back to OIDC credentials
    this.clientId = env.OIDC_SYNC_CLIENT_ID || env.OIDC_CLIENT_ID || "";
    this.clientSecret =
      env.OIDC_SYNC_CLIENT_SECRET || env.OIDC_CLIENT_SECRET || "";
    this.adminUrl = env.OIDC_SYNC_ADMIN_URL || "";
    this.realm = env.OIDC_SYNC_REALM || "";

    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        "OIDC client credentials are required for Keycloak Admin API access"
      );
    }

    if (!this.adminUrl || !this.realm) {
      throw new Error(
        "OIDC_SYNC_ADMIN_URL and OIDC_SYNC_REALM are required for user sync"
      );
    }
  }

  /**
   * Gets the token endpoint URL for the configured realm.
   */
  private get tokenEndpoint(): string {
    return `${this.adminUrl}/realms/${this.realm}/protocol/openid-connect/token`;
  }

  /**
   * Gets the users endpoint URL for the configured realm.
   */
  private get usersEndpoint(): string {
    return `${this.adminUrl}/admin/realms/${this.realm}/users`;
  }

  /**
   * Gets the user count endpoint URL for the configured realm.
   */
  private get userCountEndpoint(): string {
    return `${this.adminUrl}/admin/realms/${this.realm}/users/count`;
  }

  /**
   * Obtains an admin access token using client credentials grant.
   * Caches the token and refreshes it when expired.
   */
  private async getAdminToken(): Promise<string> {
    // Return cached token if still valid (with 1 minute buffer)
    if (
      this.accessToken &&
      this.tokenExpiresAt &&
      this.tokenExpiresAt > new Date(Date.now() + 60000)
    ) {
      return this.accessToken;
    }

    Logger.debug(
      "plugins",
      "Obtaining admin access token via client credentials"
    );

    let response;
    try {
      response = await fetch(this.tokenEndpoint, {
        method: "POST",
        allowPrivateIPAddress: true,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "client_credentials",
        }),
      });
    } catch (err) {
      Logger.error("Failed to obtain Keycloak admin token", err);
      throw InvalidRequestError(
        `Failed to connect to Keycloak: ${err.message}`
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      Logger.warn("Keycloak token request failed", {
        status: response.status,
        error: errorText,
      });
      throw AuthenticationError(
        `Failed to obtain Keycloak admin token: ${response.status} ${errorText}`
      );
    }

    const data = (await response.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);

    Logger.debug("plugins", "Successfully obtained admin access token");
    return this.accessToken;
  }

  /**
   * Makes an authenticated request to the Keycloak Admin API.
   */
  private async adminRequest<T>(endpoint: string): Promise<T> {
    const token = await this.getAdminToken();

    const response = await fetch(endpoint, {
      method: "GET",
      allowPrivateIPAddress: true,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      Logger.warn("Keycloak Admin API request failed", {
        endpoint,
        status: response.status,
        error: errorText,
      });

      if (response.status === 401 || response.status === 403) {
        // Clear cached token on auth errors
        this.accessToken = null;
        this.tokenExpiresAt = null;
        throw AuthenticationError(
          `Keycloak Admin API authentication failed: ${errorText}`
        );
      }

      throw InvalidRequestError(
        `Keycloak Admin API request failed: ${response.status} ${errorText}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetches users from Keycloak with pagination support.
   *
   * @param first - Starting index (0-based)
   * @param max - Maximum number of users to return (default: 100)
   * @param enabled - Filter by enabled status (optional)
   * @returns Array of Keycloak users
   */
  async getUsers(
    first = 0,
    max = 100,
    enabled?: boolean
  ): Promise<KeycloakUser[]> {
    const params = new URLSearchParams({
      first: String(first),
      max: String(max),
    });

    if (enabled !== undefined) {
      params.set("enabled", String(enabled));
    }

    const endpoint = `${this.usersEndpoint}?${params.toString()}`;
    Logger.debug("plugins", `Fetching users from Keycloak`, { endpoint });

    return this.adminRequest<KeycloakUser[]>(endpoint);
  }

  /**
   * Fetches all users from Keycloak, handling pagination automatically.
   *
   * @param batchSize - Number of users to fetch per request (default: 100)
   * @param enabled - Filter by enabled status (optional)
   * @returns Array of all Keycloak users
   */
  async getAllUsers(
    batchSize = 100,
    enabled?: boolean
  ): Promise<KeycloakUser[]> {
    const allUsers: KeycloakUser[] = [];
    let first = 0;

    Logger.info("plugins", "Fetching all users from Keycloak");

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const users = await this.getUsers(first, batchSize, enabled);
      allUsers.push(...users);

      if (users.length < batchSize) {
        // No more users to fetch
        break;
      }

      first += batchSize;

      // Safety limit to prevent infinite loops
      if (first > 100000) {
        Logger.warn(
          "Reached safety limit of 100,000 users during Keycloak sync"
        );
        break;
      }
    }

    Logger.info("plugins", `Fetched ${allUsers.length} users from Keycloak`);
    return allUsers;
  }

  /**
   * Gets the total count of users in Keycloak.
   *
   * @param enabled - Filter by enabled status (optional)
   * @returns Total number of users
   */
  async getUserCount(enabled?: boolean): Promise<number> {
    const params = new URLSearchParams();
    if (enabled !== undefined) {
      params.set("enabled", String(enabled));
    }

    const queryString = params.toString();
    const endpoint = queryString
      ? `${this.userCountEndpoint}?${queryString}`
      : this.userCountEndpoint;

    return this.adminRequest<number>(endpoint);
  }

  /**
   * Checks if the Keycloak Admin API is accessible and properly configured.
   *
   * @returns true if the connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getUserCount();
      return true;
    } catch (err) {
      Logger.error("Keycloak Admin API connection test failed", err);
      return false;
    }
  }
}
