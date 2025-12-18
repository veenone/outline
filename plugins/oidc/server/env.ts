import {
  IsBoolean,
  IsOptional,
  IsUrl,
  MaxLength,
  IsString,
} from "class-validator";
import { Environment } from "@server/env";
import { Public } from "@server/utils/decorators/Public";
import environment from "@server/utils/environment";
import { CannotUseWithout } from "@server/utils/validators";

class OIDCPluginEnvironment extends Environment {
  /**
   * OIDC client credentials. To enable authentication with any
   * compatible provider.
   */
  @IsOptional()
  @CannotUseWithout("OIDC_CLIENT_SECRET")
  public OIDC_CLIENT_ID = this.toOptionalString(environment.OIDC_CLIENT_ID);

  @IsOptional()
  @CannotUseWithout("OIDC_CLIENT_ID")
  public OIDC_CLIENT_SECRET = this.toOptionalString(
    environment.OIDC_CLIENT_SECRET
  );

  /**
   * The OIDC issuer URL for automatic discovery of endpoints via the
   * well-known configuration endpoint. When provided, the authorization,
   * token, and userinfo endpoints will be automatically discovered.
   */
  @IsOptional()
  @IsUrl({
    require_tld: false,
    allow_underscores: true,
  })
  public OIDC_ISSUER_URL = this.toOptionalString(environment.OIDC_ISSUER_URL);

  /**
   * The name of the OIDC provider, eg "GitLab" – this will be displayed on the
   * sign-in button and other places in the UI. The default value is:
   * "OpenID Connect".
   */
  @MaxLength(50)
  public OIDC_DISPLAY_NAME = environment.OIDC_DISPLAY_NAME ?? "OpenID Connect";

  /**
   * The OIDC authorization endpoint.
   */
  @IsOptional()
  @IsUrl({
    require_tld: false,
    allow_underscores: true,
  })
  public OIDC_AUTH_URI = this.toOptionalString(environment.OIDC_AUTH_URI);

  /**
   * The OIDC token endpoint.
   */
  @IsOptional()
  @IsUrl({
    require_tld: false,
    allow_underscores: true,
  })
  public OIDC_TOKEN_URI = this.toOptionalString(environment.OIDC_TOKEN_URI);

  /**
   * The OIDC userinfo endpoint.
   */
  @IsOptional()
  @IsUrl({
    require_tld: false,
    allow_underscores: true,
  })
  public OIDC_USERINFO_URI = this.toOptionalString(
    environment.OIDC_USERINFO_URI
  );

  /**
   * The OIDC profile field to use as the username. The default value is
   * "preferred_username".
   */
  public OIDC_USERNAME_CLAIM =
    environment.OIDC_USERNAME_CLAIM ?? "preferred_username";

  /**
   * A space separated list of OIDC scopes to request. Defaults to "openid
   * profile email".
   */
  public OIDC_SCOPES = environment.OIDC_SCOPES ?? "openid profile email";

  /**
   * Disable autoredirect to the OIDC login page if there is only one
   * authentication method and that method is OIDC.
   */
  @Public
  @IsOptional()
  @IsBoolean()
  public OIDC_DISABLE_REDIRECT = this.toOptionalBoolean(
    environment.OIDC_DISABLE_REDIRECT
  );

  /**
   * The OIDC logout endpoint.
   */
  @Public
  @IsOptional()
  @IsUrl({
    require_tld: false,
    allow_underscores: true,
  })
  public OIDC_LOGOUT_URI = this.toOptionalString(environment.OIDC_LOGOUT_URI);

  /**
   * Enable automatic user synchronization from the OIDC provider.
   * When enabled, users will be pre-created in Outline before they log in,
   * and users removed from the OIDC provider will be suspended.
   */
  @IsOptional()
  @IsBoolean()
  public OIDC_SYNC_ENABLED = this.toOptionalBoolean(
    environment.OIDC_SYNC_ENABLED
  );

  /**
   * The base URL of the Keycloak server for Admin API access.
   * Example: https://keycloak.example.com
   */
  @IsOptional()
  @CannotUseWithout("OIDC_SYNC_ENABLED")
  @IsUrl({
    require_tld: false,
    allow_underscores: true,
  })
  public OIDC_SYNC_ADMIN_URL = this.toOptionalString(
    environment.OIDC_SYNC_ADMIN_URL
  );

  /**
   * The Keycloak realm name to sync users from.
   */
  @IsOptional()
  @CannotUseWithout("OIDC_SYNC_ENABLED")
  @IsString()
  @MaxLength(255)
  public OIDC_SYNC_REALM = this.toOptionalString(environment.OIDC_SYNC_REALM);

  /**
   * Optional: Client ID for Keycloak Admin API access.
   * If not provided, OIDC_CLIENT_ID will be used.
   * The client must have service account enabled with appropriate realm roles.
   */
  @IsOptional()
  @IsString()
  public OIDC_SYNC_CLIENT_ID = this.toOptionalString(
    environment.OIDC_SYNC_CLIENT_ID
  );

  /**
   * Optional: Client secret for Keycloak Admin API access.
   * If not provided, OIDC_CLIENT_SECRET will be used.
   */
  @IsOptional()
  @CannotUseWithout("OIDC_SYNC_CLIENT_ID")
  @IsString()
  public OIDC_SYNC_CLIENT_SECRET = this.toOptionalString(
    environment.OIDC_SYNC_CLIENT_SECRET
  );
}

export default new OIDCPluginEnvironment();
